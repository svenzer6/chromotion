import { uid } from '../../../lib/id';
import { fuzzyScore, jaccard, normalize, titleCase, tokenize } from '../../../lib/text';
import { siteLabel, siteOf } from '../../../lib/url';
import type { CanvasAssignmentSuggestion, CanvasSuggestion, CanvasSummary, TabMetadata } from '../../../types';
import type { AiGroupingProvider, ClusterContext } from '../types';

// Fully offline grouping. Signals: same site, URL path similarity, title token
// similarity, opener relationship, opening-time proximity, a small category
// map and fuzzy matching against existing canvas names.

const HOST_CATEGORIES: Record<string, string> = {
  'mail.google.com': 'Communication',
  'calendar.google.com': 'Communication',
  'meet.google.com': 'Communication',
  'chat.google.com': 'Communication',
  'docs.google.com': 'Docs & Files',
  'drive.google.com': 'Docs & Files',
  'sheets.google.com': 'Docs & Files',
  'analytics.google.com': 'Analytics',
  'search.google.com': 'Analytics',
  'ads.google.com': 'Analytics',
  'scholar.google.com': 'Research',
  'gemini.google.com': 'AI',
  'aistudio.google.com': 'AI',
  'outlook.live.com': 'Communication',
  'outlook.office.com': 'Communication',
  'teams.microsoft.com': 'Communication',
  'web.whatsapp.com': 'Communication',
  'news.ycombinator.com': 'News',
  'developer.mozilla.org': 'Development',
  'maps.google.com': 'Travel',
};

const SITE_CATEGORIES: Record<string, string> = {
  // AI
  'openai.com': 'AI', 'chatgpt.com': 'AI', 'anthropic.com': 'AI', 'claude.ai': 'AI', 'huggingface.co': 'AI',
  'perplexity.ai': 'AI', 'mistral.ai': 'AI', 'groq.com': 'AI', 'cerebras.ai': 'AI', 'openrouter.ai': 'AI',
  'deepmind.com': 'AI', 'ollama.com': 'AI', 'replicate.com': 'AI', 'cohere.com': 'AI',
  // Development
  'github.com': 'Development', 'gitlab.com': 'Development', 'bitbucket.org': 'Development',
  'stackoverflow.com': 'Development', 'stackexchange.com': 'Development', 'npmjs.com': 'Development',
  'pypi.org': 'Development', 'vercel.com': 'Development', 'netlify.com': 'Development', 'docker.com': 'Development',
  'readthedocs.io': 'Development', 'localhost': 'Development', 'codepen.io': 'Development', 'jsfiddle.net': 'Development',
  'mdn.io': 'Development', 'rust-lang.org': 'Development', 'python.org': 'Development', 'nodejs.org': 'Development',
  'typescriptlang.org': 'Development', 'react.dev': 'Development', 'vitejs.dev': 'Development', 'vite.dev': 'Development',
  'cloudflare.com': 'Development', 'supabase.com': 'Development', 'firebase.google.com': 'Development',
  // Research
  'arxiv.org': 'Research', 'wikipedia.org': 'Research', 'researchgate.net': 'Research', 'semanticscholar.org': 'Research',
  'nih.gov': 'Research', 'jstor.org': 'Research', 'sciencedirect.com': 'Research', 'springer.com': 'Research',
  'nature.com': 'Research', 'acm.org': 'Research', 'ieee.org': 'Research', 'paperswithcode.com': 'Research',
  // Communication
  'slack.com': 'Communication', 'discord.com': 'Communication', 'zoom.us': 'Communication', 'telegram.org': 'Communication',
  'whatsapp.com': 'Communication', 'messenger.com': 'Communication',
  // Design
  'figma.com': 'Design', 'dribbble.com': 'Design', 'behance.net': 'Design', 'canva.com': 'Design', 'framer.com': 'Design',
  'pinterest.com': 'Design', 'coolors.co': 'Design', 'fonts.google.com': 'Design',
  // Shopping
  'amazon.com': 'Shopping', 'amazon.de': 'Shopping', 'amazon.co.uk': 'Shopping', 'amazon.com.tr': 'Shopping',
  'ebay.com': 'Shopping', 'etsy.com': 'Shopping', 'aliexpress.com': 'Shopping', 'temu.com': 'Shopping',
  'trendyol.com': 'Shopping', 'hepsiburada.com': 'Shopping', 'zalando.com': 'Shopping', 'ikea.com': 'Shopping',
  'n11.com': 'Shopping', 'walmart.com': 'Shopping', 'bestbuy.com': 'Shopping', 'verkkokauppa.com': 'Shopping',
  // Media
  'youtube.com': 'Media', 'netflix.com': 'Media', 'spotify.com': 'Media', 'twitch.tv': 'Media', 'vimeo.com': 'Media',
  'soundcloud.com': 'Media', 'primevideo.com': 'Media', 'disneyplus.com': 'Media',
  // Social
  'twitter.com': 'Social', 'x.com': 'Social', 'facebook.com': 'Social', 'instagram.com': 'Social',
  'linkedin.com': 'Social', 'reddit.com': 'Social', 'threads.net': 'Social', 'bsky.app': 'Social',
  'mastodon.social': 'Social', 'tiktok.com': 'Social',
  // News
  'nytimes.com': 'News', 'bbc.com': 'News', 'bbc.co.uk': 'News', 'theguardian.com': 'News', 'reuters.com': 'News',
  'bloomberg.com': 'News', 'cnn.com': 'News', 'theverge.com': 'News', 'techcrunch.com': 'News', 'wired.com': 'News',
  // Docs & files
  'notion.so': 'Docs & Files', 'dropbox.com': 'Docs & Files', 'box.com': 'Docs & Files', 'sharepoint.com': 'Docs & Files',
  'onedrive.live.com': 'Docs & Files', 'atlassian.net': 'Docs & Files', 'airtable.com': 'Docs & Files',
  // Analytics
  'plausible.io': 'Analytics', 'mixpanel.com': 'Analytics', 'ahrefs.com': 'Analytics', 'semrush.com': 'Analytics',
  'hotjar.com': 'Analytics', 'similarweb.com': 'Analytics',
  // Travel
  'booking.com': 'Travel', 'airbnb.com': 'Travel', 'skyscanner.net': 'Travel', 'expedia.com': 'Travel',
  'tripadvisor.com': 'Travel', 'kayak.com': 'Travel',
};

