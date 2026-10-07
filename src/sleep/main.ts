import { unwrapSleepUrl } from '../lib/sleep';

// Shows the tab's title/favicon while asleep; navigates to the real page the
// moment the tab becomes visible (or on click). Only http(s) targets allowed.

const target = unwrapSleepUrl(chrome.runtime.getURL('/'), location.href);
const title = new URLSearchParams(location.hash.slice(1)).get('t') || target || 'Sleeping tab';

const faviconFor = (pageUrl: string) => {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '32');
  return u.toString();
};

document.title = title;
document.getElementById('title')!.textContent = title;

if (target) {
  document.getElementById('url')!.textContent = target;
  const icon = faviconFor(target);
  (document.getElementById('favicon') as HTMLImageElement).src = icon;
  (document.getElementById('icon') as HTMLLinkElement).href = icon;
}

const wake = () => {
  if (target) location.replace(target);
};

document.getElementById('wake')!.addEventListener('click', wake);

// Wake only when this tab is the active one — page visibility alone is not
// reliable (headless and some window states report background tabs visible).
void chrome.tabs.getCurrent().then((me) => {
  if (!me?.id) return;
  if (me.active) return wake();
  chrome.tabs.onActivated.addListener(({ tabId }) => tabId === me.id && wake());
});
