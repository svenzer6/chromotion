import { UI_PORT, type Command, type Response } from '../chrome/messaging';
import { Engine } from './engine';

// MV3 service worker entry. Listeners must be registered synchronously at the
// top level so Chrome can wake the worker for them; the engine queues work
// until recovery has finished.

const engine = new Engine();

const enablePanelOnActionClick = () =>
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => console.warn('[Chromotion]', err));

enablePanelOnActionClick();

self.addEventListener('error', (e) => engine.logError('worker', (e as ErrorEvent).error ?? (e as ErrorEvent).message));
self.addEventListener('unhandledrejection', (e) => engine.logError('worker promise', (e as PromiseRejectionEvent).reason));

chrome.runtime.onInstalled.addListener(() => {
  enablePanelOnActionClick();
  chrome.alarms.create('tc-backup', { periodInMinutes: 30, delayInMinutes: 5 });
  void engine.autoBackup('After install/update');
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('tc-backup', { periodInMinutes: 30, delayInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'tc-backup') void engine.autoBackup();
});

chrome.runtime.onSuspend?.addListener(() => {
  void engine.flush();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === UI_PORT && port.sender?.id === chrome.runtime.id) engine.connect(port);
});

chrome.runtime.onMessage.addListener((message: Command, sender, sendResponse: (r: Response) => void) => {
  if (sender.id !== chrome.runtime.id || typeof message?.type !== 'string') return false;
  engine
    .handle(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true;
});

chrome.tabs.onCreated.addListener(engine.onTabCreated);
chrome.tabs.onUpdated.addListener(engine.onTabUpdated);
chrome.tabs.onRemoved.addListener(engine.onTabRemoved);
chrome.tabs.onActivated.addListener(engine.onTabActivated);
chrome.tabs.onAttached.addListener(engine.onTabAttached);
chrome.tabs.onMoved.addListener(engine.onTabMoved);
chrome.tabs.onReplaced.addListener(engine.onTabReplaced);
chrome.tabGroups.onUpdated.addListener(engine.onGroupUpdated);
chrome.windows.onFocusChanged.addListener(engine.onWindowFocused);