/** Sites hosting many unrelated products: group them by full hostname instead. */
const MULTI_PRODUCT = new Set(['google.com', 'microsoft.com', 'live.com', 'office.com', 'apple.com', 'yandex.com', 'atlassian.net', 'amazonaws.com']);

const BRAND_LABELS: Record<string, string> = {
  github: 'GitHub', gitlab: 'GitLab', ebay: 'eBay', amazon: 'Amazon', reddit: 'Reddit', youtube: 'YouTube', linkedin: 'LinkedIn', openai: 'OpenAI', chatgpt: 'ChatGPT',
  stackoverflow: 'Stack Overflow', huggingface: 'Hugging Face', arxiv: 'arXiv', npmjs: 'npm', figma: 'Figma',
  'mail.google.com': 'Gmail', 'docs.google.com': 'Google Docs', 'drive.google.com': 'Google Drive',
  'calendar.google.com': 'Calendar', 'analytics.google.com': 'Analytics', 'search.google.com': 'Search Console',
};

type Item = {
  tab: TabMetadata;
  key: string; // grouping unit: site or host
  site: string;
  category?: string;
  tokens: Set<string>;
  pathHead?: string;
};

export const categoryOf = (hostname: string): string | undefined => {
  if (HOST_CATEGORIES[hostname]) return HOST_CATEGORIES[hostname];
  const site = siteOf(`https://${hostname}/`);
  return SITE_CATEGORIES[hostname] ?? SITE_CATEGORIES[site];
};

const unitKey = (hostname: string): string => {
  const site = siteOf(`https://${hostname}/`);
  return MULTI_PRODUCT.has(site) ? hostname : site;
};

export const labelForUnit = (key: string): string => {
  if (BRAND_LABELS[key]) return BRAND_LABELS[key];
  const base = key.split('.')[0];
  return BRAND_LABELS[base] ?? siteLabel(key);
};

const toItem = (tab: TabMetadata): Item => {
  const site = siteOf(`https://${tab.hostname}/`);
  const brand = new Set(tokenize(site.split('.')[0] ?? ''));
  const tokens = new Set(tokenize(tab.title).filter((t) => !brand.has(t)));
  const firstSeg = tab.path?.split('/').filter((s) => s && s !== ':id')[0];
  return { tab, key: unitKey(tab.hostname), site, category: categoryOf(tab.hostname), tokens, pathHead: firstSeg };
};

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

