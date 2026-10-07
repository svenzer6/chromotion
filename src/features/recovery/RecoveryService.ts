import { uid } from '../../lib/id';
import type { KeyValueStore } from '../../storage/persistence';
import { replay } from '../../storage/reducer';
import { STORAGE_KEYS, createInitialState, migrateState } from '../../storage/schema';
import type { JournalEvent, LocalBackup, PersistedState } from '../../types';

export type RecoveryReport = {
  source: 'snapshot' | 'backup' | 'fresh';
  replayedEvents: number;
  problems: string[];
};

const MAX_BACKUPS = 8;

const isEvent = (e: unknown): e is JournalEvent =>
  typeof e === 'object' && e !== null && typeof (e as JournalEvent).seq === 'number' && typeof (e as JournalEvent).type === 'string';

/**
 * Rebuilds state on every service-worker start:
 * snapshot + journal replay -> newest valid rolling backup -> fresh state.
 */
export class RecoveryService {
  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<{ state: PersistedState; report: RecoveryReport }> {
    const problems: string[] = [];
    const raw = await this.store.get([STORAGE_KEYS.state, STORAGE_KEYS.journal]);
    const journal = Array.isArray(raw[STORAGE_KEYS.journal]) ? (raw[STORAGE_KEYS.journal] as unknown[]).filter(isEvent) : [];

    if (raw[STORAGE_KEYS.state] !== undefined) {
      try {
        const base = migrateState(raw[STORAGE_KEYS.state]);
        const pending = journal.filter((e) => e.seq > base.lastSeq);
        let state = base;
        try {
          state = migrateState(replay(base, pending));
        } catch (err) {
          problems.push(`Journal replay failed: ${String(err)}`);
        }
        return { state, report: { source: 'snapshot', replayedEvents: pending.length, problems } };
      } catch (err) {
        problems.push(`Snapshot unreadable: ${String(err)}`);
      }
    } else if (journal.length > 0) {
      // Crash before the very first snapshot: replay onto a fresh state.
      try {
        const fresh = createInitialState();
        const state = migrateState(replay({ ...fresh, lastSeq: 0 }, journal));
        return { state, report: { source: 'snapshot', replayedEvents: journal.length, problems } };
      } catch (err) {
        problems.push(`Journal-only replay failed: ${String(err)}`);
      }
    }

    for (const backup of await this.listBackups()) {
      try {
        const state = migrateState(backup.state);
        return { state, report: { source: 'backup', replayedEvents: 0, problems } };
      } catch (err) {
        problems.push(`Backup ${backup.id} unreadable: ${String(err)}`);
      }
    }

    return { state: createInitialState(), report: { source: 'fresh', replayedEvents: 0, problems } };
  }

  async listBackups(): Promise<LocalBackup[]> {
    const raw = await this.store.get([STORAGE_KEYS.backups]);
    const list = raw[STORAGE_KEYS.backups];
    return Array.isArray(list) ? (list as LocalBackup[]).sort((a, b) => b.createdAt - a.createdAt) : [];
  }

  /** Rolling local backups. */
  async createBackup(state: PersistedState, reason: string): Promise<LocalBackup> {
    const clean: PersistedState = structuredClone(state);
    clean.tabs = clean.tabs.map((t) => ({ ...t, chromeTabId: undefined, windowId: undefined, active: false }));
    const backup: LocalBackup = {
      id: uid(),
      createdAt: Date.now(),
      reason,
      canvasCount: clean.canvases.length,
      tabCount: clean.tabs.length,
      state: clean,
    };
    const existing = await this.listBackups();
    await this.store.set({ [STORAGE_KEYS.backups]: [backup, ...existing].slice(0, MAX_BACKUPS) });
    return backup;
  }
}
