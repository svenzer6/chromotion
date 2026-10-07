import { describe, expect, it, vi } from 'vitest';
import { AiGroupingService } from '../src/features/ai/AiGroupingService';
import { clusterLocally, suggestLocally } from '../src/features/ai/providers/localHeuristic';
import { extractJson, OpenAiCompatibleProvider, pickModel, type ProviderDeps } from '../src/features/ai/providers/openaiCompatible';
import { sleepUrl, unwrapSleepUrl } from '../src/lib/sleep';
import { sanitizePathForAi, siteOf } from '../src/lib/url';
import { DEFAULT_PREFERENCES } from '../src/storage/schema';
import type { AiProviderConfig, Preferences, TabMetadata } from '../src/types';

const t = (id: string, title: string, hostname: string, extra: Partial<TabMetadata> = {}): TabMetadata => ({
  id,
  title,
  hostname,
  createdAt: Number(id.replace(/\D/g, '')) * 1_000_000,
  ...extra,
});

const TABS: TabMetadata[] = [
  t('t1', 'Pull requests · acme/web', 'github.com'),
  t('t2', 'Issues · acme/web', 'github.com'),
  t('t3', 'Inbox (3) - me@acme.com - Gmail', 'mail.google.com'),
  t('t4', 'Calendar - Week of Oct 6', 'calendar.google.com'),
  t('t5', 'Wireless headphones : Amazon.com', 'amazon.com'),
  t('t6', 'Noise cancelling headphones | eBay', 'ebay.com'),
  t('t7', 'Random article', 'example.org'),
];

describe('sleeping tab urls', () => {
  it('round-trips and refuses non-web targets', () => {
    const base = 'chrome-extension://abc/';
    const s = sleepUrl(base, 'https://x.com/a?b=1#c', 'Title & more');
    expect(unwrapSleepUrl(base, s)).toBe('https://x.com/a?b=1#c');
    expect(unwrapSleepUrl(base, 'https://x.com/')).toBeUndefined();
    expect(unwrapSleepUrl(base, `${base}sleep/index.html#u=javascript%3Aalert(1)`)).toBeUndefined();
  });
});

describe('url sanitising', () => {
  it('drops query/fragment and masks identifiers', () => {
    expect(sanitizePathForAi('https://x.com/user/1234567/status?token=abc#f')).toBe('/user/:id/status');
    expect(sanitizePathForAi('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123/edit')).toBe('/document/d/:id');
    expect(sanitizePathForAi('chrome://settings')).toBeUndefined();
    expect(siteOf('https://docs.github.com/en')).toBe('github.com');
    expect(siteOf('https://www.bbc.co.uk/news')).toBe('bbc.co.uk');
  });
});

