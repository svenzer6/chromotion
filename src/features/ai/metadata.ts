import { hostnameOf, isInternalUrl, sanitizePathForAi } from '../../lib/url';
import type { Canvas, CanvasSummary, StoredTab, TabMetadata } from '../../types';

/** The only shape of tab data the AI layer ever sees. */
export const toTabMetadata = (tab: StoredTab, opts: { includePath: boolean; openerId?: string }): TabMetadata => ({
  id: tab.id,
  title: tab.title.slice(0, 140),
  hostname: hostnameOf(tab.url),
  path: opts.includePath ? sanitizePathForAi(tab.url) : undefined,
  openerId: opts.openerId,
  createdAt: tab.createdAt,
  canvasId: tab.canvasId,
});

/** Internal pages (chrome://, file://, extension pages…) are never sent to a cloud provider. */
export const isShareableWithCloud = (tab: StoredTab): boolean => !isInternalUrl(tab.url) && !!hostnameOf(tab.url);

export const summarizeCanvases = (canvases: Canvas[], tabs: StoredTab[]): CanvasSummary[] =>
  canvases
    .filter((c) => !c.archived)
    .map((c) => {
      const own = tabs.filter((t) => t.canvasId === c.id);
      const hosts = new Map<string, number>();
      for (const t of own) {
        const h = hostnameOf(t.url);
        if (h) hosts.set(h, (hosts.get(h) ?? 0) + 1);
      }
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        hostnames: [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([h]) => h),
        sampleTitles: own
          .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
          .slice(0, 5)
          .map((t) => t.title.slice(0, 80)),
      };
    });
