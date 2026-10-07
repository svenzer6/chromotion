// Core domain types. Everything persisted lives in PersistedState; the
// background service worker is the only writer.

export const SCHEMA_VERSION = 1;

/** Accent ids match Chrome tab group colors so canvas and group always agree. */
export type Accent = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

export type Canvas = {
  id: string;
  name: string;
  icon?: string;
  accent?: Accent;

  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;

  order: number;
  pinned: boolean;
  archived: boolean;

  description?: string;
};

export type StoredTab = {
  id: string; // internal UUID — stable across restarts
  chromeTabId?: number; // undefined => tab is stored (not currently open)
  windowId?: number;

  url: string;
  title: string;
  faviconUrl?: string;

  canvasId: string;
  position: number;

  pinned: boolean;
  active: boolean;

  createdAt: number;
  lastVisitedAt: number;
};

export type ThemePreference = 'system' | 'light' | 'dark';

/** How switching canvases treats the tabs of the canvas you leave. */
export type SwitchMode = 'collapse' | 'unload';

export type AiProviderKind = 'openai-compatible';

export type AiProviderConfig = {
  id: string; // instance id
  presetId: string; // catalog preset this came from ("groq", "custom", ...)
  label: string;
  kind: AiProviderKind;
  baseUrl: string;
  model?: string; // empty => auto-pick from the live /models list
  enabled: boolean;
};

export type Preferences = {
  theme: ThemePreference;
  switchMode: SwitchMode;
  groupTabs: boolean;
  lazyLoadRestoredTabs: boolean;
  suggestForNewTabs: boolean;
  ai: {
    enabled: boolean;
    providers: AiProviderConfig[];
  };
};

export type PersistedState = {
  schemaVersion: number;
  canvases: Canvas[];
  tabs: StoredTab[];
  lastActiveCanvasId?: string;
  preferences: Preferences;
  lastSnapshotAt: number;
  /** Sequence number of the last journal event folded into this snapshot. */
  lastSeq: number;
};

// ---------------------------------------------------------------------------
// Event journal

export type JournalEventMap = {
  CANVAS_CREATED: { canvas: Canvas };
  CANVAS_RENAMED: { canvasId: string; name: string };
  CANVAS_UPDATED: { canvasId: string; patch: Partial<Omit<Canvas, 'id' | 'createdAt'>> };
  CANVAS_DELETED: { canvasId: string };
  CANVASES_REORDERED: { orderedIds: string[] };
  CANVAS_SWITCHED: { canvasId: string; at: number };
  TAB_OPENED: { tab: StoredTab };
  TAB_ASSIGNED: { tabIds: string[]; canvasId: string };
  TAB_MOVED: { tabId: string; position: number; windowId?: number };
  TAB_UPDATED: { tabId: string; patch: Partial<Omit<StoredTab, 'id'>> };
  TAB_CLOSED: { tabId: string };
  TAB_REMOVED: { tabIds: string[] };
  TABS_DETACHED: { tabIds: string[] };
  /** Batched reconciliation with Chrome (startup, restore, position refresh). */
  TABS_SYNCED: { updates: { tabId: string; patch: Partial<Omit<StoredTab, 'id'>> }[]; added: StoredTab[]; detached: string[] };
  PREFERENCES_UPDATED: { patch: Partial<Preferences> };
  STATE_RESTORED: { canvases: Canvas[]; tabs: StoredTab[]; lastActiveCanvasId?: string; reason: string };
};

export type JournalEventType = keyof JournalEventMap;

export type JournalEvent<T extends JournalEventType = JournalEventType> = {
  [K in T]: { id: string; seq: number; timestamp: number; type: K; payload: JournalEventMap[K] };
}[T];

// ---------------------------------------------------------------------------
// AI grouping

export type TabMetadata = {
  id: string; // StoredTab.id
  title: string;
  hostname: string;
  path?: string; // sanitized; never query string or fragment
  openerId?: string;
  createdAt: number;
  canvasId?: string;
};

export type CanvasSummary = {
  id: string;
  name: string;
  description?: string;
  hostnames: string[];
  sampleTitles: string[];
};

export type CanvasSuggestion = {
  id: string;
  name: string;
  description?: string;
  tabIds: string[];
  existingCanvasId?: string;
  confidence: number; // 0..1
  source: string; // provider id
};

export type CanvasAssignmentSuggestion = {
  tabId: string;
  canvasId?: string;
  confidence: number;
  reason?: string;
  source: string;
};

export type AiStatus = {
  lastProvider?: string;
  lastError?: string;
  lastRunAt?: number;
  fellBackToLocal?: boolean;
};

export type LocalBackup = {
  id: string;
  createdAt: number;
  reason: string;
  canvasCount: number;
  tabCount: number;
  state: PersistedState;
};
