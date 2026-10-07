// Marketing screenshots with realistic demo data (no network: pages are faked).
//   npm run build && npm run screenshots   → docs/screenshots/*.png
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const out = resolve(root, 'docs/screenshots');
const profile = resolve(root, '.shots-profile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Neutral letter icons (not real brand logos).
const SITES = {
  'github.com': ['#24292F', 'G'],
  'arxiv.org': ['#B31B1B', 'a'],
  'docs.anthropic.com': ['#C2410C', 'A'],
  'huggingface.co': ['#F59E0B', 'H'],
  'paperswithcode.com': ['#0EA5E9', 'P'],
  'figma.com': ['#A259FF', 'F'],
  'mail.google.com': ['#EA4335', 'M'],
  'calendar.google.com': ['#1A73E8', '31'],
  'analytics.google.com': ['#F9AB00', 'A'],
  'acme-shop.com': ['#16A34A', 'A'],
  'booking.com': ['#003580', 'B'],
  'airbnb.com': ['#FF385C', 'a'],
  'maps.google.com': ['#34A853', 'M'],
  'trenitalia.com': ['#C8102E', 'T'],
  'amazon.com': ['#FF9900', 'a'],
  'ikea.com': ['#0058A3', 'I'],
  'youtube.com': ['#FF0000', '▶'],
  'news.ycombinator.com': ['#FF6600', 'Y'],
  'nytimes.com': ['#111111', 'T'],
  'stackoverflow.com': ['#F48024', 'S'],
};

const CANVASES = [
  {
    name: 'AI Research',
    accent: 'purple',
    tabs: [
      ['https://arxiv.org/abs/1706.03762', 'Attention Is All You Need'],
      ['https://docs.anthropic.com/en/docs/build-with-claude', 'Build with Claude – Anthropic Docs'],
      ['https://huggingface.co/models', 'Models – Hugging Face'],
      ['https://github.com/ollama/ollama', 'ollama/ollama: Get up and running with LLMs'],
      ['https://paperswithcode.com/sota', 'State of the Art – Papers with Code'],
      ['https://arxiv.org/abs/2005.14165', 'Language Models are Few-Shot Learners'],
      ['https://github.com/ggml-org/llama.cpp', 'ggml-org/llama.cpp: LLM inference in C/C++'],
    ],
  },
  {
    name: 'Client · Acme',
    accent: 'green',
    tabs: [
      ['https://mail.google.com/mail/u/0/#inbox', 'Inbox (4) – Acme project'],
      ['https://figma.com/design/acme-redesign', 'Acme Redesign – Figma'],
      ['https://analytics.google.com/analytics/web', 'Acme Store – Analytics'],
      ['https://acme-shop.com/', 'Acme Shop – Home'],
      ['https://calendar.google.com/calendar/r/week', 'Calendar – Week 41'],
    ],
  },
  {
    name: 'Trip to Rome',
    accent: 'orange',
    tabs: [
      ['https://booking.com/hotel/it/trastevere', 'Hotel in Trastevere – Booking.com'],
      ['https://airbnb.com/rooms/rome-loft', 'Sunny loft near Campo de’ Fiori'],
      ['https://maps.google.com/rome', 'Rome – Google Maps'],
      ['https://trenitalia.com/en', 'Trenitalia – Tickets'],
    ],
  },
  {
    name: 'Home Office',
    accent: 'cyan',
    tabs: [
      ['https://ikea.com/desk-bekant', 'BEKANT Desk – IKEA'],
      ['https://amazon.com/monitor-arm', 'Monitor arm, dual – Amazon.com'],
      ['https://youtube.com/watch?v=desk-setup', 'Minimal desk setup 2026 – YouTube'],
    ],
  },
];
const INBOX = [
  ['https://news.ycombinator.com/', 'Hacker News'],
  ['https://nytimes.com/section/technology', 'Technology – The New York Times'],
  ['https://stackoverflow.com/questions/chrome-tab-groups', 'How to use chrome.tabGroups API? – Stack Overflow'],
  ['https://github.com/acme/web/pulls', 'Pull requests · acme/web'],
  ['https://github.com/acme/web/issues', 'Issues · acme/web'],
  ['https://amazon.com/s/headphones', 'Wireless headphones – Amazon.com'],
];

const icon = (host) => {
  const [color, letter] = SITES[host] ?? ['#64748B', host[0].toUpperCase()];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><text x="16" y="22" font-family="Segoe UI,Arial" font-size="${letter.length > 1 ? 14 : 18}" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};
const allPages = new Map([...CANVASES.flatMap((c) => c.tabs), ...INBOX]);

const browserPath = () => {
  if (existsSync(chromium.executablePath())) return undefined;
  return ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
};

await rm(profile, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const executablePath = browserPath();
const context = await chromium.launchPersistentContext(profile, {
  ...(executablePath ? { executablePath } : { channel: 'chromium' }),
  headless: true,
  deviceScaleFactor: 2,
  ignoreDefaultArgs: ['--disable-extensions'],
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--headless=new'],
});
await context.route(/^https?:\/\/(?!localhost)/, (route) => {
  const url = route.request().url();
  if (/favicon\.ico$/.test(url)) return route.fulfill({ status: 404, body: '' });
  const host = new URL(url).hostname.replace(/^www\./, '');
  const title = allPages.get(url) ?? [...allPages].find(([u]) => u.split('#')[0] === url.split('#')[0])?.[1] ?? 'Page';
  return route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><meta charset="utf-8"><title>${title}</title><link rel="icon" href="${icon(host)}"><h1>${title}</h1>`,
  });
});
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const id = new URL(sw.url()).host;

const first = context.pages()[0];
const urls = [...CANVASES.flatMap((c) => c.tabs.map((t) => t[0])), ...INBOX.map((t) => t[0])];
await first.goto(urls[0]);
for (const u of urls.slice(1)) await (await context.newPage()).goto(u);
await sleep(1500);

const panelUrl = `chrome-extension://${id}/sidepanel/index.html`;
const pp = context.waitForEvent('page', { predicate: (p) => p.url() === panelUrl });
await sw.evaluate((u) => chrome.windows.create({ url: u, type: 'popup', width: 400, height: 820 }), panelUrl);
const panel = await pp;
await panel.setViewportSize({ width: 380, height: 780 });
await panel.waitForSelector('.tab-row');
await sleep(2500);

const cmd = (c) =>
  panel.evaluate(async (c) => {
    const r = await chrome.runtime.sendMessage(c);
    if (!r?.ok) throw new Error(r?.error);
    return r.data;
  }, c);
const state = () => panel.evaluate(async () => (await chrome.storage.local.get('tc:state'))['tc:state']);

let s = await state();
const idOf = (url) => s.tabs.find((t) => t.url === url)?.id;
const made = {};
for (const c of CANVASES) {
  const { canvasId } = await cmd({ type: 'CREATE_CANVAS', name: c.name, tabIds: c.tabs.map((t) => idOf(t[0])).filter(Boolean) });
  await cmd({ type: 'UPDATE_CANVAS', canvasId, patch: { accent: c.accent } });
  made[c.name] = canvasId;
}
await cmd({ type: 'DISMISS_SUGGESTIONS' });
const inboxId = s.canvases[0].id;
await cmd({ type: 'UPDATE_CANVAS', canvasId: inboxId, patch: { accent: 'blue' } });
await cmd({ type: 'REORDER_CANVASES', orderedIds: [...Object.values(made), inboxId] });

const shot = async (page, name, opts = {}) => {
  await sleep(700);
  // undo toasts are transient; keep them out of product shots
  await page.evaluate(() => document.querySelectorAll('.toast button[aria-label="Dismiss"]').forEach((b) => b.click()));
  await sleep(300);
  await page.screenshot({ path: resolve(out, name), ...opts });
  console.log('docs/screenshots/' + name);
};

// 1. light panel on AI Research, a tab highlighted
await cmd({ type: 'UPDATE_PREFERENCES', patch: { theme: 'light' } });
await cmd({ type: 'SWITCH_CANVAS', canvasId: made['AI Research'] });
s = await state();
await cmd({ type: 'OPEN_TAB', tabId: idOf('https://docs.anthropic.com/en/docs/build-with-claude') });
await sleep(1200);
await panel.mouse.move(1, 1);
await shot(panel, 'panel-light.png');

// 2. dark panel on Client · Acme
await cmd({ type: 'UPDATE_PREFERENCES', patch: { theme: 'dark' } });
await cmd({ type: 'SWITCH_CANVAS', canvasId: made['Client · Acme'] });
await cmd({ type: 'OPEN_TAB', tabId: idOf('https://figma.com/design/acme-redesign') });
await sleep(1200);
await shot(panel, 'panel-dark.png');

// 3. command palette (light)
await cmd({ type: 'UPDATE_PREFERENCES', patch: { theme: 'light' } });
await cmd({ type: 'SWITCH_CANVAS', canvasId: made['Trip to Rome'] });
await sleep(800);
await panel.keyboard.press('Control+k');
await panel.keyboard.type('rome', { delay: 40 });
await shot(panel, 'palette.png');
await panel.keyboard.press('Escape');

// 4. AI organize review (Inbox has mixed tabs)
await cmd({ type: 'SWITCH_CANVAS', canvasId: inboxId });
await sleep(800);
await cmd({ type: 'ORGANIZE', scope: 'canvas', canvasId: inboxId });
await panel.getByRole('button', { name: 'Review' }).click();
await panel.waitForSelector('.sheet');
await shot(panel, 'organize.png');
await panel.keyboard.press('Escape');

// 5. dark organize banner + canvas list
await cmd({ type: 'UPDATE_PREFERENCES', patch: { theme: 'dark' } });
await shot(panel, 'suggestion-dark.png');
await cmd({ type: 'DISMISS_SUGGESTIONS' });

// 6. settings page
await cmd({ type: 'UPDATE_PREFERENCES', patch: { theme: 'system' } });
const opts = await context.newPage();
await opts.emulateMedia({ colorScheme: 'light' });
await opts.goto(`chrome-extension://${id}/options/index.html`);
await opts.waitForSelector('#ai');
await shot(opts, 'settings.png');
await opts.goto(`chrome-extension://${id}/options/index.html#about`);
await sleep(600);
await shot(opts, 'about.png');

await context.close();
await rm(profile, { recursive: true, force: true });
