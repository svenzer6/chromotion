// Sleeping tabs: a reopened tab first shows a tiny extension page and only
// navigates to the real URL when the user actually looks at it. This replaces
// chrome.tabs.discard, which crashed some Chromium builds on fresh tabs.

import { isWebUrl } from './url';

export const SLEEP_PATH = 'sleep/index.html';

const prefix = (base: string) => base.replace(/\/?$/, '/') + SLEEP_PATH;

export const sleepUrl = (base: string, url: string, title: string): string =>
  `${prefix(base)}#${new URLSearchParams({ u: url, t: title.slice(0, 200) }).toString()}`;

/** The real URL behind a sleeping tab, or undefined if `url` is not one of ours. */
export const unwrapSleepUrl = (base: string, url: string): string | undefined => {
  if (!url.startsWith(prefix(base))) return undefined;
  const hash = url.slice(url.indexOf('#') + 1);
  const target = new URLSearchParams(hash).get('u') ?? '';
  return isWebUrl(target) ? target : undefined;
};