describe('local heuristic provider', () => {
  it('groups by site and category, leaves unrelated tabs alone', () => {
    const out = clusterLocally(TABS);
    const byTabs = out.map((s) => s.tabIds.sort().join(','));
    expect(byTabs).toContain('t1,t2');
    expect(byTabs).toContain('t3,t4');
    expect(byTabs).toContain('t5,t6');
    expect(out.flatMap((s) => s.tabIds)).not.toContain('t7');
    expect(out.find((s) => s.tabIds.includes('t3'))!.name).toBe('Communication');
    expect(out.find((s) => s.tabIds.includes('t1'))!.name).toMatch(/^GitHub/);
    expect(out.every((s) => s.source === 'local')).toBe(true);
  });

  it('matches existing canvases and suggests a canvas for a new tab', () => {
    const canvases = [
      { id: 'c1', name: 'Shopping', hostnames: ['amazon.com'], sampleTitles: ['Headphones'] },
      { id: 'c2', name: 'Dev', hostnames: ['github.com', 'stackoverflow.com'], sampleTitles: ['acme/web'] },
    ];
    const out = clusterLocally(TABS, { canvases });
    expect(out.find((s) => s.tabIds.includes('t5'))!.existingCanvasId).toBe('c1');
    const s = suggestLocally(t('t9', 'acme/api: Pull request #12', 'github.com'), canvases);
    expect(s.canvasId).toBe('c2');
    expect(suggestLocally(t('t10', 'Weather', 'weather.example'), canvases).canvasId).toBeUndefined();
  });

  it('handles 500 tabs quickly', () => {
    const many = Array.from({ length: 500 }, (_, i) => t(`t${i}`, `Doc ${i % 37} topic${i % 11}`, `site${i % 23}.com`));
    const started = performance.now();
    clusterLocally(many);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('openai-compatible provider', () => {
  it('extracts JSON from noisy replies', () => {
    expect(extractJson('<think>hmm {no}</think>```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"groups":[]} hope this helps')).toEqual({ groups: [] });
    expect(() => extractJson('no json')).toThrow();
  });

  it('picks only free chat models when required, without hard-coded names', () => {
    const models = [
      { id: 'vendor/big-405b', pricing: { prompt: '0.00001', completion: '0.00002' } },
      { id: 'vendor/embed-small:free', pricing: { prompt: '0', completion: '0' } },
      { id: 'vendor/chat-8b-instruct:free', pricing: { prompt: '0', completion: '0' } },
    ];
    expect(pickModel(models, true)).toBe('vendor/chat-8b-instruct:free');
    expect(pickModel([{ id: 'whisper-large' }], false)).toBeUndefined();
  });

  const config: AiProviderConfig = {
    id: 'p1', presetId: 'ollama', label: 'Ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', enabled: true,
  };
  const deps = (fetchImpl: typeof fetch): ProviderDeps => ({
    fetch: fetchImpl,
    hasPermission: async () => true,
    isCoolingDown: async () => false,
    getModelCache: async () => undefined,
    setModelCache: async () => undefined,
  });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('maps short ids back, dedupes tabs and drops hallucinated ids', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/models')) return json({ data: [{ id: 'llama-x-8b-instant' }] });
      const content = JSON.stringify({
        groups: [
          { name: 'Acme Dev', description: 'code', tabs: ['t1', 't2', 't99'], existing: null, confidence: 0.9 },
          { name: 'Dupes', tabs: ['t2', 't3'], existing: null },
        ],
      });
      return json({ choices: [{ message: { content } }] });
    }) as unknown as typeof fetch;
    const p = new OpenAiCompatibleProvider(config, deps(fetchMock));
    const input = TABS.slice(0, 3);
    const out = await p.clusterTabs(input);
    expect(out).toHaveLength(1); // "Dupes" has only one unused tab left
    expect(out[0].name).toBe('Acme Dev');
    expect(out[0].tabIds.sort()).toEqual(['t1', 't2'].map((k) => input[input.length - Number(k.slice(1))].id).sort());
    expect(p.lastModel).toBe('llama-x-8b-instant');
    const init = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1][1];
    expect(init.credentials).toBe('omit'); // cookies never travel with AI requests
    const sent = JSON.parse(JSON.parse(init.body as string).messages[1].content.split('\n\n').pop());
    expect(Object.keys(sent.tabs[0]).sort()).toEqual(['host', 'id', 'title']);
  });

  it('falls back to on-device heuristics when the local model server is busy', async () => {
    const setCooldown = vi.fn(async () => undefined);
    const prefs: Preferences = { ...DEFAULT_PREFERENCES, ai: { ...DEFAULT_PREFERENCES.ai, providers: [config] } };
    const service = new AiGroupingService(() => prefs, {
      ...deps((async () => json({ error: 'slow down' }, 429)) as unknown as typeof fetch),
      setCooldown,
    });
    const res = await service.organize(TABS, []);
    expect(res.providerId).toBe('local');
    expect(res.fellBackToLocal).toBe(true);
    expect(res.errors[0]).toMatch(/busy/);
    expect(setCooldown).toHaveBeenCalledWith('p1', expect.any(Number));
    expect(res.result.length).toBeGreaterThan(0);
  });

  it('skips disabled servers, servers without permission and non-local URLs', async () => {
    const p = new OpenAiCompatibleProvider({ ...config, enabled: false }, deps(fetch));
    expect(await p.isAvailable()).toBe(false);
    const remote = new OpenAiCompatibleProvider({ ...config, baseUrl: 'https://api.example.com/v1' }, deps(fetch));
    expect(await remote.isAvailable()).toBe(false);
    const p2 = new OpenAiCompatibleProvider(config, { ...deps(fetch), hasPermission: async () => false });
    expect(await p2.isAvailable()).toBe(false);
  });
});