const topTokens = (items: Item[], minShare: number): string[] => {
  const freq = new Map<string, number>();
  for (const it of items) for (const t of it.tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()]
    .filter(([, n]) => n >= Math.max(2, Math.ceil(items.length * minShare)))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([t]) => t);
};

export const nameForItems = (items: Item[]): { name: string; confidence: number; description: string } => {
  if (items.length === 0) return { name: 'New Canvas', confidence: 0, description: '' };
  const units = new Map<string, number>();
  const cats = new Map<string, number>();
  for (const it of items) {
    units.set(it.key, (units.get(it.key) ?? 0) + 1);
    if (it.category) cats.set(it.category, (cats.get(it.category) ?? 0) + 1);
  }
  const [topUnit, unitCount] = [...units.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  const [topCat, catCount] = [...cats.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  const tokens = topTokens(items, 0.4);
  const siteList = [...units.keys()].slice(0, 3).map(labelForUnit).join(', ');
  const description = `${items.length} tabs from ${siteList}${units.size > 3 ? '…' : ''}`;

  if (units.size === 1) {
    const label = labelForUnit(topUnit);
    const qualifier = tokens[0] ? ` · ${titleCase(tokens[0])}` : '';
    return { name: (label + qualifier).slice(0, 40), confidence: 0.85, description };
  }
  if (tokens.length > 0 && items.length >= 2) {
    return { name: titleCase(tokens.slice(0, 2).join(' ')).slice(0, 40), confidence: 0.6, description };
  }
  if (topCat && catCount / items.length >= 0.6) return { name: topCat, confidence: 0.75, description };
  if (unitCount / items.length >= 0.6) return { name: labelForUnit(topUnit), confidence: 0.6, description };
  return { name: topCat || `${labelForUnit(topUnit)} & more`, confidence: 0.45, description };
};

export const clusterLocally = (tabs: TabMetadata[], context?: ClusterContext): CanvasSuggestion[] => {
  const items = tabs.filter((t) => t.hostname).map(toItem);
  if (items.length < 2) return [];
  const uf = new UnionFind();
  const byId = new Map(items.map((it) => [it.tab.id, it]));

  // 1. Same unit (site / host) — the strongest local signal.
  const firstOfUnit = new Map<string, string>();
  for (const it of items) {
    const first = firstOfUnit.get(it.key);
    if (first) uf.union(first, it.tab.id);
    else firstOfUnit.set(it.key, it.tab.id);
  }
  // 2. Opener relationship — a link from Gmail to a shop is not the same topic,
  //    so it only counts together with a shared token or category.
  for (const it of items) {
    const opener = it.tab.openerId ? byId.get(it.tab.openerId) : undefined;
    if (!opener) continue;
    const sharesToken = [...it.tokens].some((t) => opener.tokens.has(t));
    if (sharesToken || (!!it.category && it.category === opener.category)) uf.union(opener.tab.id, it.tab.id);
  }
  // 3. Title similarity, opening-time proximity and URL path similarity across units.
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.key === b.key) continue;
      const sim = jaccard(a.tokens, b.tokens);
      let shared = 0;
      for (const t of a.tokens) if (b.tokens.has(t)) shared++;
      const closeInTime = Math.abs(a.tab.createdAt - b.tab.createdAt) < 90_000;
      const samePath = !!a.pathHead && a.pathHead.length > 3 && a.pathHead === b.pathHead;
      // Opening time only reinforces a real topical overlap; it never links tabs on its own.
      if ((sim >= 0.34 && shared >= 2) || (closeInTime && shared >= 1 && sim >= 0.25) || (samePath && shared >= 1)) {
        uf.union(a.tab.id, b.tab.id);
      }
    }
  }

  const clusters = new Map<string, Item[]>();
  for (const it of items) {
    const root = uf.find(it.tab.id);
    clusters.set(root, [...(clusters.get(root) ?? []), it]);
  }

  // 4. Fold singletons into a same-category cluster, or pool them per category.
  const multi = [...clusters.values()].filter((c) => c.length > 1);
  const singles = [...clusters.values()].filter((c) => c.length === 1).map((c) => c[0]);
  const pooled = new Map<string, Item[]>();
  for (const s of singles) {
    if (!s.category) continue;
    const home = multi.find((c) => c.filter((x) => x.category === s.category).length / c.length >= 0.6);
    if (home) home.push(s);
    else pooled.set(s.category, [...(pooled.get(s.category) ?? []), s]);
  }
  for (const group of pooled.values()) if (group.length > 1) multi.push(group);

  const canvases = context?.canvases ?? [];
  return multi
    .map((group): CanvasSuggestion => {
      const { name, confidence } = nameForItems(group);
      const match = matchExistingCanvas(name, group, canvases);
      return {
        id: uid(),
        name: match?.name ?? name,
        // Heuristic "N tabs from …" text would go stale on the canvas; only AI writes descriptions.
        description: undefined,
        tabIds: group.map((g) => g.tab.id),
        existingCanvasId: match?.id,
        confidence,
        source: 'local',
      };
    })
    .filter((s) => !(s.existingCanvasId && tabsOf(s, tabs).every((t) => t.canvasId === s.existingCanvasId)))
    .sort((a, b) => b.tabIds.length - a.tabIds.length);
};

