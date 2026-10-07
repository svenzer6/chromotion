// End-to-end smoke test: loads dist/ into Playwright's Chromium and walks the
// MVP checklist. Web pages are faked with request interception (no network).
//   npm run build && npm run e2e            (add --headed to watch)
import { existsSync } from 'node:fs';
import { rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const profile = resolve(root, '.e2e-profile');
const shots = resolve(root, 'test-results');
const headed = process.argv.includes('--headed');

const PAGES = {
  'https://github.com/acme/web/pulls': 'Pull requests · acme/web',
  'https://github.com/acme/web/issues': 'Issues · acme/web',
  'https://mail.google.com/mail/u/0/': 'Inbox (3) - Gmail',
  'https://calendar.google.com/calendar/u/0/r': 'Google Calendar - Week of Oct 6',
  'https://www.amazon.com/s/headphones': 'Wireless headphones : Amazon.com',
  'https://www.ebay.com/b/headphones': 'Noise cancelling headphones | eBay',
  'https://example.org/random': 'A random article',
  // keeps the Inbox non-empty: an empty canvas would open the browser's New Tab page,
  // which crashes headless Microsoft Edge under automation (not the extension).
  'https://weather.example.net/today': 'Weather today',
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Branded Chrome (137+) ignores --load-extension. Use Playwright's Chromium;
 * if it is missing (e.g. removed by endpoint security), fall back to Edge,
 * which is Chromium-based and still honours the flag. Override: E2E_BROWSER=path.
 */
const browserPath = () => {
  if (process.env.E2E_BROWSER) return process.env.E2E_BROWSER;
  if (existsSync(chromium.executablePath())) return undefined;
  const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/microsoft-edge', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(existsSync);
  if (!edge) throw new Error('No Chromium found. Run `npx playwright install chromium` or set E2E_BROWSER.');
  return edge;
};

async function launch() {
  const executablePath = browserPath();
  const context = await chromium.launchPersistentContext(profile, {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }), // not the extension-less headless shell
    headless: !headed,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1200, height: 800 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, ...(headed ? [] : ['--headless=new'])],
  });
  console.log(`browser: ${executablePath ?? chromium.executablePath()}`);
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => {
    const url = route.request().url();
    if (/favicon|\.ico$/.test(url)) return route.fulfill({ status: 404, body: '' });
    const title = PAGES[url] ?? (url.match(/\/t\/(\d+)/) ? `Load test page ${url.match(/\/t\/(\d+)/)[1]}` : 'Page');
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1>` });
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
  const extensionId = new URL(sw.url()).host;
  return { context, sw, extensionId };
}

/** Panel page in a popup window: popups are not tracked as canvas tabs. */
async function openPanel(context, sw, extensionId) {
  const url = `chrome-extension://${extensionId}/sidepanel/index.html`;
  const pagePromise = context.waitForEvent('page', { predicate: (p) => p.url() === url, timeout: 10000 });
  await sw.evaluate((u) => chrome.windows.create({ url: u, type: 'popup', width: 380, height: 780 }), url);
  const panel = await pagePromise;
  await panel.waitForLoadState('domcontentloaded');
  await panel.setViewportSize({ width: 380, height: 780 });
  return panel;
}

const cmd = (page, command) =>
  page.evaluate(async (c) => {
    const res = await chrome.runtime.sendMessage(c);
    if (!res?.ok) throw new Error(res?.error ?? 'no response');
    return res.data;
  }, command);

const readState = (page) => page.evaluate(async () => (await chrome.storage.local.get('tc:state'))['tc:state']);
/** Live state = snapshot + journal, exactly what recovery would rebuild. */
const readLive = async (page) => {
  await sleep(2300); // snapshot debounce max-wait is 2s
  return readState(page);
};

const errors = [];

