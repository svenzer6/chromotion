import { describe, expect, it } from 'vitest';
import { CSV_COLUMNS, exportCsv, exportJson, importCsv, importJson } from '../src/features/backup/BackupService';
import { parseCsv } from '../src/lib/csv';
import { createCanvas, createInitialState } from '../src/storage/schema';
import type { PersistedState } from '../src/types';

const sample = (): PersistedState => {
  const s = createInitialState(1);
  const work = createCanvas('Client "A", Inc.', 1, 'green', 1);
  s.canvases.push(work, createCanvas('Empty', 2, 'red', 1));
  s.tabs = [
    { id: 'u1', url: 'https://a.com/?q=1,2', title: 'Comma, "quotes"\nnewline', canvasId: work.id, position: 0, pinned: false, active: false, createdAt: 1, lastVisitedAt: 1700000000000, chromeTabId: 5 },
    { id: 'u2', url: 'https://b.com/', title: '=HYPERLINK("evil")', canvasId: s.canvases[0].id, position: 0, pinned: false, active: false, createdAt: 1, lastVisitedAt: 0 },
  ];
  s.preferences.ai.providers = [{ id: 'p', presetId: 'ollama', label: 'Ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', enabled: true }];
  return s;
};

describe('CSV backup', () => {
  it('uses the contract columns and neutralises formulas', () => {
    const csv = exportCsv(sample(), 0);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(csv).toContain(`"'=HYPERLINK(""evil"")"`);
    expect(rows.find((r) => r[2] === 'Empty')?.[7]).toBe('empty_canvas');
    expect(rows.find((r) => r[3] === 'u1')?.[7]).toBe('open');
  });

  it('round-trips into an empty workspace', () => {
    const csv = exportCsv(sample(), 0);
    const target = createInitialState(2);
    const res = importCsv(csv, target);
    const names = res.canvases.map((c) => c.name).sort();
    expect(names).toEqual(['Client "A", Inc.', 'Empty']); // "Inbox" already exists and is reused
    const u1 = res.tabs.find((t) => t.url === 'https://a.com/?q=1,2')!;
    expect(u1.title).toBe('Comma, "quotes"\nnewline');
    expect(res.tabs.find((t) => t.url === 'https://b.com/')!.title).toBe('=HYPERLINK("evil")');
    expect(res.tabs.every((t) => t.chromeTabId === undefined)).toBe(true);
  });

  it('skips duplicates and unsafe URLs on merge', () => {
    const s = sample();
    const res = importCsv(exportCsv(s, 0), s);
    expect(res.tabs).toHaveLength(0);
    expect(res.skippedDuplicates).toBe(2);
    const evil = 'canvas_name,tab_url\nX,javascript:alert(1)\nX,https://ok.com\n';
    const r2 = importCsv(evil, createInitialState());
    expect(r2.skippedInvalid).toBe(1);
    expect(r2.tabs.map((t) => t.url)).toEqual(['https://ok.com']);
  });
});

describe('JSON backup', () => {
  it('is lossless for canvases, tabs and settings', () => {
    const s = sample();
    const text = exportJson(s);
    const back = importJson(text);
    expect(back.canvases).toEqual(s.canvases);
    expect(back.tabs.map(({ chromeTabId: _c, windowId: _w, active: _a, ...t }) => t)).toEqual(
      s.tabs.map(({ chromeTabId: _c, windowId: _w, active: _a, ...t }) => t),
    );
    expect(back.preferences.ai.providers[0].baseUrl).toBe('http://localhost:11434/v1');
  });

  it('rejects non-Chromotion files', () => {
    expect(() => importJson('{"hello":1}')).toThrow();
    expect(() => importJson('nope')).toThrow(/JSON/);
  });
});