const tabsOf = (s: CanvasSuggestion, tabs: TabMetadata[]) => tabs.filter((t) => s.tabIds.includes(t.id));

const matchExistingCanvas = (name: string, items: Item[], canvases: CanvasSummary[]): CanvasSummary | undefined => {
  let best: { c: CanvasSummary; score: number } | undefined;
  const hosts = new Set(items.map((i) => i.tab.hostname));
  for (const c of canvases) {
    if (normalize(c.name) === 'inbox') continue;
    const nameScore = normalize(c.name) === normalize(name) ? 1 : fuzzyScore(name, c.name) >= 80 ? 0.7 : 0;
    const overlap = c.hostnames.filter((h) => hosts.has(h)).length / Math.max(1, Math.min(hosts.size, c.hostnames.length));
    const score = Math.max(nameScore, overlap >= 0.5 ? overlap * 0.8 : 0);
    if (score >= 0.6 && (!best || score > best.score)) best = { c, score };
  }
  return best?.c;
};

export const suggestLocally = (tab: TabMetadata, canvases: CanvasSummary[]): CanvasAssignmentSuggestion => {
  const item = toItem(tab);
  let best: { id: string; score: number; reason: string } | undefined;
  for (const c of canvases) {
    if (normalize(c.name) === 'inbox') continue;
    const siteHit = c.hostnames.some((h) => unitKey(h) === item.key);
    const nameTokens = new Set([...tokenize(c.name), ...tokenize(c.description ?? '')]);
    const titleTokens = new Set(c.sampleTitles.flatMap((t) => tokenize(t)));
    const tokenSim = Math.max(jaccard(item.tokens, nameTokens) * 1.5, jaccard(item.tokens, titleTokens));
    const catHit = !!item.category && (normalize(c.name) === normalize(item.category) || c.hostnames.some((h) => categoryOf(h) === item.category));
    const score = (siteHit ? 0.6 : 0) + Math.min(0.35, tokenSim) + (catHit ? 0.2 : 0);
    if (!best || score > best.score) {
      const reason = siteHit ? `Other ${labelForUnit(item.key)} tabs live here` : catHit ? `Looks like ${item.category}` : 'Similar titles';
      best = { id: c.id, score, reason };
    }
  }
  if (!best || best.score < 0.45) return { tabId: tab.id, confidence: best?.score ?? 0, source: 'local' };
  return { tabId: tab.id, canvasId: best.id, confidence: Math.min(1, best.score), reason: best.reason, source: 'local' };
};

export class LocalHeuristicProvider implements AiGroupingProvider {
  id = 'local';
  label = 'On-device heuristics';
  isCloud = false;

  async isAvailable() {
    return true;
  }

  async clusterTabs(input: TabMetadata[], context?: ClusterContext) {
    return clusterLocally(input, context);
  }

  async suggestCanvasForTab(tab: TabMetadata, canvases: CanvasSummary[]) {
    return suggestLocally(tab, canvases);
  }

  async generateCanvasName(tabs: TabMetadata[]) {
    if (tabs.length === 0) return 'New Canvas';
    return nameForItems(tabs.filter((t) => t.hostname).map(toItem)).name;
  }
}
