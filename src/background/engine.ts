import { ChromeTabsAdapter, type ChromeTab } from '../chrome/ChromeTabsAdapter';
import type {
  BackupListItem,
  Command,
  ProviderTestResult,
  StateMessage,
  SuggestionBatch,
  UiMeta,
} from '../chrome/messaging';
import { exportCsv, exportJson, importCsv, importJson } from '../features/backup/BackupService';
import { AiGroupingService } from '../features/ai/AiGroupingService';
import { isShareableWithCloud, summarizeCanvases, toTabMetadata } from '../features/ai/metadata';
import { pickModel } from '../features/ai/providers/openaiCompatible';
import { RecoveryService } from '../features/recovery/RecoveryService';
import { debounce, SerialQueue } from '../lib/async';
import { nextAccent } from '../lib/colors';
import { uid } from '../lib/id';
import { sleepUrl, unwrapSleepUrl } from '../lib/sleep';
import { isRestorableUrl, isWebUrl } from '../lib/url';
import { chromeLocalStore, PersistenceService } from '../storage/persistence';
import { createCanvas, createInitialState, SESSION_KEYS, STORAGE_KEYS } from '../storage/schema';
import type { Canvas, JournalEvent, PersistedState, StoredTab } from '../types';

type UndoEntry = {
  label: string;
  at: number;
  canvases: Canvas[];
  tabs: StoredTab[];
  lastActiveCanvasId?: string;
};

const MAX_UNDO = 10;

type DiagnosticError = { at: number; where: string; message: string };
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const NEW_TAB_SUGGESTION_WINDOW_MS = 3 * 60_000;

const RECONCILE_TRIGGERS = new Set<JournalEvent['type']>([
  'TAB_OPENED',
  'TAB_ASSIGNED',
  'CANVAS_RENAMED',
  'CANVAS_UPDATED',
  'STATE_RESTORED',
  'TAB_MOVED',
]);

const rawUrlOf = (ct: ChromeTab) => ct.url || ct.pendingUrl || '';
const extensionBase = () => chrome.runtime.getURL('/');
/** Real URL of a Chrome tab, seeing through Chromotion sleeping pages. */
const urlOf = (ct: ChromeTab) => {
  const raw = rawUrlOf(ct);
  return unwrapSleepUrl(extensionBase(), raw) ?? raw;
};
const isSleeping = (ct: ChromeTab) => unwrapSleepUrl(extensionBase(), rawUrlOf(ct)) !== undefined;

/**
 * Background engine. Owns the persisted state (single writer), mirrors Chrome
 * tab events into it, and keeps Chrome tab groups in sync with canvases.
 * Every mutation runs through one serial queue.
 */
export class Engine {
  private persistence!: PersistenceService;
  private readonly recovery = new RecoveryService(chromeLocalStore);
  private readonly queue = new SerialQueue();
  private readonly ports = new Set<chrome.runtime.Port>();
  private readonly ownRemovals = new Set<number>();
  private readonly openers = new Map<string, string>();
  private readonly suggestedFor = new Set<string>();
  private meta: UiMeta = {};
  private undoStack: UndoEntry[] = [];
  private lastBackupSeq = -1;
  private reconcileFailures = 0;
  private readonly errors: DiagnosticError[] = [];
  readonly ai: AiGroupingService;
  readonly ready: Promise<void>;

  private readonly broadcastSoon = debounce(() => this.broadcast(), 30, 120);
  private readonly reconcileSoon = debounce(() => {
    void this.queue.run(() => this.reconcile()).catch((err) => this.logError('reconcile', err));
  }, 150, 600);
  private readonly persistSessionSoon = debounce(() => void this.persistSession(), 200, 1000);

  constructor() {
    this.ai = new AiGroupingService(() => this.state.preferences, {
      fetch: (input, init) => fetch(input, init),
      hasPermission: (origin) => chrome.permissions.contains({ origins: [origin] }),
      isCoolingDown: async (id) => {
        const raw = await chrome.storage.session.get(SESSION_KEYS.providerCooldown);
        const map = (raw[SESSION_KEYS.providerCooldown] ?? {}) as Record<string, number>;
        return (map[id] ?? 0) > Date.now();
      },
      setCooldown: async (id, until) => {
        const raw = await chrome.storage.session.get(SESSION_KEYS.providerCooldown);
        const map = (raw[SESSION_KEYS.providerCooldown] ?? {}) as Record<string, number>;
        await chrome.storage.session.set({ [SESSION_KEYS.providerCooldown]: { ...map, [id]: until } });
      },
      getModelCache: async (id) => {
        const raw = await chrome.storage.local.get(STORAGE_KEYS.modelCache);
        return ((raw[STORAGE_KEYS.modelCache] ?? {}) as Record<string, { model: string; at: number }>)[id];
      },
      setModelCache: async (id, model) => {
        const raw = await chrome.storage.local.get(STORAGE_KEYS.modelCache);
        const map = (raw[STORAGE_KEYS.modelCache] ?? {}) as Record<string, { model: string; at: number }>;
        await chrome.storage.local.set({ [STORAGE_KEYS.modelCache]: { ...map, [id]: { model, at: Date.now() } } });
      },
    });
    this.ready = this.init();
  }

  get state(): PersistedState {
    return this.persistence.current;
  }

  // -------------------------------------------------------------------------
  // Startup & recovery

  /**
   * Never rejects: whatever fails here is logged and the extension still
   * starts, so the UI can never get stuck waiting for a broken worker.
   */
  private async init(): Promise<void> {
    let loaded: Awaited<ReturnType<RecoveryService['load']>>;
    try {
      loaded = await this.recovery.load();
    } catch (err) {
      this.logError('recovery', err);
      loaded = { state: createInitialState(), report: { source: 'fresh', replayedEvents: 0, problems: [errorText(err)] } };
    }
    const { state, report } = loaded;
    this.persistence = new PersistenceService(state, chromeLocalStore, (_s, event) => this.onStateChange(event));
    // A first install is not a recovery; only surface it when something was unreadable.
    if (report.problems.length > 0) this.meta.recovery = report;

    try {
      await this.restoreSession();
    } catch (err) {
      this.logError('startup sync', err);
    }
    this.reconcileSoon();
  }

