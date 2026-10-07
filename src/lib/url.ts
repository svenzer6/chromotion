// URL helpers. Anything that leaves the device goes through sanitizePathForAi.

const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.tr', 'org.tr', 'gov.tr', 'edu.tr', 'com.au', 'net.au', 'org.au',
  'co.jp', 'co.kr', 'com.br', 'com.cn', 'com.mx', 'co.in', 'co.nz', 'co.za', 'com.sg', 'github.io', 'vercel.app',
  'netlify.app', 'pages.dev', 'web.app', 'herokuapp.com',
]);

export const parseUrl = (url: string): URL | undefined => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

export const hostnameOf = (url: string): string => {
  const u = parseUrl(url);
  if (!u) return '';
  return u.hostname.replace(/^www\./, '');
};

/** Approximate eTLD+1 ("docs.github.com" -> "github.com"). Good enough for grouping. */
export const siteOf = (url: string): string => {
  const host = hostnameOf(url);
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
};

/** Human label for a site: "github.com" -> "Github". */
export const siteLabel = (site: string): string => {
  const base = site.split('.')[0] ?? site;
  return base.charAt(0).toUpperCase() + base.slice(1);
};

export const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url);

/** Internal pages are kept in canvases but never sent to AI. */
export const isInternalUrl = (url: string): boolean =>
  /^(chrome|chrome-extension|edge|about|devtools|view-source|file|data|blob|javascript):/i.test(url);

/** chrome.tabs.create cannot open some schemes; those are restored as the new tab page. */
export const isRestorableUrl = (url: string): boolean =>
  /^(https?|ftp):\/\//i.test(url) || /^chrome:\/\/(newtab|settings|extensions|history|downloads|bookmarks)/i.test(url);

const looksLikeIdentifier = (segment: string): boolean =>
  /^\d{4,}$/.test(segment) || // numeric ids
  /^[0-9a-f]{12,}$/i.test(segment) || // hex ids / hashes
  /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment) || // uuids
  (segment.length >= 20 && /[A-Za-z]/.test(segment) && /\d/.test(segment) && !segment.includes('-')) || // tokens
  /^[A-Za-z0-9_-]{24,}$/.test(segment);

/**
 * Minimal URL representation for cloud AI: no query string, no fragment, no
 * credentials, identifier-looking path segments masked, at most 3 segments.
 */
export const sanitizePathForAi = (url: string): string | undefined => {
  const u = parseUrl(url);
  if (!u || !isWebUrl(url)) return undefined;
  const segments = u.pathname
    .split('/')
    .filter(Boolean)
    .slice(0, 3)
    .map((s) => {
      let decoded = s;
      try {
        decoded = decodeURIComponent(s);
      } catch {
        /* keep raw */
      }
      return looksLikeIdentifier(decoded) ? ':id' : decoded.slice(0, 32);
    });
  if (segments.length === 0) return undefined;
  return ('/' + segments.join('/')).slice(0, 80);
};

export const displayUrl = (url: string): string => {
  const u = parseUrl(url);
  if (!u) return url;
  if (!isWebUrl(url)) return url;
  const path = u.pathname === '/' ? '' : u.pathname;
  return (u.hostname.replace(/^www\./, '') + path).slice(0, 120);
};
