// Small text utilities shared by the heuristic grouper and search.

const STOPWORDS = new Set(
  (
    'a an and are as at be by for from has have how in is it its of on or that the this to was what when where who why will with you your ' +
    'new home page untitled welcome login sign log dashboard docs documentation search results google bing duckduckgo ' +
    'com org net www http https html htm php index inbox' +
    ' ' +
    've ile bir bu da de için ne nasıl ana sayfa giriş'
  ).split(' '),
);

export const normalize = (s: string): string =>
  s
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

export const tokenize = (s: string): string[] =>
  normalize(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t));

export const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
};

export const titleCase = (s: string): string =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

const isBoundary = (ch: string | undefined): boolean => ch === undefined || /[^\p{L}\p{N}]/u.test(ch);

/**
 * Fuzzy match score (0 = no match). Rewards prefix and word-start hits and
 * contiguous runs; cheap enough to run over 500+ items per keystroke.
 */
export const fuzzyScore = (query: string, target: string): number => {
  const q = normalize(query.trim());
  if (!q) return 1;
  const t = normalize(target);
  const idx = t.indexOf(q);
  if (idx === 0) return 100 + q.length;
  if (idx > 0) return (isBoundary(t[idx - 1]) ? 80 : 60) + q.length;
  // subsequence match — only when the letters stay reasonably close together
  let score = 0;
  let ti = 0;
  let run = 0;
  let first = -1;
  let chars = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found === -1) return 0;
    if (first === -1) first = found;
    chars++;
    run = found === ti ? run + 1 : 0;
    score += 1 + run * 2 + (isBoundary(t[found - 1]) ? 3 : 0);
    ti = found + 1;
  }
  if (ti - first > chars * 3 + 2) return 0;
  return Math.min(50, score);
};