async function main() {
  await rm(profile, { recursive: true, force: true });
  await mkdir(shots, { recursive: true });

  // ------------------------------------------------------------ install
  let { context, sw, extensionId } = await launch();
  // Only extension pages count; the faked web (incl. Chromium's remote NTP) is not ours.
  context.on('weberror', (e) => {
    if (e.page()?.url().startsWith('chrome-extension://')) errors.push(`${e.page().url()}: ${e.error().message}`);
  });
  check('Extension installs (service worker running)', !!extensionId, extensionId);

  const first = context.pages()[0] ?? (await context.newPage());
  await first.goto(Object.keys(PAGES)[0]);
  for (const url of Object.keys(PAGES).slice(1)) {
    const p = await context.newPage();
    await p.goto(url);
  }
  const panel = await openPanel(context, sw, extensionId);
  panel.on('pageerror', (e) => errors.push(`panel: ${e.message}`));
  await panel.waitForSelector('.tab-row', { timeout: 10000 });

  let state = await readLive(panel);
  const urls = state.tabs.map((t) => t.url);
  check('Existing tabs are detected', Object.keys(PAGES).every((u) => urls.includes(u)), `${state.tabs.length} tabs tracked`);
  check('Starts with an Inbox canvas', state.canvases.length === 1 && state.canvases[0].name === 'Inbox');
  await panel.screenshot({ path: resolve(shots, '01-inbox-light.png') });

  // ------------------------------------------------------------ AI grouping (no provider => local)
  if (process.env.E2E_DEBUG) console.log(state.tabs.map((t) => `  ${t.title} | ${t.url}`).join('\n'));
  const batch = await cmd(panel, { type: 'ORGANIZE', scope: 'all' });
  check('AI grouping suggestion works', batch.suggestions.length >= 3, batch.suggestions.map((s) => `${s.name}(${s.tabIds.length})`).join(', '));
  check('Local fallback used when no AI is configured', batch.providerLabel === 'On-device heuristics');
  const random = state.tabs.find((t) => t.url === 'https://example.org/random');
  check('Unrelated tab is left alone', !batch.suggestions.some((s) => s.tabIds.includes(random.id)));

  await panel.waitForSelector('.banner', { timeout: 3000 });
  await panel.getByRole('button', { name: 'Review' }).click();
  await panel.waitForSelector('.sheet');
  await panel.screenshot({ path: resolve(shots, '02-review-sheet.png') });
  await panel.getByRole('button', { name: /^Apply/ }).click();
  await sleep(800);
  state = await readLive(panel);
  check('Canvases created from suggestions', state.canvases.length >= 4, state.canvases.map((c) => c.name).join(', '));

  const groups = await sw.evaluate(() => chrome.tabGroups.query({}));
  const names = state.canvases.map((c) => c.name);
  check('Canvases mirrored as Chrome tab groups', groups.filter((g) => names.includes(g.title)).length >= 3, groups.map((g) => `${g.title}${g.collapsed ? ' (collapsed)' : ''}`).join(', '));

  // ------------------------------------------------------------ rename / reorder / move
  const shopping =
    state.canvases.find((c) => c.name === 'Shopping') ??
    state.canvases.find((c) => c.id !== state.tabs.find((t) => t.id === random.id).canvasId && c.name !== 'Inbox') ??
    state.canvases[1];
  await cmd(panel, { type: 'RENAME_CANVAS', canvasId: shopping.id, name: 'Headphones Hunt' });
  const order = [...state.canvases].sort((a, b) => a.order - b.order).map((c) => c.id).reverse();
  await cmd(panel, { type: 'REORDER_CANVASES', orderedIds: order });
  await cmd(panel, { type: 'MOVE_TABS', tabIds: [random.id], canvasId: shopping.id });
  state = await readLive(panel);
  check('Canvas rename works', state.canvases.find((c) => c.id === shopping.id).name === 'Headphones Hunt');
  check('Canvas reorder works', [...state.canvases].sort((a, b) => a.order - b.order)[0].id === order[0]);
  check('Tab moves to a canvas', state.tabs.find((t) => t.id === random.id).canvasId === shopping.id);
  await sleep(400);
  const renamedGroup = (await sw.evaluate(() => chrome.tabGroups.query({}))).some((g) => g.title === 'Headphones Hunt');
  check('Rename propagates to the Chrome tab group', renamedGroup);

  // ------------------------------------------------------------ undo
  await cmd(panel, { type: 'UNDO' });
  state = await readLive(panel);
  check('Undo restores the previous move', state.tabs.find((t) => t.id === random.id).canvasId !== shopping.id);

  // ------------------------------------------------------------ drag & drop in the UI
  const target = [...state.canvases].sort((a, b) => a.order - b.order).find((c) => c.id !== state.lastActiveCanvasId);
  await panel.waitForSelector('.tab-row');
  const before = state.tabs.filter((t) => t.canvasId === target.id).length;
  const row = panel.locator('.tab-row').first();
  const rowTitle = await row.locator('.tab-title').innerText();
  await row.dragTo(panel.locator(`#canvas-${target.id}`));
  await sleep(600);
  state = await readLive(panel);
  check('Drag & drop tab onto a canvas', state.tabs.filter((t) => t.canvasId === target.id).length === before + 1, `"${rowTitle}" → ${target.name}`);

  // ------------------------------------------------------------ keyboard / palette
  await panel.keyboard.press('Control+k');
  await panel.waitForSelector('.palette');
  await panel.keyboard.type(target.name.slice(0, 4));
  await panel.screenshot({ path: resolve(shots, '03-palette.png') });
  await panel.keyboard.press('Enter');
  await sleep(1200);
  state = await readLive(panel);
  check('Ctrl+K palette switches canvas with keyboard only', state.lastActiveCanvasId === target.id && !(await panel.$('.palette')));
  const collapsed = (await sw.evaluate(() => chrome.tabGroups.query({}))).filter((g) => g.collapsed).length;
  check('Switching collapses the other canvases', collapsed >= 2, `${collapsed} groups collapsed`);

  await panel.locator(`#canvas-${target.id}`).focus();
  await panel.keyboard.press('ArrowDown');
  await panel.keyboard.press('F2');
  const renameInput = await panel.$('.canvas-item input');
  check('Keyboard navigation reaches canvases (Arrow + F2 rename)', !!renameInput);
  await panel.keyboard.press('Escape');

  // ------------------------------------------------------------ backups
  const json = await cmd(panel, { type: 'EXPORT', format: 'json' });
  const csv = await cmd(panel, { type: 'EXPORT', format: 'csv' });
  check('Lossless JSON backup exports', JSON.parse(json.text).state.tabs.length === state.tabs.length);
  check('CSV export has contract header', csv.text.startsWith('timestamp,canvas_id,canvas_name,tab_uuid,tab_title,tab_url,tab_position,tab_status,last_visited'));
  const handMade = 'canvas_name,tab_title,tab_url\r\nReading list,"Quotes, ""commas"" and more",https://example.org/a\r\nReading list,Second,https://example.org/b\r\n';
  const imported = await cmd(panel, { type: 'IMPORT_CSV', text: handMade });
  const reimport = await cmd(panel, { type: 'IMPORT_CSV', text: csv.text });
  check(
    'CSV import works (merge, duplicates skipped)',
    imported.tabs === 2 && imported.canvases === 1 && reimport.tabs === 0,
    `2 new tabs; re-importing own export skipped ${reimport.skippedDuplicates} duplicates`,
  );
  await cmd(panel, { type: 'UNDO' });
  const restored = await cmd(panel, { type: 'IMPORT_JSON', text: json.text });
  check('JSON restore works', restored.canvases === JSON.parse(json.text).state.canvases.length);

  // ------------------------------------------------------------ service worker crash
  const marker = `Crash test ${Date.now()}`;
  await cmd(panel, { type: 'CREATE_CANVAS', name: marker });
  // kill the worker immediately — before the debounced snapshot is written
  const cdp = await context.newCDPSession(panel);
  await cdp.send('ServiceWorker.enable').catch(() => {});
  await cdp.send('ServiceWorker.stopAllWorkers').catch((e) => errors.push(`stopAllWorkers: ${e.message}`));
  await sleep(1500);
  const swAfter = context.serviceWorkers().map((w) => w.url());
  const afterCrash = await cmd(panel, { type: 'LIST_BACKUPS' }).then(() => readLive(panel));
  check('State survives a service-worker restart (journal replay)', afterCrash.canvases.some((c) => c.name === marker), `workers after stop: ${swAfter.length}`);
  const panelRecovered = await panel.waitForSelector(`.canvas-item:has-text("${marker}")`, { timeout: 8000 }).then(() => true, () => false);
  check('Side panel reconnects after worker restart', panelRecovered);

  // ------------------------------------------------------------ 100+ tabs
  await sw.evaluate(async () => {
    for (let i = 0; i < 110; i++) await chrome.tabs.create({ url: `https://load.example.com/t/${i}`, active: false });
  });
  const inbox = afterCrash.canvases.find((c) => c.name === 'Inbox') ?? afterCrash.canvases[0];
  await sleep(2500);
  await cmd(panel, { type: 'SWITCH_CANVAS', canvasId: (await readLive(panel)).lastActiveCanvasId });
  const big = await readLive(panel);
  const biggest = [...big.canvases].map((c) => [c, big.tabs.filter((t) => t.canvasId === c.id).length]).sort((a, b) => b[1] - a[1])[0];
  await cmd(panel, { type: 'SWITCH_CANVAS', canvasId: biggest[0].id });
  await sleep(800);
  const t0 = Date.now();
  await panel.keyboard.press('Control+k');
  await panel.keyboard.type('load test page 10');
  await panel.waitForSelector('.palette-item:has-text("Load test page 10")');
  const searchMs = Date.now() - t0;
  await panel.keyboard.press('Escape');
  const loadTabs = big.tabs.filter((t) => t.url.includes('load.example.com'));
  const chromeTitles = await sw.evaluate(async () =>
    (await chrome.tabs.query({})).filter((t) => (t.url || '').includes('load.example.com')).map((t) => t.title),
  );
  const titled = loadTabs.filter((t) => t.title.startsWith('Load test page')).length;
  const chromeTitled = chromeTitles.filter((t) => t.startsWith('Load test page')).length;
  check('Tab titles stay in sync with Chrome', titled >= chromeTitled - 2, `${titled}/${loadTabs.length} titled in state, ${chromeTitled}/${chromeTitles.length} in Chrome`);
  const rendered = await panel.$$eval('.tab-row', (els) => els.length);
  check('100+ tabs: UI stays usable (virtualized list, fast search)', big.tabs.length >= 110 && rendered < 60 && searchMs < 1500, `${big.tabs.length} tabs, ${rendered} rows in DOM, search ${searchMs} ms`);
  await panel.screenshot({ path: resolve(shots, '04-many-tabs.png') });

  // ------------------------------------------------------------ theme
  await cmd(panel, { type: 'UPDATE_PREFERENCES', patch: { theme: 'dark' } });
  await sleep(500);
  check('Dark theme applies', (await panel.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await panel.screenshot({ path: resolve(shots, '05-dark.png') });
  await cmd(panel, { type: 'UPDATE_PREFERENCES', patch: { theme: 'light' } });
  await sleep(300);
  check('Light theme applies', (await panel.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await cmd(panel, { type: 'UPDATE_PREFERENCES', patch: { theme: 'system' } });

  // ------------------------------------------------------------ AI configured but unavailable
  await cmd(panel, {
    type: 'UPDATE_PREFERENCES',
    patch: { ai: { enabled: true, providers: [{ id: 'x', presetId: 'ollama', label: 'Ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', enabled: true }] } },
  });
  const fallback = await cmd(panel, { type: 'ORGANIZE', scope: 'all' });
  check('Local model missing / no permission does not break grouping', fallback.providerLabel === 'On-device heuristics', `${fallback.suggestions.length} suggestions`);
  await cmd(panel, { type: 'DISMISS_SUGGESTIONS' });

  // options page renders
  const opts = await context.newPage();
  opts.on('pageerror', (e) => errors.push(`options: ${e.message}`));
  await opts.goto(`chrome-extension://${extensionId}/options/index.html`);
  await opts.waitForSelector('#ai');
  await opts.screenshot({ path: resolve(shots, '06-options.png'), fullPage: true });
  check('Options page renders', true);
  await opts.goto(`chrome-extension://${extensionId}/options/index.html#about`);
  const about = await opts.waitForSelector('.about', { timeout: 5000 }).then((el) => el.innerText(), () => '');
  check('Signature: Burhan Celebi + e-mail on About', about.includes('Burhan Celebi') && about.includes('drburhancelebi@icloud.com'));
  const signature = await panel.locator('.signature').innerText().catch(() => '');
  check('Signature shown in side panel', signature.includes('Burhan Celebi'));
  const diag = await cmd(panel, { type: 'DIAGNOSTICS' });
  check('Diagnostics report available', diag.version === '0.2.0', `v${diag.version}, ${diag.errors.length} logged errors${diag.errors.length ? ': ' + diag.errors.map((e) => `[${e.where}] ${e.message}`).join(' | ') : ''}`);
  await opts.screenshot({ path: resolve(shots, '06b-about.png') });

  // Double-clicking an HTML file from dist/ must explain, not show a blank page.
  const fileView = await context.newPage();
  await fileView.goto(pathToFileURL(resolve(dist, 'sidepanel/index.html')).href);
  await sleep(2200);
  const fileText = await fileView.locator('body').innerText();
  check('Opening dist HTML directly shows install help', fileText.includes('Chrome extension') && fileText.includes('manifest.json'));
  await fileView.close();

  // ------------------------------------------------------------ browser restart
  const beforeRestart = await readLive(panel);
  await context.close();
  ({ context, sw, extensionId } = await launch());
  const panel2 = await openPanel(context, sw, extensionId);
  await panel2.waitForSelector('.canvas-item', { timeout: 10000 });
  await sleep(1500);
  const afterRestart = await readState(panel2);
  check(
    'State survives a browser restart',
    afterRestart.canvases.length === beforeRestart.canvases.length && afterRestart.tabs.length >= beforeRestart.tabs.length - 1,
    `${afterRestart.canvases.length} canvases, ${afterRestart.tabs.length} tabs (was ${beforeRestart.tabs.length})`,
  );
  panel2.on('close', () => console.log('  (panel window closed)'));
  context.on('close', () => console.log('  (browser closed)'));
  const reopenTarget = afterRestart.canvases.find((c) => c.name === 'Headphones Hunt') ?? afterRestart.canvases[1];
  await cmd(panel2, { type: 'SWITCH_CANVAS', canvasId: reopenTarget.id });
  await sleep(1500);
  const live = await readLive(panel2);
  const reopened = live.tabs.filter((t) => t.canvasId === reopenTarget.id && t.chromeTabId !== undefined).length;
  check('Stored tabs reopen when their canvas is opened', reopened > 0, `${reopened} tabs reopened in ${reopenTarget.name}`);

  // the biggest canvas: 100+ sleeping tabs must reopen lazily without hurting the browser
  const counts = live.canvases.map((c) => [c, live.tabs.filter((t) => t.canvasId === c.id && t.chromeTabId === undefined).length]);
  const [bigCanvas, sleeping] = counts.sort((a, b) => b[1] - a[1])[0];
  const started = Date.now();
  await cmd(panel2, { type: 'SWITCH_CANVAS', canvasId: bigCanvas.id });
  const switchMs = Date.now() - started;
  await sleep(1500);
  const asleep = await sw.evaluate(async () => {
    const prefix = chrome.runtime.getURL('sleep/index.html');
    return (await chrome.tabs.query({})).filter((t) => (t.url || t.pendingUrl || '').startsWith(prefix)).length;
  });
  const afterBig = await readLive(panel2);
  const bigTabs = afterBig.tabs.filter((t) => t.canvasId === bigCanvas.id);
  const nowOpen = bigTabs.filter((t) => t.chromeTabId !== undefined).length;
  const leaked = bigTabs.filter((t) => t.url.startsWith('chrome-extension://')).length;
  const chromeOrder = await sw.evaluate(async (ids) => {
    const all = await chrome.tabs.query({});
    return ids.map((id) => all.find((t) => t.id === id)?.index ?? -1);
  }, [...bigTabs].filter((t) => t.chromeTabId !== undefined).sort((a, b) => a.position - b.position).map((t) => t.chromeTabId));
  const ordered = chromeOrder.every((v, i) => i === 0 || v > chromeOrder[i - 1]);
  check('Reopened tabs keep canvas order', ordered);
  // Browsers differ: Chromium starts empty (tabs come back from Chromotion, asleep);
  // Edge restores the session itself (tabs must be re-attached by URL, not duplicated).
  const browserRestored = sleeping < 100;
  if (!browserRestored) {
    check(
      'Opening a canvas with 100+ sleeping tabs stays lazy',
      asleep >= sleeping - 2 && nowOpen >= sleeping && leaked === 0,
      `${sleeping} reopened in ${switchMs} ms, ${asleep} kept asleep, ${leaked} stored URLs rewritten`,
    );
    const sleeper = afterBig.tabs.find((t) => t.canvasId === bigCanvas.id && t.chromeTabId !== undefined && /\/t\/\d+$/.test(t.url));
    await cmd(panel2, { type: 'OPEN_TAB', tabId: sleeper.id });
    await sleep(1500);
    const woke = await sw.evaluate(async (id) => (await chrome.tabs.get(id)).url, sleeper.chromeTabId);
    check('A sleeping tab wakes up when opened', woke === sleeper.url, woke);
  } else {
    const web = afterBig.tabs.filter((t) => /^https?:/.test(t.url));
    const keys = web.map((t) => `${t.canvasId} ${t.url}`);
    const dupes = keys.length - new Set(keys).size;
    const attached = web.filter((t) => t.chromeTabId !== undefined).length;
    check('Browser-restored tabs are re-attached, not duplicated', dupes === 0 && attached >= web.length - 4, `${attached}/${web.length} web tabs attached, ${dupes} duplicates`);
  }
  await panel2.screenshot({ path: resolve(shots, '07-after-restart.png') });

  check('No uncaught errors in extension pages', errors.length === 0, errors.join(' | '));
  await context.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
