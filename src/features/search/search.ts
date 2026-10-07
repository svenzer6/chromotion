import { fuzzyScore } from '../../lib/text';
import { hostnameOf } from '../../lib/url';
import type { Canvas, PersistedState, StoredTab } from '../../types';

// Local-only search. Typing in search never calls AI.

export type SearchResults = {
  canvases: { canvas: Canvas; score: number }[];
  tabs: { tab: StoredTab; score: number }[];
};

export const search = (state: PersistedState, query: string, limit = 40): SearchResults => {
  const q = query.trim();
  const live = state.canvases.filter((c) => !c.archived);
  if (!q) {
    return {
      canvases: [...live].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).map((canvas) => ({ canvas, score: 1 })),
      tabs: [...state.tabs]
        .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
        .slice(0, 8)
        .map((tab) => ({ tab, score: 1 })),
    };
  }
  const canvases = live
    .map((canvas) => ({ canvas, score: Math.max(fuzzyScore(q, canvas.name), fuzzyScore(q, canvas.description ?? '') * 0.5) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  const now = Date.now();
  const tabs = state.tabs
    .map((tab) => {
      const base = Math.max(fuzzyScore(q, tab.title), fuzzyScore(q, hostnameOf(tab.url)) * 0.9, fuzzyScore(q, tab.url) * 0.6);
      const recency = tab.lastVisitedAt ? Math.max(0, 6 - (now - tab.lastVisitedAt) / 3_600_000) : 0;
      return { tab, score: base > 0 ? base + recency : 0 };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { canvases, tabs };
};