  private async restoreSession(): Promise<void> {
    const session = await chrome.storage.session.get(Object.values(SESSION_KEYS));
    // storage.session is wiped on browser restart (and extension reload):
    // Chrome tab ids from before are then unreliable.
    const restarted = !session[SESSION_KEYS.browserSession];
    if (restarted) await chrome.storage.session.set({ [SESSION_KEYS.browserSession]: Date.now() });
    this.undoStack = (session[SESSION_KEYS.undo] as UndoEntry[] | undefined) ?? [];
    this.meta.suggestions = session[SESSION_KEYS.suggestions] as SuggestionBatch | undefined;
    this.meta.tabSuggestion = session[SESSION_KEYS.tabSuggestion] as UiMeta['tabSuggestion'];
    this.meta.aiStatus = session[SESSION_KEYS.aiStatus] as UiMeta['aiStatus'];
    this.errors.unshift(...((session[SESSION_KEYS.errors] as DiagnosticError[] | undefined) ?? []));
    this.refreshUndoMeta();

    await this.persistence.snapshot(); // fold any replayed journal events
    await this.queue.run(() => this.syncFromChrome(restarted));
  }

  logError(where: string, err: unknown) {
    const entry: DiagnosticError = { at: Date.now(), where, message: errorText(err) };
    console.warn(`[Chromotion] ${where}:`, err);
    this.errors.push(entry);
    if (this.errors.length > 30) this.errors.splice(0, this.errors.length - 30);
    void chrome.storage.session.set({ [SESSION_KEYS.errors]: this.errors }).catch(() => undefined);
  }

  private onStateChange(event?: JournalEvent) {
    this.broadcastSoon();
    if (!event) return;
    if (RECONCILE_TRIGGERS.has(event.type)) this.reconcileSoon();
    else if (event.type === 'TABS_SYNCED' && (event.payload.added.length > 0 || event.payload.updates.some((u) => 'chromeTabId' in u.patch))) {
      this.reconcileSoon();
    } else if (event.type === 'TAB_UPDATED' && ('windowId' in event.payload.patch || 'pinned' in event.payload.patch)) {
      this.reconcileSoon();
    }
  }

  // -------------------------------------------------------------------------
  // UI channel

  connect(port: chrome.runtime.Port) {
    this.ports.add(port);
    port.onDisconnect.addListener(() => this.ports.delete(port));
    void this.ready.then(() => this.postTo(port));
  }

  private postTo(port: chrome.runtime.Port) {
    const message: StateMessage = { type: 'STATE', state: this.state, meta: this.meta };
    try {
      port.postMessage(message);
    } catch {
      this.ports.delete(port);
    }
  }

  private broadcast() {
    for (const port of this.ports) this.postTo(port);
  }

  private setMeta(patch: Partial<UiMeta>) {
    this.meta = { ...this.meta, ...patch };
    this.broadcastSoon();
    this.persistSessionSoon();
  }

  private async persistSession() {
    await chrome.storage.session
      .set({
        [SESSION_KEYS.undo]: this.undoStack,
        [SESSION_KEYS.suggestions]: this.meta.suggestions ?? null,
        [SESSION_KEYS.tabSuggestion]: this.meta.tabSuggestion ?? null,
        [SESSION_KEYS.aiStatus]: this.meta.aiStatus ?? null,
      })
      .catch((err) => console.warn('[Chromotion] session persist failed', err));
  }

  // -------------------------------------------------------------------------
  // Helpers

  private byChromeId(chromeTabId: number): StoredTab | undefined {
    return this.state.tabs.find((t) => t.chromeTabId === chromeTabId);
  }

  private tab(id: string): StoredTab | undefined {
    return this.state.tabs.find((t) => t.id === id);
  }

  private canvas(id: string | undefined): Canvas | undefined {
    return this.state.canvases.find((c) => c.id === id);
  }

  private activeCanvasId(): string {
    return this.canvas(this.state.lastActiveCanvasId)?.id ?? this.state.canvases[0].id;
  }

  private nextPosition(canvasId: string): number {
    return this.state.tabs.reduce((m, t) => (t.canvasId === canvasId ? Math.max(m, t.position + 1) : m), 0);
  }

  private storedFromChrome(ct: ChromeTab, canvasId: string, position: number): StoredTab {
    const now = Date.now();
    const url = urlOf(ct) || 'chrome://newtab/';
    return {
      id: uid(),
      chromeTabId: ct.id,
      windowId: ct.windowId,
      url,
      title: ct.title || url,
      faviconUrl: ct.favIconUrl,
      canvasId,
      position,
      pinned: !!ct.pinned,
      active: !!ct.active,
      createdAt: now,
      lastVisitedAt: ct.active ? now : ((ct as { lastAccessed?: number }).lastAccessed ?? now),
    };
  }

  private chromePatch(st: StoredTab, ct: ChromeTab): Partial<StoredTab> {
    const patch: Partial<StoredTab> = {};
    const url = urlOf(ct);
    if (st.chromeTabId !== ct.id) patch.chromeTabId = ct.id;
    if (st.windowId !== ct.windowId) patch.windowId = ct.windowId;
    const sleeping = isSleeping(ct);
    if (url && url !== st.url) patch.url = url;
    if (!sleeping && ct.title && ct.title !== st.title) patch.title = ct.title;
    if (!sleeping && ct.favIconUrl && ct.favIconUrl !== st.faviconUrl) patch.faviconUrl = ct.favIconUrl;
    if (!!ct.pinned !== st.pinned) patch.pinned = !!ct.pinned;
    if (!!ct.active !== st.active) patch.active = !!ct.active;
    return patch;
  }

