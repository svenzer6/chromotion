import type { JournalEvent, PersistedState, StoredTab } from '../types';

// Pure reducer: (state, event) -> state. Replaying the journal on top of the
// last snapshot must always yield the same state, so no Date.now() / random
// values are generated here — events carry everything they need.

const renumber = (tabs: StoredTab[], canvasId: string): StoredTab[] => {
  const inCanvas = tabs.filter((t) => t.canvasId === canvasId).sort((a, b) => a.position - b.position);
  const pos = new Map(inCanvas.map((t, i) => [t.id, i]));
  return tabs.map((t) => (pos.has(t.id) && pos.get(t.id) !== t.position ? { ...t, position: pos.get(t.id)! } : t));
};

export const applyEvent = (state: PersistedState, event: JournalEvent): PersistedState => {
  const s: PersistedState = { ...state, lastSeq: Math.max(state.lastSeq, event.seq) };
  switch (event.type) {
    case 'CANVAS_CREATED': {
      if (s.canvases.some((c) => c.id === event.payload.canvas.id)) return s;
      return { ...s, canvases: [...s.canvases, event.payload.canvas] };
    }
    case 'CANVAS_RENAMED': {
      const { canvasId, name } = event.payload;
      return {
        ...s,
        canvases: s.canvases.map((c) => (c.id === canvasId ? { ...c, name, updatedAt: event.timestamp } : c)),
      };
    }
    case 'CANVAS_UPDATED': {
      const { canvasId, patch } = event.payload;
      return {
        ...s,
        canvases: s.canvases.map((c) => (c.id === canvasId ? { ...c, ...patch, updatedAt: event.timestamp } : c)),
      };
    }
    case 'CANVAS_DELETED': {
      const { canvasId } = event.payload;
      const canvases = s.canvases.filter((c) => c.id !== canvasId);
      if (canvases.length === 0) return s; // never delete the last canvas
      return {
        ...s,
        canvases: canvases.map((c, i) => ({ ...c, order: i })),
        tabs: s.tabs.filter((t) => t.canvasId !== canvasId),
        lastActiveCanvasId: s.lastActiveCanvasId === canvasId ? canvases[0].id : s.lastActiveCanvasId,
      };
    }
    case 'CANVASES_REORDERED': {
      const index = new Map(event.payload.orderedIds.map((id, i) => [id, i]));
      const canvases = [...s.canvases]
        .sort((a, b) => (index.get(a.id) ?? 1e9 + a.order) - (index.get(b.id) ?? 1e9 + b.order))
        .map((c, i) => ({ ...c, order: i }));
      return { ...s, canvases };
    }
    case 'CANVAS_SWITCHED': {
      const { canvasId, at } = event.payload;
      if (!s.canvases.some((c) => c.id === canvasId)) return s;
      return {
        ...s,
        lastActiveCanvasId: canvasId,
        canvases: s.canvases.map((c) => (c.id === canvasId ? { ...c, lastOpenedAt: at, archived: false } : c)),
      };
    }
    case 'TAB_OPENED': {
      const { tab } = event.payload;
      if (s.tabs.some((t) => t.id === tab.id)) return s;
      const canvasId = s.canvases.some((c) => c.id === tab.canvasId) ? tab.canvasId : s.canvases[0].id;
      return { ...s, tabs: [...s.tabs, { ...tab, canvasId }] };
    }
    case 'TAB_ASSIGNED': {
      const { tabIds, canvasId } = event.payload;
      if (!s.canvases.some((c) => c.id === canvasId)) return s;
      const ids = new Set(tabIds);
      const affected = new Set<string>([canvasId]);
      let next = s.tabs.reduce((max, t) => (t.canvasId === canvasId ? Math.max(max, t.position + 1) : max), 0);
      const tabs = s.tabs.map((t) => {
        if (!ids.has(t.id) || t.canvasId === canvasId) return t;
        affected.add(t.canvasId);
        return { ...t, canvasId, position: next++ };
      });
      let result = tabs;
      for (const c of affected) result = renumber(result, c);
      return { ...s, tabs: result };
    }
    case 'TAB_MOVED': {
      const { tabId, position, windowId } = event.payload;
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab) return s;
      // Re-insert at the requested slot inside its canvas.
      const siblings = s.tabs
        .filter((t) => t.canvasId === tab.canvasId && t.id !== tabId)
        .sort((a, b) => a.position - b.position);
      siblings.splice(Math.max(0, Math.min(position, siblings.length)), 0, { ...tab, windowId: windowId ?? tab.windowId });
      const pos = new Map(siblings.map((t, i) => [t.id, { i, t }]));
      return {
        ...s,
        tabs: s.tabs.map((t) => {
          const p = pos.get(t.id);
          if (!p) return t;
          return t.id === tabId ? { ...p.t, position: p.i } : t.position === p.i ? t : { ...t, position: p.i };
        }),
      };
    }
    case 'TAB_UPDATED': {
      const { tabId, patch } = event.payload;
      return { ...s, tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) };
    }
    case 'TAB_CLOSED': {
      const tab = s.tabs.find((t) => t.id === event.payload.tabId);
      if (!tab) return s;
      return { ...s, tabs: renumber(s.tabs.filter((t) => t.id !== tab.id), tab.canvasId) };
    }
    case 'TAB_REMOVED': {
      const ids = new Set(event.payload.tabIds);
      const affected = new Set(s.tabs.filter((t) => ids.has(t.id)).map((t) => t.canvasId));
      let tabs = s.tabs.filter((t) => !ids.has(t.id));
      for (const c of affected) tabs = renumber(tabs, c);
      return { ...s, tabs };
    }
    case 'TABS_DETACHED': {
      // Tabs that stay in their canvas but are no longer open in Chrome.
      const ids = new Set(event.payload.tabIds);
      return {
        ...s,
        tabs: s.tabs.map((t) =>
          ids.has(t.id) ? { ...t, chromeTabId: undefined, windowId: undefined, active: false } : t,
        ),
      };
    }
    case 'TABS_SYNCED': {
      const { updates, added, detached } = event.payload;
      const patches = new Map(updates.map((u) => [u.tabId, u.patch]));
      const gone = new Set(detached);
      const canvasIds = new Set(s.canvases.map((c) => c.id));
      const known = new Set(s.tabs.map((t) => t.id));
      const tabs = s.tabs.map((t) => {
        let next = t;
        const patch = patches.get(t.id);
        if (patch) next = { ...next, ...patch };
        if (gone.has(t.id)) next = { ...next, chromeTabId: undefined, windowId: undefined, active: false };
        return next;
      });
      for (const tab of added) {
        if (known.has(tab.id)) continue;
        tabs.push({ ...tab, canvasId: canvasIds.has(tab.canvasId) ? tab.canvasId : s.canvases[0].id });
      }
      return { ...s, tabs };
    }
    case 'PREFERENCES_UPDATED': {
      const patch = event.payload.patch;
      return {
        ...s,
        preferences: {
          ...s.preferences,
          ...patch,
          ai: patch.ai ? { ...s.preferences.ai, ...patch.ai } : s.preferences.ai,
        },
      };
    }
    case 'STATE_RESTORED': {
      const { canvases, tabs, lastActiveCanvasId } = event.payload;
      if (canvases.length === 0) return s;
      return {
        ...s,
        canvases,
        tabs,
        lastActiveCanvasId: canvases.some((c) => c.id === lastActiveCanvasId) ? lastActiveCanvasId : canvases[0].id,
      };
    }
    default:
      return s;
  }
};

export const replay = (state: PersistedState, events: JournalEvent[]): PersistedState =>
  [...events]
    .sort((a, b) => a.seq - b.seq)
    .filter((e) => e.seq > state.lastSeq)
    .reduce(applyEvent, state);
