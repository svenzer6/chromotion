import { originPattern } from '../features/ai/catalog';
import { ACCENTS } from '../lib/colors';
import { uid } from '../lib/id';
import {
  SCHEMA_VERSION,
  type Accent,
  type AiProviderConfig,
  type Canvas,
  type PersistedState,
  type Preferences,
  type StoredTab,
} from '../types';

export const STORAGE_KEYS = {
  state: 'tc:state',
  journal: 'tc:journal',
  backups: 'tc:backups',
  modelCache: 'tc:modelCache',
} as const;

export const SESSION_KEYS = {
  browserSession: 'tc:browserSession',
  undo: 'tc:undo',
  suggestions: 'tc:suggestions',
  tabSuggestion: 'tc:tabSuggestion',
  aiStatus: 'tc:aiStatus',
  providerCooldown: 'tc:providerCooldown',
  errors: 'tc:errors',
} as const;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  switchMode: 'collapse',
  groupTabs: true,
  lazyLoadRestoredTabs: true,
  suggestForNewTabs: true,
  ai: {
    enabled: true,
    providers: [],
  },
};

export const createCanvas = (name: string, order: number, accent?: Accent, now = Date.now()): Canvas => ({
  id: uid(),
  name: name.trim() || 'Untitled',
  accent,
  createdAt: now,
  updatedAt: now,
  lastOpenedAt: now,
  order,
  pinned: false,
  archived: false,
});

export const createInitialState = (now = Date.now()): PersistedState => {
  const inbox = createCanvas('Inbox', 0, 'blue', now);
  return {
    schemaVersion: SCHEMA_VERSION,
    canvases: [inbox],
    tabs: [],
    lastActiveCanvasId: inbox.id,
    preferences: structuredClone(DEFAULT_PREFERENCES),
    lastSnapshotAt: now,
    lastSeq: 0,
  };
};

// ---------------------------------------------------------------------------
// Validation: anything read from storage or an import file is untrusted.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const accent = (v: unknown): Accent | undefined => (ACCENTS.includes(v as Accent) ? (v as Accent) : undefined);

const sanitizeCanvas = (v: unknown, i: number): Canvas | undefined => {
  if (!isObj(v)) return undefined;
  const id = str(v.id);
  if (!id) return undefined;
  const now = Date.now();
  return {
    id,
    name: str(v.name, 'Untitled').slice(0, 120) || 'Untitled',
    icon: optStr(v.icon),
    accent: accent(v.accent),
    createdAt: num(v.createdAt, now),
    updatedAt: num(v.updatedAt, now),
    lastOpenedAt: num(v.lastOpenedAt, 0),
    order: num(v.order, i),
    pinned: bool(v.pinned),
    archived: bool(v.archived),
    description: optStr(v.description)?.slice(0, 500),
  };
};

const sanitizeTab = (v: unknown, canvasIds: Set<string>, fallbackCanvas: string): StoredTab | undefined => {
  if (!isObj(v)) return undefined;
  const id = str(v.id);
  const url = str(v.url);
  if (!id || !url) return undefined;
  const canvasId = canvasIds.has(str(v.canvasId)) ? str(v.canvasId) : fallbackCanvas;
  const now = Date.now();
  return {
    id,
    chromeTabId: typeof v.chromeTabId === 'number' ? v.chromeTabId : undefined,
    windowId: typeof v.windowId === 'number' ? v.windowId : undefined,
    url: url.slice(0, 8192),
    title: str(v.title).slice(0, 500),
    faviconUrl: optStr(v.faviconUrl),
    canvasId,
    position: num(v.position),
    pinned: bool(v.pinned),
    active: bool(v.active),
    createdAt: num(v.createdAt, now),
    lastVisitedAt: num(v.lastVisitedAt, 0),
  };
};

const sanitizeProvider = (v: unknown): AiProviderConfig | undefined => {
  // Only keyless servers on this computer are supported; older cloud configs are dropped.
  if (!isObj(v) || !str(v.id) || !originPattern(str(v.baseUrl))) return undefined;
  return {
    id: str(v.id),
    presetId: str(v.presetId, 'custom'),
    label: str(v.label, 'Provider'),
    kind: 'openai-compatible',
    baseUrl: str(v.baseUrl),
    model: optStr(v.model),
    enabled: bool(v.enabled, true),
  };
};

export const sanitizePreferences = (v: unknown): Preferences => {
  const d = DEFAULT_PREFERENCES;
  if (!isObj(v)) return structuredClone(d);
  const ai = isObj(v.ai) ? v.ai : {};
  return {
    theme: v.theme === 'light' || v.theme === 'dark' ? v.theme : 'system',
    switchMode: v.switchMode === 'unload' ? 'unload' : 'collapse',
    groupTabs: bool(v.groupTabs, d.groupTabs),
    lazyLoadRestoredTabs: bool(v.lazyLoadRestoredTabs, d.lazyLoadRestoredTabs),
    suggestForNewTabs: bool(v.suggestForNewTabs, d.suggestForNewTabs),
    ai: {
      enabled: bool(ai.enabled, d.ai.enabled),
      providers: Array.isArray(ai.providers)
        ? ai.providers.map(sanitizeProvider).filter((p): p is AiProviderConfig => !!p)
        : [],
    },
  };
};

/**
 * Validates and migrates any persisted/imported state. Throws only when the
 * input is not recognisable as Chromotion state at all.
 */
export const migrateState = (raw: unknown): PersistedState => {
  if (!isObj(raw) || !Array.isArray(raw.canvases) || !Array.isArray(raw.tabs)) {
    throw new Error('Not a Chromotion state object');
  }
  const version = num(raw.schemaVersion, 0);
  if (version > SCHEMA_VERSION) throw new Error(`State schema v${version} is newer than this extension (v${SCHEMA_VERSION})`);

  const seen = new Set<string>();
  let canvases = raw.canvases
    .map(sanitizeCanvas)
    .filter((c): c is Canvas => !!c && !seen.has(c.id) && !!seen.add(c.id));
  if (canvases.length === 0) canvases = [createCanvas('Inbox', 0, 'blue')];
  canvases = canvases.sort((a, b) => a.order - b.order).map((c, i) => ({ ...c, order: i }));

  const canvasIds = new Set(canvases.map((c) => c.id));
  const seenTabs = new Set<string>();
  const tabs = raw.tabs
    .map((t) => sanitizeTab(t, canvasIds, canvases[0].id))
    .filter((t): t is StoredTab => !!t && !seenTabs.has(t.id) && !!seenTabs.add(t.id));

  const preferences = sanitizePreferences(raw.preferences);

  const lastActive = str(raw.lastActiveCanvasId);
  return {
    schemaVersion: SCHEMA_VERSION,
    canvases,
    tabs,
    lastActiveCanvasId: canvasIds.has(lastActive) ? lastActive : canvases[0].id,
    preferences,
    lastSnapshotAt: num(raw.lastSnapshotAt, Date.now()),
    lastSeq: num(raw.lastSeq, 0),
  };
};
