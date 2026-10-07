import { parseCsv, toCsv, unescapeFormula } from '../../lib/csv';
import { uid } from '../../lib/id';
import { createCanvas, migrateState } from '../../storage/schema';
import type { Canvas, PersistedState, StoredTab } from '../../types';

// JSON = full fidelity (lossless), CSV = portable / human readable.
// Neither is the primary store — chrome.storage.local is.

export const CSV_COLUMNS = [
  'timestamp',
  'canvas_id',
  'canvas_name',
  'tab_uuid',
  'tab_title',
  'tab_url',
  'tab_position',
  'tab_status',
  'last_visited',
] as const;

const JSON_FORMAT = 'chromotion-backup';
const LEGACY_FORMATS = new Set([JSON_FORMAT, 'tabcanvas-backup']);

export type JsonBackup = {
  format: typeof JSON_FORMAT;
  exportedAt: string;
  state: PersistedState;
};

const iso = (ms: number) => (ms > 0 ? new Date(ms).toISOString() : '');

export const exportJson = (state: PersistedState): string => {
  const clean: PersistedState = structuredClone(state);
  const backup: JsonBackup = { format: JSON_FORMAT, exportedAt: new Date().toISOString(), state: clean };
  return JSON.stringify(backup, null, 2);
};

export const importJson = (text: string): PersistedState => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON');
  }
  const candidate =
    typeof parsed === 'object' && parsed !== null && LEGACY_FORMATS.has((parsed as JsonBackup).format)
      ? (parsed as JsonBackup).state
      : parsed;
  const state = migrateState(candidate);
  // Chrome tab ids from another session are meaningless here.
  state.tabs = state.tabs.map((t) => ({ ...t, chromeTabId: undefined, windowId: undefined, active: false }));
  return state;
};

export const exportCsv = (state: PersistedState, now = Date.now()): string => {
  const ts = iso(now);
  const rows: unknown[][] = [];
  const canvases = [...state.canvases].sort((a, b) => a.order - b.order);
  for (const canvas of canvases) {
    const tabs = state.tabs.filter((t) => t.canvasId === canvas.id).sort((a, b) => a.position - b.position);
    if (tabs.length === 0) {
      rows.push([ts, canvas.id, canvas.name, '', '', '', '', 'empty_canvas', '']);
      continue;
    }
    for (const t of tabs) {
      rows.push([
        ts,
        canvas.id,
        canvas.name,
        t.id,
        t.title,
        t.url,
        t.position,
        t.chromeTabId !== undefined ? 'open' : 'stored',
        iso(t.lastVisitedAt),
      ]);
    }
  }
  return toCsv([...CSV_COLUMNS], rows);
};

export type CsvImportResult = {
  canvases: Canvas[]; // new canvases to create
  tabs: StoredTab[]; // new stored tabs (not opened)
  skippedDuplicates: number;
  skippedInvalid: number;
};

/**
 * Merge-import: canvases are matched by id, then by name (case-insensitive);
 * tabs already present in the same canvas with the same URL are skipped.
 * Imported tabs arrive as *stored* tabs and open when their canvas is opened.
 */
export const importCsv = (text: string, current: PersistedState, now = Date.now()): CsvImportResult => {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error('CSV is empty');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: (typeof CSV_COLUMNS)[number]) => header.indexOf(name);
  for (const required of ['canvas_name', 'tab_url'] as const) {
    if (col(required) === -1) throw new Error(`CSV is missing the "${required}" column`);
  }
  const get = (row: string[], name: (typeof CSV_COLUMNS)[number]) => {
    const i = col(name);
    return i === -1 ? '' : unescapeFormula((row[i] ?? '').trim());
  };

  const byId = new Map(current.canvases.map((c) => [c.id, c]));
  const byName = new Map(current.canvases.map((c) => [c.name.toLocaleLowerCase(), c]));
  const created: Canvas[] = [];
  let order = current.canvases.length;

  const resolveCanvas = (id: string, name: string): Canvas | undefined => {
    if (id && byId.has(id)) return byId.get(id);
    const key = (name || 'Imported').toLocaleLowerCase();
    if (byName.has(key)) return byName.get(key);
    const canvas = createCanvas(name || 'Imported', order++, undefined, now);
    if (id && !current.canvases.some((c) => c.id === id)) canvas.id = id;
    byId.set(canvas.id, canvas);
    byName.set(key, canvas);
    created.push(canvas);
    return canvas;
  };

  const existingKeys = new Set(current.tabs.map((t) => `${t.canvasId}\u0000${t.url}`));
  const existingIds = new Set(current.tabs.map((t) => t.id));
  const nextPos = new Map<string, number>();
  const positionFor = (canvasId: string) => {
    const base =
      nextPos.get(canvasId) ??
      current.tabs.filter((t) => t.canvasId === canvasId).reduce((m, t) => Math.max(m, t.position + 1), 0);
    nextPos.set(canvasId, base + 1);
    return base;
  };

  const tabs: StoredTab[] = [];
  let skippedDuplicates = 0;
  let skippedInvalid = 0;

  for (const row of rows.slice(1)) {
    const canvas = resolveCanvas(get(row, 'canvas_id'), get(row, 'canvas_name'));
    if (!canvas) continue;
    const url = get(row, 'tab_url');
    if (!url) continue; // empty-canvas marker row
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url) || /^javascript:/i.test(url)) {
      skippedInvalid++;
      continue;
    }
    const key = `${canvas.id}\u0000${url}`;
    if (existingKeys.has(key)) {
      skippedDuplicates++;
      continue;
    }
    existingKeys.add(key);
    const wantedId = get(row, 'tab_uuid');
    const id = wantedId && !existingIds.has(wantedId) ? wantedId : uid();
    existingIds.add(id);
    const visited = Date.parse(get(row, 'last_visited'));
    tabs.push({
      id,
      url,
      title: get(row, 'tab_title') || url,
      canvasId: canvas.id,
      position: positionFor(canvas.id),
      pinned: false,
      active: false,
      createdAt: now,
      lastVisitedAt: Number.isFinite(visited) ? visited : 0,
    });
  }
  return { canvases: created, tabs, skippedDuplicates, skippedInvalid };
};

export const backupFileName = (ext: 'json' | 'csv', now = new Date()) => {
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `chromotion-backup-${stamp}.${ext}`;
};