  /** Which canvas owns a Chrome tab group: majority of its member tabs, else by title. */
  private async canvasForGroup(groupId: number, excludeChromeTabId?: number): Promise<string | undefined> {
    const members = await ChromeTabsAdapter.tabsInGroup(groupId).catch(() => [] as ChromeTab[]);
    const counts = new Map<string, number>();
    for (const m of members) {
      if (m.id === excludeChromeTabId || m.id === undefined) continue;
      const st = this.byChromeId(m.id);
      if (st) counts.set(st.canvasId, (counts.get(st.canvasId) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top) return top;
    const group = await chrome.tabGroups.get(groupId).catch(() => undefined);
    return group?.title ? this.state.canvases.find((c) => c.name === group.title)?.id : undefined;
  }

  // -------------------------------------------------------------------------
  // Chrome -> state

  /**
   * Make state agree with the tabs Chrome actually has open. Matches by Chrome
   * tab id first (only trusted within one browser session), then by URL.
   */
  private async syncFromChrome(restarted: boolean): Promise<void> {
    const chromeTabs = (await ChromeTabsAdapter.normalTabs()).filter((t) => t.id !== undefined);
    const state = this.state;
    const byChrome = new Map(chromeTabs.map((t) => [t.id!, t]));
    const matched = new Map<string, ChromeTab>();
    const used = new Set<number>();

    for (const st of state.tabs) {
      if (st.chromeTabId === undefined) continue;
      const ct = byChrome.get(st.chromeTabId);
      if (!ct || used.has(ct.id!)) continue;
      if (restarted && urlOf(ct) !== st.url) continue;
      matched.set(st.id, ct);
      used.add(ct.id!);
    }

    const pendingByUrl = new Map<string, StoredTab[]>();
    const candidates = state.tabs
      .filter((t) => !matched.has(t.id))
      .sort(
        (a, b) =>
          Number(b.chromeTabId !== undefined) - Number(a.chromeTabId !== undefined) ||
          (a.canvasId === state.lastActiveCanvasId ? -1 : 0) - (b.canvasId === state.lastActiveCanvasId ? -1 : 0) ||
          b.lastVisitedAt - a.lastVisitedAt,
      );
    for (const st of candidates) pendingByUrl.set(st.url, [...(pendingByUrl.get(st.url) ?? []), st]);

    const groupCanvas = new Map<number, Map<string, number>>();
    const remember = (ct: ChromeTab, canvasId: string) => {
      if (ct.groupId === undefined || ct.groupId < 0) return;
      const m = groupCanvas.get(ct.groupId) ?? new Map<string, number>();
      m.set(canvasId, (m.get(canvasId) ?? 0) + 1);
      groupCanvas.set(ct.groupId, m);
    };

    for (const ct of chromeTabs) {
      if (used.has(ct.id!)) continue;
      const st = pendingByUrl.get(urlOf(ct))?.find((s) => !matched.has(s.id));
      if (st) {
        matched.set(st.id, ct);
        used.add(ct.id!);
      }
    }

    const updates: { tabId: string; patch: Partial<StoredTab> }[] = [];
    for (const [storedId, ct] of matched) {
      const st = state.tabs.find((t) => t.id === storedId)!;
      remember(ct, st.canvasId);
      const patch = this.chromePatch(st, ct);
      if (Object.keys(patch).length > 0) updates.push({ tabId: storedId, patch });
    }
    const detached = state.tabs.filter((t) => t.chromeTabId !== undefined && !matched.has(t.id)).map((t) => t.id);

    const groups = restarted ? await ChromeTabsAdapter.groups().catch(() => []) : [];
    const added: StoredTab[] = [];
    const positions = new Map<string, number>();
    for (const ct of chromeTabs) {
      if (used.has(ct.id!)) continue;
      let canvasId: string | undefined;
      if (ct.groupId !== undefined && ct.groupId >= 0) {
        const counts = groupCanvas.get(ct.groupId);
        canvasId = counts ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
        const title = groups.find((g) => g.id === ct.groupId)?.title;
        canvasId ??= title ? state.canvases.find((c) => c.name === title)?.id : undefined;
      }
      canvasId ??= this.activeCanvasId();
      const pos = positions.get(canvasId) ?? this.nextPosition(canvasId);
      positions.set(canvasId, pos + 1);
      added.push(this.storedFromChrome(ct, canvasId, pos));
    }

    if (updates.length || detached.length || added.length) {
      this.persistence.dispatch('TABS_SYNCED', { updates, added, detached });
    }
    await this.alignActiveCanvas();
  }

  /** Point lastActiveCanvasId at the canvas of the focused window's active tab. */
  private async alignActiveCanvas(): Promise<string> {
    try {
      const windowId = await ChromeTabsAdapter.focusedNormalWindowId();
      const [active] = await chrome.tabs.query({ active: true, windowId });
      const st = active?.id !== undefined ? this.byChromeId(active.id) : undefined;
      if (st && st.canvasId !== this.state.lastActiveCanvasId) {
        this.persistence.dispatch('CANVAS_SWITCHED', { canvasId: st.canvasId, at: Date.now() });
      }
    } catch {
      /* no window */
    }
    return this.activeCanvasId();
  }

  // -------------------------------------------------------------------------
  // State -> Chrome

  /** Keep tab groups (one per canvas per window) and tab positions in sync. */
  private async reconcile(): Promise<void> {
    const chromeTabs = (await ChromeTabsAdapter.normalTabs()).filter((t) => t.id !== undefined);
    this.refreshPositions(chromeTabs);
    if (!this.state.preferences.groupTabs) return;

    const groups = await ChromeTabsAdapter.groups();
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const windows = new Map<number, ChromeTab[]>();
    for (const ct of chromeTabs) windows.set(ct.windowId, [...(windows.get(ct.windowId) ?? []), ct]);

    for (const [windowId, wtabs] of windows) {
      const perCanvas = new Map<string, ChromeTab[]>();
      for (const ct of wtabs) {
        if (ct.pinned) continue;
        const st = this.byChromeId(ct.id!);
        if (st) perCanvas.set(st.canvasId, [...(perCanvas.get(st.canvasId) ?? []), ct]);
      }
      const claimed = new Set<number>();
      const ordered = [...perCanvas.entries()].sort((a, b) => b[1].length - a[1].length);
      for (const [canvasId, ctabs] of ordered) {
        const canvas = this.canvas(canvasId);
        if (!canvas) continue;
        const counts = new Map<number, number>();
        for (const ct of ctabs) {
          if (ct.groupId >= 0 && !claimed.has(ct.groupId) && groupById.get(ct.groupId)?.windowId === windowId) {
            counts.set(ct.groupId, (counts.get(ct.groupId) ?? 0) + 1);
          }
        }
        let groupId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        try {
          if (groupId === undefined) {
            groupId = await ChromeTabsAdapter.group(ctabs.map((c) => c.id!), undefined, windowId);
          } else {
            const strays = ctabs.filter((c) => c.groupId !== groupId).map((c) => c.id!);
            if (strays.length) await ChromeTabsAdapter.group(strays, groupId);
          }
        } catch (err) {
          // Chrome refuses grouping while a tab is dragged; retry a few times, then wait for the next change.
          if (++this.reconcileFailures <= 5) this.reconcileSoon();
          else this.logError('grouping', err);
          continue;
        }
        claimed.add(groupId);
        this.reconcileFailures = 0;
        const g = groupById.get(groupId);
        const color = canvas.accent ?? 'grey';
        if (!g || g.title !== canvas.name || g.color !== color) {
          await ChromeTabsAdapter.updateGroup(groupId, { title: canvas.name, color });
        }
      }
    }
  }

  /** Canvas order = Chrome order for open tabs, stored tabs after them. */
  private refreshPositions(chromeTabs: ChromeTab[]) {
    const windowRank = new Map([...new Set(chromeTabs.map((t) => t.windowId))].sort((a, b) => a - b).map((w, i) => [w, i]));
    const key = new Map(chromeTabs.map((t) => [t.id!, (windowRank.get(t.windowId) ?? 0) * 100_000 + t.index]));
    const updates: { tabId: string; patch: Partial<StoredTab> }[] = [];
    const byCanvas = new Map<string, StoredTab[]>();
    for (const t of this.state.tabs) byCanvas.set(t.canvasId, [...(byCanvas.get(t.canvasId) ?? []), t]);
    for (const list of byCanvas.values()) {
      const sorted = [...list].sort((a, b) => {
        const ka = a.chromeTabId !== undefined ? key.get(a.chromeTabId) : undefined;
        const kb = b.chromeTabId !== undefined ? key.get(b.chromeTabId) : undefined;
        if (ka !== undefined && kb !== undefined) return ka - kb;
        if (ka !== undefined) return -1;
        if (kb !== undefined) return 1;
        return a.position - b.position;
      });
      sorted.forEach((t, i) => {
        if (t.position !== i) updates.push({ tabId: t.id, patch: { position: i } });
      });
    }
    if (updates.length) this.persistence.dispatch('TABS_SYNCED', { updates, added: [], detached: [] });
  }

  private async applyCollapse(windowId: number, canvasId: string) {
    if (!this.state.preferences.groupTabs) return;
    const tabs = await chrome.tabs.query({ windowId });
    const owners = new Map<number, Map<string, number>>();
    for (const ct of tabs) {
      if (ct.groupId < 0 || ct.id === undefined) continue;
      const st = this.byChromeId(ct.id);
      if (!st) continue;
      const m = owners.get(ct.groupId) ?? new Map<string, number>();
      m.set(st.canvasId, (m.get(st.canvasId) ?? 0) + 1);
      owners.set(ct.groupId, m);
    }
    const groups = await chrome.tabGroups.query({ windowId });
    for (const g of groups) {
      const owner = [...(owners.get(g.id)?.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!owner) continue;
      const collapsed = owner !== canvasId;
      if (g.collapsed !== collapsed) await ChromeTabsAdapter.updateGroup(g.id, { collapsed });
    }
  }

  /**
   * Reopen stored tabs. With lazy loading every tab except `keepAwakeId` opens
   * as a lightweight sleeping page that loads the real URL only when viewed,
   * so opening a 100-tab canvas does not start 100 page loads at once.
   */
  private async openStoredTabs(tabs: StoredTab[], windowId: number, opts: { lazy?: boolean; keepAwakeId?: string } = {}): Promise<number[]> {
    const createdIds: number[] = [];
    const updates: { tabId: string; patch: Partial<StoredTab> }[] = [];
    const sorted = [...tabs].sort((a, b) => a.position - b.position);
    // Chrome handles extension calls in arrival order, so a batch issued
    // together still lands in canvas order — just without 100 round trips.
    const BATCH = 10;
    for (let i = 0; i < sorted.length; i += BATCH) {
      const batch = sorted.slice(i, i + BATCH);
      const created = await Promise.all(
        batch.map((t) => {
          const asleep = opts.lazy && t.id !== opts.keepAwakeId && isWebUrl(t.url);
          return ChromeTabsAdapter.create({
            windowId,
            url: asleep ? sleepUrl(extensionBase(), t.url, t.title) : isRestorableUrl(t.url) ? t.url : undefined,
            active: false,
            pinned: t.pinned,
          }).catch((err) => {
            console.warn('[Chromotion] could not reopen', t.url, err);
            return undefined;
          });
        }),
      );
      created.forEach((ct, j) => {
        if (ct?.id === undefined) return;
        createdIds.push(ct.id);
        updates.push({ tabId: batch[j].id, patch: { chromeTabId: ct.id, windowId: ct.windowId, active: false } });
      });
    }
    if (updates.length) this.persistence.dispatch('TABS_SYNCED', { updates, added: [], detached: [] });
    return createdIds;
  }

  async switchCanvas(canvasId: string, activateTabId?: string): Promise<void> {
    const canvas = this.canvas(canvasId);
    if (!canvas) throw new Error('Canvas not found');
    const prefs = this.state.preferences;
    const windowId = await ChromeTabsAdapter.focusedNormalWindowId();
    this.persistence.dispatch('CANVAS_SWITCHED', { canvasId, at: Date.now() });

    const own = this.state.tabs.filter((t) => t.canvasId === canvasId);
    // The tab we will land on: requested one, else the most recently visited.
    const landing =
      (activateTabId ? own.find((t) => t.id === activateTabId) : undefined) ??
      [...own].sort((a, b) => Number(b.chromeTabId !== undefined) - Number(a.chromeTabId !== undefined) || b.lastVisitedAt - a.lastVisitedAt)[0];
    const stored = own.filter((t) => t.chromeTabId === undefined);
    await this.openStoredTabs(stored, windowId, { lazy: prefs.lazyLoadRestoredTabs, keepAwakeId: landing?.id });

    if (!this.state.tabs.some((t) => t.canvasId === canvasId && t.chromeTabId !== undefined)) {
      const ct = await ChromeTabsAdapter.create({ windowId, active: true });
      this.persistence.dispatch('TAB_OPENED', { tab: this.storedFromChrome(ct, canvasId, this.nextPosition(canvasId)) });
    }
    await this.reconcile();

    const open = this.state.tabs.filter((t) => t.canvasId === canvasId && t.chromeTabId !== undefined);
    const target =
      open.find((t) => t.id === landing?.id) ??
      [...open].sort((a, b) => Number(b.windowId === windowId) - Number(a.windowId === windowId) || b.lastVisitedAt - a.lastVisitedAt)[0];
    const activeWindow = target?.windowId ?? windowId;
    if (target?.chromeTabId !== undefined) await ChromeTabsAdapter.activate(target.chromeTabId, target.windowId);

    if (prefs.switchMode === 'unload') {
      const leaving = this.state.tabs.filter(
        (t) => t.canvasId !== canvasId && t.chromeTabId !== undefined && t.windowId === activeWindow && !t.pinned,
      );
      if (leaving.length) {
        const ids = leaving.map((t) => t.chromeTabId!);
        ids.forEach((id) => this.ownRemovals.add(id));
        this.persistence.dispatch('TABS_DETACHED', { tabIds: leaving.map((t) => t.id) });
        await ChromeTabsAdapter.remove(ids);
      }
    } else {
      await this.applyCollapse(activeWindow, canvasId);
    }
  }

  // -------------------------------------------------------------------------
  // Chrome event handlers (all serialized)

  onTabCreated = (ct: ChromeTab) =>
    this.serial(async () => {
      if (ct.id === undefined || this.byChromeId(ct.id)) return;
      if (!(await ChromeTabsAdapter.isNormalWindow(ct.windowId))) return;
      let canvasId: string | undefined;
      if (ct.groupId !== undefined && ct.groupId >= 0) canvasId = await this.canvasForGroup(ct.groupId, ct.id);
      const opener = ct.openerTabId !== undefined ? this.byChromeId(ct.openerTabId) : undefined;
      canvasId ??= opener?.canvasId ?? this.activeCanvasId();
      const tab = this.storedFromChrome(ct, canvasId, this.nextPosition(canvasId));
      if (opener) this.openers.set(tab.id, opener.id);
      this.persistence.dispatch('TAB_OPENED', { tab });
    });

  onTabUpdated = (tabId: number, info: chrome.tabs.OnUpdatedInfo, ct: ChromeTab) =>
    this.serial(async () => {
      const st = this.byChromeId(tabId);
      if (!st) {
        if (info.status || info.url) {
          await this.ready;
          if (!this.byChromeId(tabId) && (await ChromeTabsAdapter.isNormalWindow(ct.windowId))) {
            const canvasId = this.activeCanvasId();
            this.persistence.dispatch('TAB_OPENED', { tab: this.storedFromChrome(ct, canvasId, this.nextPosition(canvasId)) });
          }
        }
        return;
      }
      const patch: Partial<StoredTab> = {};
      const url = urlOf(ct);
      const sleeping = isSleeping(ct);
      if (url && url !== st.url) patch.url = url;
      if (!sleeping && ct.title && ct.title !== st.title) patch.title = ct.title;
      if (!sleeping && info.favIconUrl !== undefined && ct.favIconUrl !== st.faviconUrl) patch.faviconUrl = ct.favIconUrl;
      if (info.pinned !== undefined && !!ct.pinned !== st.pinned) patch.pinned = !!ct.pinned;
      if (Object.keys(patch).length) this.persistence.dispatch('TAB_UPDATED', { tabId: st.id, patch });

      if (info.groupId !== undefined) {
        if (info.groupId >= 0) {
          const owner = await this.canvasForGroup(info.groupId, tabId);
          if (owner && owner !== st.canvasId) this.persistence.dispatch('TAB_ASSIGNED', { tabIds: [st.id], canvasId: owner });
        } else if (!ct.pinned) {
          this.reconcileSoon();
        }
      }
      if (info.status === 'complete') this.maybeSuggestForTab(st.id);
    });

  onTabRemoved = (tabId: number, info: chrome.tabs.OnRemovedInfo) =>
    this.serial(async () => {
      if (this.ownRemovals.delete(tabId)) return;
      const st = this.byChromeId(tabId);
      if (!st) return;
      // Closing a window (or quitting Chrome) keeps its tabs in their canvas.
      if (info.isWindowClosing) this.persistence.dispatch('TABS_DETACHED', { tabIds: [st.id] });
      else this.persistence.dispatch('TAB_CLOSED', { tabId: st.id });
      if (this.meta.tabSuggestion?.tabId === st.id) this.setMeta({ tabSuggestion: undefined });
    });

  onTabActivated = (info: chrome.tabs.OnActivatedInfo) =>
    this.serial(async () => {
      const st = this.byChromeId(info.tabId);
      if (!st) return;
      const now = Date.now();
      const updates = this.state.tabs
        .filter((t) => t.active && t.windowId === info.windowId && t.id !== st.id)
        .map((t) => ({ tabId: t.id, patch: { active: false } as Partial<StoredTab> }));
      updates.push({ tabId: st.id, patch: { active: true, lastVisitedAt: now } });
      this.persistence.dispatch('TABS_SYNCED', { updates, added: [], detached: [] });
      if (st.canvasId !== this.state.lastActiveCanvasId) {
        this.persistence.dispatch('CANVAS_SWITCHED', { canvasId: st.canvasId, at: now });
      }
    });

  onTabAttached = (tabId: number, info: chrome.tabs.OnAttachedInfo) =>
    this.serial(async () => {
      const st = this.byChromeId(tabId);
      if (st && st.windowId !== info.newWindowId) {
        this.persistence.dispatch('TAB_UPDATED', { tabId: st.id, patch: { windowId: info.newWindowId } });
      }
    });

  onTabMoved = () => this.reconcileSoon();

  onTabReplaced = (addedTabId: number, removedTabId: number) =>
    this.serial(async () => {
      const st = this.byChromeId(removedTabId);
      if (st) this.persistence.dispatch('TAB_UPDATED', { tabId: st.id, patch: { chromeTabId: addedTabId } });
    });

  onGroupUpdated = (group: chrome.tabGroups.TabGroup) =>
    this.serial(async () => {
      if (!this.state.preferences.groupTabs) return;
      const owner = this.canvas(await this.canvasForGroup(group.id));
      if (!owner) return;
      // Renaming / recolouring a group in Chrome's UI renames / recolours the canvas.
      if (group.title && group.title !== owner.name) {
        this.persistence.dispatch('CANVAS_RENAMED', { canvasId: owner.id, name: group.title.slice(0, 120) });
      }
      if (group.color && group.color !== (owner.accent ?? 'grey')) {
        this.persistence.dispatch('CANVAS_UPDATED', { canvasId: owner.id, patch: { accent: group.color } });
      }
    });

  onWindowFocused = (windowId: number) =>
    this.serial(async () => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) return;
      const [active] = await chrome.tabs.query({ active: true, windowId });
      const st = active?.id !== undefined ? this.byChromeId(active.id) : undefined;
      if (st && st.canvasId !== this.state.lastActiveCanvasId) {
        this.persistence.dispatch('CANVAS_SWITCHED', { canvasId: st.canvasId, at: Date.now() });
      }
    });

  private serial(task: () => Promise<void>): Promise<void> {
    return this.ready
      .then(() => this.queue.run(task))
      .catch((err) => this.logError('tab event', err));
  }

  private maybeSuggestForTab(storedId: string) {
    const prefs = this.state.preferences;
    const st = this.tab(storedId);
    if (!prefs.suggestForNewTabs || !st || this.suggestedFor.has(storedId) || this.openers.has(storedId)) return;
    if (Date.now() - st.createdAt > NEW_TAB_SUGGESTION_WINDOW_MS || !isShareableWithCloud(st)) return;
    this.suggestedFor.add(storedId);
    const summaries = summarizeCanvases(this.state.canvases, this.state.tabs.filter((t) => t.id !== storedId));
    void this.ai.suggestForTab(toTabMetadata(st, { includePath: true }), summaries).then((s) => {
      const current = this.tab(storedId);
      const target = this.canvas(s.canvasId);
      if (!current || !target || target.id === current.canvasId || s.confidence < 0.55) return;
      this.setMeta({
        tabSuggestion: { tabId: storedId, tabTitle: current.title, canvasId: target.id, canvasName: target.name, reason: s.reason },
      });
    });
  }

  // -------------------------------------------------------------------------
  // Undo

  private pushUndo(label: string) {
    const s = this.state;
    this.undoStack.push({
      label,
      at: Date.now(),
      canvases: structuredClone(s.canvases),
      tabs: structuredClone(s.tabs),
      lastActiveCanvasId: s.lastActiveCanvasId,
    });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.refreshUndoMeta();
  }

  private refreshUndoMeta() {
    const top = this.undoStack[this.undoStack.length - 1];
    this.setMeta({ undo: top ? { label: top.label, at: top.at } : undefined });
  }

  private async undo(): Promise<void> {
    const entry = this.undoStack.pop();
    this.refreshUndoMeta();
    if (!entry) throw new Error('Nothing to undo');
    const wasOpen = new Set(entry.tabs.filter((t) => t.chromeTabId !== undefined).map((t) => t.id));
    this.persistence.dispatch('STATE_RESTORED', {
      canvases: entry.canvases,
      tabs: entry.tabs,
      lastActiveCanvasId: entry.lastActiveCanvasId,
      reason: `Undo: ${entry.label}`,
    });
    await this.syncFromChrome(false);
    // Tabs that were open before (e.g. undoing "close") come back if their canvas is active.
    const active = this.activeCanvasId();
    const reopen = this.state.tabs.filter((t) => wasOpen.has(t.id) && t.chromeTabId === undefined && t.canvasId === active);
    if (reopen.length) await this.openStoredTabs(reopen, await ChromeTabsAdapter.focusedNormalWindowId());
    await this.reconcile();
    await this.collapseAroundActive();
  }

  private async collapseAroundActive() {
    if (!this.state.preferences.groupTabs) return;
    const windowId = await ChromeTabsAdapter.focusedNormalWindowId();
    await this.applyCollapse(windowId, await this.alignActiveCanvas());
  }

  // -------------------------------------------------------------------------
  // Commands from UI pages

  async handle(command: Command): Promise<unknown> {
    await this.ready;
    const result = await this.dispatchCommand(command);
    // Write-ahead: the UI only hears "done" once the change is on disk.
    await this.persistence.flushJournal();
    return result;
  }

  private async dispatchCommand(command: Command): Promise<unknown> {
    switch (command.type) {
      // AI work runs outside the queue so tab events never wait on a network call.
      case 'ORGANIZE':
        return this.organize(command.scope, command.canvasId);
      case 'TEST_PROVIDER':
        return this.testProvider(command.provider);
      case 'SUGGEST_NAME': {
        const tabs = this.state.tabs.filter((t) => t.canvasId === command.canvasId && isShareableWithCloud(t));
        const meta = tabs.map((t) => toTabMetadata(t, { includePath: true }));
        const res = await this.ai.generateName(meta);
        await this.queue.run(() => {
          this.pushUndo('Rename canvas');
          this.persistence.dispatch('CANVAS_RENAMED', { canvasId: command.canvasId, name: res.result });
        });
        return { name: res.result, providerLabel: res.providerLabel };
      }
      default:
        return this.queue.run(() => this.handleSerial(command));
    }
  }

  private async handleSerial(command: Command): Promise<unknown> {
    const s = this.state;
    switch (command.type) {
      case 'SWITCH_CANVAS':
        return this.switchCanvas(command.canvasId);

      case 'CREATE_CANVAS': {
        const tabIds = (command.tabIds ?? []).filter((id) => this.tab(id));
        if (tabIds.length) this.pushUndo('New canvas');
        let name = command.name?.trim();
        if (!name && tabIds.length) {
          name = await this.ai.local.generateCanvasName(
            tabIds.map((id) => toTabMetadata(this.tab(id)!, { includePath: true })),
          );
        }
        name ||= `Canvas ${s.canvases.length + 1}`;
        const canvas = createCanvas(name, s.canvases.length, command.accent ?? nextAccent(s.canvases.map((c) => c.accent)));
        this.persistence.dispatch('CANVAS_CREATED', { canvas });
        if (tabIds.length) {
          this.persistence.dispatch('TAB_ASSIGNED', { tabIds, canvasId: canvas.id });
          await this.reconcile();
          await this.collapseAroundActive();
        }
        if (command.switchTo) await this.switchCanvas(canvas.id);
        return { canvasId: canvas.id };
      }

      case 'RENAME_CANVAS': {
        const name = command.name.trim().slice(0, 120);
        const canvas = this.canvas(command.canvasId);
        if (!name || !canvas || canvas.name === name) return;
        this.pushUndo('Rename canvas');
        this.persistence.dispatch('CANVAS_RENAMED', { canvasId: command.canvasId, name });
        return;
      }

      case 'UPDATE_CANVAS':
        if (!this.canvas(command.canvasId)) throw new Error('Canvas not found');
        this.persistence.dispatch('CANVAS_UPDATED', { canvasId: command.canvasId, patch: command.patch });
        return;

      case 'DELETE_CANVAS': {
        const canvas = this.canvas(command.canvasId);
        if (!canvas) throw new Error('Canvas not found');
        if (s.canvases.length <= 1) throw new Error('A workspace needs at least one canvas');
        this.pushUndo(`Delete “${canvas.name}”`);
        if (this.activeCanvasId() === canvas.id) {
          const next = s.canvases
            .filter((c) => c.id !== canvas.id && !c.archived)
            .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0] ?? s.canvases.find((c) => c.id !== canvas.id)!;
          await this.switchCanvas(next.id);
        }
        const open = this.state.tabs.filter((t) => t.canvasId === canvas.id && t.chromeTabId !== undefined);
        open.forEach((t) => this.ownRemovals.add(t.chromeTabId!));
        this.persistence.dispatch('CANVAS_DELETED', { canvasId: canvas.id });
        await ChromeTabsAdapter.remove(open.map((t) => t.chromeTabId!));
        return;
      }

      case 'REORDER_CANVASES':
        this.pushUndo('Reorder canvases');
        this.persistence.dispatch('CANVASES_REORDERED', { orderedIds: command.orderedIds });
        return;

      case 'MOVE_TABS':
        return this.moveTabs(command.tabIds, command.canvasId);

      case 'MOVE_CURRENT_TAB': {
        const windowId = await ChromeTabsAdapter.focusedNormalWindowId();
        const [active] = await chrome.tabs.query({ active: true, windowId });
        const st = active?.id !== undefined ? this.byChromeId(active.id) : undefined;
        if (!st) throw new Error('The current tab is not tracked yet');
        return this.moveTabs([st.id], command.canvasId);
      }

      case 'OPEN_TAB': {
        const st = this.tab(command.tabId);
        if (!st) throw new Error('Tab not found');
        if (st.canvasId !== this.activeCanvasId()) return this.switchCanvas(st.canvasId, st.id);
        if (st.chromeTabId !== undefined) return ChromeTabsAdapter.activate(st.chromeTabId, st.windowId);
        const windowId = await ChromeTabsAdapter.focusedNormalWindowId();
        const [id] = await this.openStoredTabs([st], windowId);
        if (id !== undefined) await ChromeTabsAdapter.activate(id, windowId);
        await this.reconcile();
        return;
      }

      case 'CLOSE_TABS': {
        const tabs = command.tabIds.map((id) => this.tab(id)).filter((t): t is StoredTab => !!t);
        if (!tabs.length) return;
        this.pushUndo(tabs.length === 1 ? 'Close tab' : `Close ${tabs.length} tabs`);
        const ids = tabs.filter((t) => t.chromeTabId !== undefined).map((t) => t.chromeTabId!);
        ids.forEach((id) => this.ownRemovals.add(id));
        this.persistence.dispatch('TAB_REMOVED', { tabIds: tabs.map((t) => t.id) });
        await ChromeTabsAdapter.remove(ids);
        return;
      }

      case 'APPLY_SUGGESTIONS': {
        const drafts = command.suggestions.filter((d) => d.tabIds.some((id) => this.tab(id)));
        if (!drafts.length) return;
        this.pushUndo(drafts.length === 1 ? `Organize into “${drafts[0].name}”` : `Organize into ${drafts.length} canvases`);
        const accents = s.canvases.map((c) => c.accent);
        let order = s.canvases.length;
        for (const d of drafts) {
          const ids = d.tabIds.filter((id) => this.tab(id));
          let target = this.canvas(d.existingCanvasId)?.id;
          if (!target) {
            const canvas = createCanvas(d.name, order++, nextAccent(accents));
            canvas.description = d.description;
            accents.push(canvas.accent);
            this.persistence.dispatch('CANVAS_CREATED', { canvas });
            target = canvas.id;
          }
          this.persistence.dispatch('TAB_ASSIGNED', { tabIds: ids, canvasId: target });
        }
        this.setMeta({ suggestions: undefined });
        await this.reconcile();
        await this.collapseAroundActive();
        return;
      }

      case 'DISMISS_SUGGESTIONS':
        this.setMeta({ suggestions: undefined });
        return;

      case 'ACCEPT_TAB_SUGGESTION': {
        const sug = this.meta.tabSuggestion;
        this.setMeta({ tabSuggestion: undefined });
        if (sug && this.tab(sug.tabId) && this.canvas(sug.canvasId)) await this.moveTabs([sug.tabId], sug.canvasId);
        return;
      }

      case 'DISMISS_TAB_SUGGESTION':
        this.setMeta({ tabSuggestion: undefined });
        return;

      case 'UNDO':
        return this.undo();

      case 'UPDATE_PREFERENCES': {
        const before = s.preferences;
        this.persistence.dispatch('PREFERENCES_UPDATED', { patch: command.patch });
        const after = this.state.preferences;
        if (before.groupTabs && !after.groupTabs) {
          const ids = this.state.tabs.filter((t) => t.chromeTabId !== undefined && !t.pinned).map((t) => t.chromeTabId!);
          if (ids.length) await chrome.tabs.ungroup(ids as [number, ...number[]]).catch(() => undefined);
        } else if (!before.groupTabs && after.groupTabs) {
          await this.reconcile();
          await this.collapseAroundActive();
        }
        return;
      }

      case 'EXPORT':
        await this.persistence.flush();
        return { text: command.format === 'json' ? exportJson(this.state) : exportCsv(this.state) };

      case 'IMPORT_JSON': {
        const imported = importJson(command.text);
        await this.recovery.createBackup(this.state, 'Before JSON import');
        this.pushUndo('Import backup');
        this.persistence.dispatch('STATE_RESTORED', {
          canvases: imported.canvases,
          tabs: imported.tabs,
          lastActiveCanvasId: imported.lastActiveCanvasId,
          reason: 'JSON import',
        });
        await this.syncFromChrome(true);
        await this.reconcile();
        return { canvases: imported.canvases.length, tabs: imported.tabs.length };
      }

      case 'IMPORT_CSV': {
        const res = importCsv(command.text, this.state);
        if (res.canvases.length || res.tabs.length) {
          this.pushUndo('Import CSV');
          this.persistence.dispatch('STATE_RESTORED', {
            canvases: [...this.state.canvases, ...res.canvases],
            tabs: [...this.state.tabs, ...res.tabs],
            lastActiveCanvasId: this.state.lastActiveCanvasId,
            reason: 'CSV import',
          });
        }
        return {
          canvases: res.canvases.length,
          tabs: res.tabs.length,
          skippedDuplicates: res.skippedDuplicates,
          skippedInvalid: res.skippedInvalid,
        };
      }

      case 'LIST_BACKUPS':
        return (await this.recovery.listBackups()).map(({ state: _state, ...rest }): BackupListItem => rest);

      case 'CREATE_BACKUP': {
        const { state: _state, ...rest } = await this.recovery.createBackup(this.state, 'Manual backup');
        this.lastBackupSeq = this.state.lastSeq;
        return rest;
      }

      case 'RESTORE_BACKUP': {
        const backup = (await this.recovery.listBackups()).find((b) => b.id === command.backupId);
        if (!backup) throw new Error('Backup not found');
        await this.recovery.createBackup(this.state, 'Before restore');
        this.pushUndo('Restore workspace');
        this.persistence.dispatch('STATE_RESTORED', {
          canvases: backup.state.canvases,
          tabs: backup.state.tabs,
          lastActiveCanvasId: backup.state.lastActiveCanvasId,
          reason: `Restore backup ${new Date(backup.createdAt).toISOString()}`,
        });
        await this.syncFromChrome(true);
        await this.reconcile();
        return;
      }

      case 'DIAGNOSTICS':
        return {
          version: chrome.runtime.getManifest().version,
          browser: navigator.userAgent,
          canvases: s.canvases.length,
          tabs: s.tabs.length,
          openTabs: s.tabs.filter((t) => t.chromeTabId !== undefined).length,
          storageBytes: await chrome.storage.local.getBytesInUse(null).catch(() => -1),
          errors: [...this.errors].reverse(),
        };

      default:
        throw new Error(`Unknown command ${(command as { type: string }).type}`);
    }
  }

