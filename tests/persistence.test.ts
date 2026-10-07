import { describe, expect, it } from 'vitest';
import { RecoveryService } from '../src/features/recovery/RecoveryService';
import { PersistenceService, type KeyValueStore } from '../src/storage/persistence';
import { applyEvent, replay } from '../src/storage/reducer';
import { STORAGE_KEYS, createCanvas, createInitialState, migrateState } from '../src/storage/schema';
import type { StoredTab } from '../src/types';

const memoryStore = (): KeyValueStore & { data: Record<string, unknown> } => {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(keys) {
      return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data[k] = structuredClone(v);
    },
  };
};

const tab = (id: string, canvasId: string, url = `https://example.com/${id}`): StoredTab => ({
  id,
  url,
  title: id,
  canvasId,
  position: 0,
  pinned: false,
  active: false,
  createdAt: 1,
  lastVisitedAt: 1,
  chromeTabId: Number(id.replace(/\D/g, '')) || undefined,
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('reducer', () => {
  it('creates, assigns, reorders, deletes', () => {
    let s = createInitialState(1);
    const inbox = s.canvases[0].id;
    const work = createCanvas('Work', 1, 'green', 2);
    const ev = (seq: number, type: string, payload: unknown) => ({ id: String(seq), seq, timestamp: seq, type, payload }) as never;
    s = applyEvent(s, ev(1, 'CANVAS_CREATED', { canvas: work }));
    s = applyEvent(s, ev(2, 'TAB_OPENED', { tab: tab('t1', inbox) }));
    s = applyEvent(s, ev(3, 'TAB_OPENED', { tab: { ...tab('t2', inbox), position: 1 } }));
    s = applyEvent(s, ev(4, 'TAB_ASSIGNED', { tabIds: ['t1'], canvasId: work.id }));
    expect(s.tabs.find((t) => t.id === 't1')!.canvasId).toBe(work.id);
    expect(s.tabs.find((t) => t.id === 't2')!.position).toBe(0); // renumbered
    s = applyEvent(s, ev(5, 'CANVASES_REORDERED', { orderedIds: [work.id, inbox] }));
    expect(s.canvases.map((c) => c.name)).toEqual(['Work', 'Inbox']);
    s = applyEvent(s, ev(6, 'CANVAS_DELETED', { canvasId: work.id }));
    expect(s.canvases).toHaveLength(1);
    expect(s.tabs.map((t) => t.id)).toEqual(['t2']);
    // never deletes the last canvas
    s = applyEvent(s, ev(7, 'CANVAS_DELETED', { canvasId: inbox }));
    expect(s.canvases).toHaveLength(1);
    expect(s.lastSeq).toBe(7);
  });

  it('replay skips events already folded into the snapshot', () => {
    const s = { ...createInitialState(1), lastSeq: 5 };
    const events = [{ id: 'x', seq: 3, timestamp: 3, type: 'CANVAS_RENAMED', payload: { canvasId: s.canvases[0].id, name: 'Old' } }] as never[];
    expect(replay(s, events).canvases[0].name).toBe('Inbox');
  });
});

describe('crash-safe persistence', () => {
  it('recovers events written to the journal before the snapshot (service worker killed)', async () => {
    const store = memoryStore();
    const initial = createInitialState(1);
    const p = new PersistenceService(initial, store);
    await p.snapshot();
    const inbox = initial.canvases[0].id;
    p.dispatch('CANVAS_RENAMED', { canvasId: inbox, name: 'Research' });
    p.dispatch('TAB_OPENED', { tab: tab('t1', inbox) });
    await wait(60); // journal write lands, debounced snapshot (400ms) has not
    expect((store.data[STORAGE_KEYS.state] as { canvases: { name: string }[] }).canvases[0].name).toBe('Inbox');

    // "restart": a brand-new recovery reads snapshot + journal
    const { state, report } = await new RecoveryService(store).load();
    expect(report.source).toBe('snapshot');
    expect(report.replayedEvents).toBe(2);
    expect(state.canvases[0].name).toBe('Research');
    expect(state.tabs.map((t) => t.id)).toEqual(['t1']);
  });

  it('snapshot folds and truncates the journal', async () => {
    const store = memoryStore();
    const p = new PersistenceService(createInitialState(1), store);
    p.dispatch('CANVAS_RENAMED', { canvasId: p.current.canvases[0].id, name: 'A' });
    await p.flush();
    expect(store.data[STORAGE_KEYS.journal]).toEqual([]);
    const { state, report } = await new RecoveryService(store).load();
    expect(report.replayedEvents).toBe(0);
    expect(state.canvases[0].name).toBe('A');
  });

  it('falls back to the newest backup when the snapshot is corrupt', async () => {
    const store = memoryStore();
    const recovery = new RecoveryService(store);
    const good = createInitialState(1);
    good.canvases[0].name = 'Backed up';
    await recovery.createBackup(good, 'test');
    store.data[STORAGE_KEYS.state] = { garbage: true };
    const { state, report } = await recovery.load();
    expect(report.source).toBe('backup');
    expect(state.canvases[0].name).toBe('Backed up');
  });

  it('drops legacy cloud provider configs (only keyless localhost servers are allowed)', () => {
    const s = createInitialState(1) as unknown as Record<string, any>;
    s.preferences.ai.providers = [
      { id: 'old', presetId: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'secret', enabled: true },
      { id: 'local', presetId: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', enabled: true },
    ];
    const migrated = migrateState(s);
    expect(migrated.preferences.ai.providers.map((p) => p.id)).toEqual(['local']);
    expect(JSON.stringify(migrated)).not.toContain('secret');
  });
});
