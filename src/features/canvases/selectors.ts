import type { Canvas, PersistedState, StoredTab } from '../../types';

export const sortedCanvases = (state: PersistedState | undefined): Canvas[] =>
  state ? [...state.canvases].filter((c) => !c.archived).sort((a, b) => a.order - b.order) : [];

export const tabsOf = (state: PersistedState | undefined, canvasId: string | undefined): StoredTab[] =>
  state && canvasId
    ? state.tabs
        .filter((t) => t.canvasId === canvasId)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position)
    : [];

export const countsByCanvas = (state: PersistedState | undefined): Map<string, number> => {
  const m = new Map<string, number>();
  for (const t of state?.tabs ?? []) m.set(t.canvasId, (m.get(t.canvasId) ?? 0) + 1);
  return m;
};
