import type {
  Accent,
  AiProviderConfig,
  AiStatus,
  Canvas,
  CanvasSuggestion,
  LocalBackup,
  PersistedState,
  Preferences,
} from '../types';

// Typed contract between UI pages and the background service worker.
// UI pages never touch chrome.tabs directly; they send commands.

export type SuggestionDraft = Pick<CanvasSuggestion, 'name' | 'description' | 'tabIds' | 'existingCanvasId'>;

export type Command =
  | { type: 'SWITCH_CANVAS'; canvasId: string }
  | { type: 'CREATE_CANVAS'; name?: string; tabIds?: string[]; switchTo?: boolean; accent?: Accent }
  | { type: 'RENAME_CANVAS'; canvasId: string; name: string }
  | { type: 'UPDATE_CANVAS'; canvasId: string; patch: Partial<Pick<Canvas, 'accent' | 'icon' | 'description' | 'pinned' | 'archived'>> }
  | { type: 'DELETE_CANVAS'; canvasId: string }
  | { type: 'REORDER_CANVASES'; orderedIds: string[] }
  | { type: 'MOVE_TABS'; tabIds: string[]; canvasId: string }
  | { type: 'MOVE_CURRENT_TAB'; canvasId: string }
  | { type: 'OPEN_TAB'; tabId: string }
  | { type: 'CLOSE_TABS'; tabIds: string[] }
  | { type: 'ORGANIZE'; scope: 'canvas' | 'all'; canvasId?: string }
  | { type: 'APPLY_SUGGESTIONS'; suggestions: SuggestionDraft[] }
  | { type: 'DISMISS_SUGGESTIONS' }
  | { type: 'ACCEPT_TAB_SUGGESTION' }
  | { type: 'DISMISS_TAB_SUGGESTION' }
  | { type: 'SUGGEST_NAME'; canvasId: string }
  | { type: 'UNDO' }
  | { type: 'UPDATE_PREFERENCES'; patch: Partial<Preferences> }
  | { type: 'EXPORT'; format: 'json' | 'csv' }
  | { type: 'IMPORT_JSON'; text: string }
  | { type: 'IMPORT_CSV'; text: string }
  | { type: 'LIST_BACKUPS' }
  | { type: 'CREATE_BACKUP' }
  | { type: 'RESTORE_BACKUP'; backupId: string }
  | { type: 'TEST_PROVIDER'; provider: AiProviderConfig }
  | { type: 'DIAGNOSTICS' };

export type CommandType = Command['type'];

export type SuggestionBatch = {
  id: string;
  createdAt: number;
  scopeCanvasId?: string;
  suggestions: CanvasSuggestion[];
  providerLabel: string;
  model?: string;
  fellBackToLocal: boolean;
  errors: string[];
};

export type TabSuggestion = {
  tabId: string;
  tabTitle: string;
  canvasId: string;
  canvasName: string;
  reason?: string;
};

export type UndoInfo = { label: string; at: number };

export type UiMeta = {
  undo?: UndoInfo;
  suggestions?: SuggestionBatch;
  tabSuggestion?: TabSuggestion;
  aiStatus?: AiStatus;
  recovery?: { source: string; replayedEvents: number; problems: string[] };
};

export type StateMessage = { type: 'STATE'; state: PersistedState; meta: UiMeta };

export type BackupListItem = Omit<LocalBackup, 'state'>;

export type ProviderTestResult = { model: string; sampleName: string; latencyMs: number };

export type ResultMap = {
  ORGANIZE: SuggestionBatch;
  SUGGEST_NAME: { name: string; providerLabel: string };
  EXPORT: { text: string };
  LIST_BACKUPS: BackupListItem[];
  CREATE_BACKUP: BackupListItem;
  IMPORT_CSV: { canvases: number; tabs: number; skippedDuplicates: number; skippedInvalid: number };
  IMPORT_JSON: { canvases: number; tabs: number };
  TEST_PROVIDER: ProviderTestResult;
  CREATE_CANVAS: { canvasId: string };
  DIAGNOSTICS: Diagnostics;
};

export type Diagnostics = {
  version: string;
  browser: string;
  canvases: number;
  tabs: number;
  openTabs: number;
  storageBytes: number;
  errors: { at: number; where: string; message: string }[];
};

export type CommandResult<T extends CommandType> = T extends keyof ResultMap ? ResultMap[T] : void;

export type Response<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export const UI_PORT = 'tc-ui';

export async function send<C extends Command>(command: C): Promise<CommandResult<C['type']>> {
  const res = (await chrome.runtime.sendMessage(command)) as Response<CommandResult<C['type']>> | undefined;
  if (!res) throw new Error('Background did not respond');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
