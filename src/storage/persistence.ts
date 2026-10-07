import { debounce } from '../lib/async';
import { uid } from '../lib/id';
import type { JournalEvent, JournalEventMap, JournalEventType, PersistedState } from '../types';
import { applyEvent } from './reducer';
import { STORAGE_KEYS } from './schema';

/** Minimal async key-value store (chrome.storage.local in production, a Map in tests). */
export interface KeyValueStore {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const chromeLocalStore: KeyValueStore = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
};

/**
 * Write-ahead persistence:
 *  1. every mutation is an event; it is applied in memory and appended to the
 *     journal, which is written to storage immediately;
 *  2. a debounced snapshot folds the journal into `tc:state` and truncates it.
 * If the service worker dies between 1 and 2, RecoveryService replays the
 * journal on top of the last snapshot. Memory is never authoritative.
 */
export class PersistenceService {
  private journal: JournalEvent[] = [];
  private seq: number;
  private writing: Promise<void> = Promise.resolve();
  private journalTimer?: ReturnType<typeof setTimeout>;
  private readonly scheduleSnapshot = debounce(() => void this.snapshot(), 400, 2000);

  constructor(
    private state: PersistedState,
    private readonly store: KeyValueStore,
    private readonly onChange: (state: PersistedState, event?: JournalEvent) => void = () => {},
  ) {
    this.seq = state.lastSeq;
  }

  get current(): PersistedState {
    return this.state;
  }

  dispatch<T extends JournalEventType>(type: T, payload: JournalEventMap[T], timestamp = Date.now()): JournalEvent<T> {
    const event = { id: uid(), seq: ++this.seq, timestamp, type, payload } as JournalEvent<T>;
    this.state = applyEvent(this.state, event as JournalEvent);
    this.journal.push(event as JournalEvent);
    // Bursts (e.g. a page load firing several title updates) share one write.
    this.journalTimer ??= setTimeout(() => {
      this.journalTimer = undefined;
      void this.enqueueWrite({ [STORAGE_KEYS.journal]: [...this.journal] });
    }, 25);
    this.scheduleSnapshot();
    this.onChange(this.state, event as JournalEvent);
    return event;
  }

  /** Replace the whole state (used once after recovery). */
  async replaceAll(state: PersistedState): Promise<void> {
    this.state = state;
    this.seq = Math.max(this.seq, state.lastSeq);
    await this.snapshot();
    this.onChange(this.state);
  }

  async snapshot(): Promise<void> {
    if (this.journalTimer) {
      clearTimeout(this.journalTimer);
      this.journalTimer = undefined;
    }
    const state: PersistedState = { ...this.state, lastSnapshotAt: Date.now(), lastSeq: this.seq };
    this.state = state;
    // Events folded into this snapshot can be dropped; later ones stay.
    this.journal = this.journal.filter((e) => e.seq > state.lastSeq);
    await this.enqueueWrite({ [STORAGE_KEYS.state]: state, [STORAGE_KEYS.journal]: [...this.journal] });
  }

  /** Make every dispatched event durable now (used before acknowledging a user command). */
  async flushJournal(): Promise<void> {
    if (this.journalTimer) {
      clearTimeout(this.journalTimer);
      this.journalTimer = undefined;
      void this.enqueueWrite({ [STORAGE_KEYS.journal]: [...this.journal] });
    }
    await this.writing;
  }

  async flush(): Promise<void> {
    this.scheduleSnapshot.flush();
    await this.writing;
  }

  private enqueueWrite(items: Record<string, unknown>): Promise<void> {
    this.writing = this.writing.then(
      () => this.store.set(items),
      () => this.store.set(items),
    );
    return this.writing;
  }
}