  private async moveTabs(tabIds: string[], canvasId: string): Promise<void> {
    const target = this.canvas(canvasId);
    if (!target) throw new Error('Canvas not found');
    const tabs = tabIds.map((id) => this.tab(id)).filter((t): t is StoredTab => !!t && t.canvasId !== canvasId);
    if (!tabs.length) return;
    this.pushUndo(tabs.length === 1 ? `Move to “${target.name}”` : `Move ${tabs.length} tabs to “${target.name}”`);
    this.persistence.dispatch('TAB_ASSIGNED', { tabIds: tabs.map((t) => t.id), canvasId });

    // Sending the tab you are looking at to another canvas: stay in the current
    // canvas and focus its most recent tab instead.
    const active = this.activeCanvasId();
    const windowId = await ChromeTabsAdapter.focusedNormalWindowId();
    const movedActive = canvasId !== active && tabs.some((t) => t.active && t.windowId === windowId);
    if (movedActive) {
      const fallback = this.state.tabs
        .filter((t) => t.canvasId === active && t.chromeTabId !== undefined && t.windowId === windowId)
        .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)[0];
      if (fallback) await ChromeTabsAdapter.activate(fallback.chromeTabId!);
      else {
        const ct = await ChromeTabsAdapter.create({ windowId, active: true });
        this.persistence.dispatch('TAB_OPENED', { tab: this.storedFromChrome(ct, active, this.nextPosition(active)) });
      }
      // Activation events are queued behind us; pin the canvas explicitly.
      this.persistence.dispatch('CANVAS_SWITCHED', { canvasId: active, at: Date.now() });
    }
    await this.reconcile();
    if (this.state.preferences.groupTabs) await this.applyCollapse(windowId, active);
  }

  private async organize(scope: 'canvas' | 'all', canvasId?: string): Promise<SuggestionBatch> {
    const s = this.state;
    const scopeCanvas = scope === 'canvas' ? (this.canvas(canvasId)?.id ?? this.activeCanvasId()) : undefined;
    const archived = new Set(s.canvases.filter((c) => c.archived).map((c) => c.id));
    const tabs = s.tabs.filter((t) => (scopeCanvas ? t.canvasId === scopeCanvas : !archived.has(t.canvasId)) && isShareableWithCloud(t));
    // Everything stays on this computer (heuristics or a localhost model), so full metadata is fine.
    const meta = tabs.map((t) => toTabMetadata(t, { includePath: true, openerId: this.openers.get(t.id) }));
    const res = await this.ai.organize(meta, summarizeCanvases(s.canvases, s.tabs));
    const batch: SuggestionBatch = {
      id: uid(),
      createdAt: Date.now(),
      scopeCanvasId: scopeCanvas,
      suggestions: res.result,
      providerLabel: res.providerLabel,
      model: res.model,
      fellBackToLocal: res.fellBackToLocal,
      errors: res.errors,
    };
    this.setMeta({
      suggestions: batch.suggestions.length ? batch : undefined,
      aiStatus: {
        lastProvider: res.providerLabel,
        lastError: res.errors[res.errors.length - 1],
        lastRunAt: Date.now(),
        fellBackToLocal: res.fellBackToLocal,
      },
    });
    return batch;
  }

  private async testProvider(config: Parameters<AiGroupingService['createProvider']>[0]): Promise<ProviderTestResult> {
    const started = Date.now();
    const probe = this.ai.createProvider({ ...config, enabled: true });
    const model = config.model || pickModel(await probe.listModels(), false);
    if (!model) throw new Error('No free chat model found for this provider');
    const tester = this.ai.createProvider({ ...config, enabled: true, model });
    // Synthetic tabs only: testing a provider never sends your real tabs.
    const sampleName = await tester.generateCanvasName([
      { id: 'a', title: 'Quick start – React', hostname: 'react.dev', createdAt: 0 },
      { id: 'b', title: 'useEffect – React Reference', hostname: 'react.dev', createdAt: 0 },
      { id: 'c', title: 'Getting Started | Vite', hostname: 'vite.dev', createdAt: 0 },
    ]);
    return { model, sampleName, latencyMs: Date.now() - started };
  }

  // -------------------------------------------------------------------------
  // Maintenance

  async autoBackup(reason = 'Automatic backup'): Promise<void> {
    await this.ready;
    if (this.state.lastSeq === this.lastBackupSeq) return;
    await this.recovery.createBackup(this.state, reason);
    this.lastBackupSeq = this.state.lastSeq;
  }

  async flush(): Promise<void> {
    await this.ready;
    await this.persistence.flush();
  }
}
