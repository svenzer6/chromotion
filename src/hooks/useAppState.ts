import { create } from 'zustand';
import { send, UI_PORT, type Command, type CommandResult, type StateMessage, type UiMeta } from '../chrome/messaging';
import { migrateState, STORAGE_KEYS } from '../storage/schema';
import type { PersistedState } from '../types';

// UI-side store. The background pushes the full state over a long-lived port;
// components subscribe with selectors so only what changed re-renders.

type Toast = { id: number; message: string; kind?: 'error' | 'info'; action?: { label: string; run: () => void } };

type AppStore = {
  state?: PersistedState;
  meta: UiMeta;
  connected: boolean;
  /** Canvas the user just clicked — shown immediately while the switch runs. */
  pendingCanvasId?: string;
  toasts: Toast[];
};

export const useApp = create<AppStore>(() => ({ meta: {}, connected: false, toasts: [] }));

let toastSeq = 0;
export const toast = (message: string, opts: Omit<Toast, 'id' | 'message'> = {}) => {
  const id = ++toastSeq;
  useApp.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, ...opts }] }));
  setTimeout(() => dismissToast(id), opts.action ? 6000 : 3500);
  return id;
};
export const dismissToast = (id: number) => useApp.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

export async function run<C extends Command>(command: C, opts: { quiet?: boolean } = {}): Promise<CommandResult<C['type']> | undefined> {
  try {
    return await send(command);
  } catch (err) {
    if (!opts.quiet) toast(err instanceof Error ? err.message : String(err), { kind: 'error' });
    return undefined;
  }
}

export const undo = () => run({ type: 'UNDO' });

let started = false;

export function connectBackground() {
  if (started) return;
  started = true;
  let retry = 100;

  // Instant first paint from the last snapshot while the worker wakes up.
  chrome.storage.local
    .get(STORAGE_KEYS.state)
    .then((raw) => {
      if (!useApp.getState().state && raw[STORAGE_KEYS.state]) {
        useApp.setState({ state: migrateState(raw[STORAGE_KEYS.state]) });
      }
    })
    .catch(() => undefined);

  const connect = () => {
    const port = chrome.runtime.connect({ name: UI_PORT });
    port.onMessage.addListener((msg: StateMessage) => {
      if (msg?.type !== 'STATE') return;
      retry = 100;
      const pending = useApp.getState().pendingCanvasId;
      useApp.setState({
        state: msg.state,
        meta: msg.meta,
        connected: true,
        pendingCanvasId: pending && msg.state.lastActiveCanvasId === pending ? undefined : pending,
      });
    });
    // The service worker may be stopped by Chrome at any time; reconnecting
    // wakes it up and it rebuilds state from storage.
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      useApp.setState({ connected: false });
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 3000);
    });
  };
  connect();
}

export const switchCanvas = async (canvasId: string) => {
  useApp.setState({ pendingCanvasId: canvasId });
  await run({ type: 'SWITCH_CANVAS', canvasId });
  useApp.setState({ pendingCanvasId: undefined });
};
