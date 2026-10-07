import { uid } from '../../../lib/id';
import { normalize } from '../../../lib/text';
import type {
  AiProviderConfig,
  CanvasAssignmentSuggestion,
  CanvasSuggestion,
  CanvasSummary,
  TabMetadata,
} from '../../../types';
import { originPattern } from '../catalog';
import { ProviderError, type AiGroupingProvider, type ClusterContext } from '../types';

// One implementation covers every catalog provider: they all speak the
// OpenAI chat-completions dialect. Model ids come from the live /models list.

export type ProviderDeps = {
  fetch: typeof fetch;
  hasPermission: (origin: string) => Promise<boolean>;
  isCoolingDown: (providerId: string) => Promise<boolean>;
  getModelCache: (providerId: string) => Promise<{ model: string; at: number } | undefined>;
  setModelCache: (providerId: string, model: string) => Promise<void>;
};

const MAX_CLOUD_TABS = 120;
const REQUEST_TIMEOUT_MS = 25_000;
const MODEL_CACHE_MS = 24 * 60 * 60 * 1000;

type ModelEntry = { id: string; pricing?: { prompt?: string; completion?: string } };

const NON_CHAT = /(embed|whisper|tts|speech|audio|transcri|image|imagen|veo|vision-only|guard|moderation|rerank|realtime|search-preview|aqa|dall-e|sora|lyria|clip|ocr|safety)/i;

/** Pick a reasonable chat model from a live model list without hard-coding names. */
export const pickModel = (models: ModelEntry[], freeOnly: boolean): string | undefined => {
  const candidates = models.filter((m) => {
    if (!m.id || NON_CHAT.test(m.id)) return false;
    if (!freeOnly) return true;
    const p = Number(m.pricing?.prompt ?? NaN);
    const c = Number(m.pricing?.completion ?? NaN);
    return m.id.endsWith(':free') || (p === 0 && c === 0);
  });
  const score = (id: string) => {
    const s = id.toLowerCase();
    let v = 0;
    if (/(flash|instant|lite|mini|small|scout|haiku|nano|oss)/.test(s)) v += 4;
    if (/(\b|-)(7|8|9|12|14|17|20|24|27|30|32)b/.test(s)) v += 3;
    if (/(instruct|chat|versatile|it\b)/.test(s)) v += 2;
    if (/(preview|exp|experimental|beta)/.test(s)) v -= 2;
    if (/(thinking|reason|r1|qwq)/.test(s)) v -= 1; // slower; tab grouping does not need it
    if (/(405b|235b|480b|671b|1t)/.test(s)) v -= 2;
    return v;
  };
  return candidates.sort((a, b) => score(b.id) - score(a.id) || a.id.localeCompare(b.id))[0]?.id;
};

/** Extract the first JSON object from a model reply (handles <think> blocks and code fences). */
export const extractJson = (text: string): unknown => {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : cleaned;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new ProviderError('Model reply contained no JSON object', 'bad-response');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new ProviderError('Model reply was not valid JSON', 'bad-response');
  }
};

const SYSTEM_PROMPT =
  'You organise web browser tabs into focused workspaces called Canvases. ' +
  'You only see tab titles, hostnames and short URL paths. Reply with a single JSON object and nothing else.';

export class OpenAiCompatibleProvider implements AiGroupingProvider {
  readonly id: string;
  readonly label: string;
  readonly isCloud: boolean;
  lastModel?: string;

  constructor(
    private readonly config: AiProviderConfig,
    private readonly deps: ProviderDeps,
  ) {
    this.id = config.id;
    this.label = config.label;
    this.isCloud = false; // only servers on this computer are allowed
  }

  private get base() {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.enabled || !this.config.baseUrl) return false;
    const origin = originPattern(this.config.baseUrl);
    if (!origin || !(await this.deps.hasPermission(origin))) return false;
    return !(await this.deps.isCoolingDown(this.id));
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    return h;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.deps.fetch(`${this.base}${path}`, {
        ...init,
        headers: this.headers(),
        signal: ctrl.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new ProviderError(`${this.label} timed out`, 'timeout');
      throw new ProviderError(`${this.label} is unreachable`, 'network');
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return res;
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new ProviderError(`${this.label}: request refused (check the server's allowed origins)`, 'auth', res.status);
    if (res.status === 429) throw new ProviderError(`${this.label}: server is busy`, 'rate-limit', 429);
    if (res.status >= 500) throw new ProviderError(`${this.label}: server error ${res.status}`, 'server', res.status);
    throw new ProviderError(`${this.label}: HTTP ${res.status} ${detail}`, 'bad-response', res.status);
  }

  async listModels(): Promise<ModelEntry[]> {
    const res = await this.request('/models', { method: 'GET' });
    const body = (await res.json().catch(() => ({}))) as { data?: ModelEntry[]; models?: ModelEntry[] };
    return (body.data ?? body.models ?? []).filter((m) => typeof m?.id === 'string');
  }

  async resolveModel(): Promise<string> {
    if (this.config.model) return this.config.model;
    const cached = await this.deps.getModelCache(this.id);
    if (cached && Date.now() - cached.at < MODEL_CACHE_MS) return cached.model;
    const model = pickModel(await this.listModels(), false);
    if (!model) throw new ProviderError(`${this.label}: no chat model is loaded`, 'config');
    await this.deps.setModelCache(this.id, model);
    return model;
  }

  async complete(user: string, maxTokens: number): Promise<unknown> {
    const model = await this.resolveModel();
    this.lastModel = model;
    const body = {
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
    };
    let res: Response;
    try {
      res = await this.request('/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ ...body, response_format: { type: 'json_object' } }),
      });
    } catch (err) {
      // Some free models reject response_format; retry once without it.
      if (!(err instanceof ProviderError) || err.status !== 400) throw err;
      res = await this.request('/chat/completions', { method: 'POST', body: JSON.stringify(body) });
    }
    const json = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new ProviderError(`${this.label}: empty reply`, 'bad-response');
    return extractJson(content);
  }

  async clusterTabs(input: TabMetadata[], context?: ClusterContext): Promise<CanvasSuggestion[]> {
    const tabs = [...input].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_CLOUD_TABS);
    const key = new Map(tabs.map((t, i) => [`t${i + 1}`, t]));
    const payload = {
      tabs: [...key.entries()].map(([k, t]) => ({ id: k, title: t.title, host: t.hostname, ...(t.path ? { path: t.path } : {}) })),
      existingCanvases: (context?.canvases ?? []).map((c) => c.name),
    };
    const prompt =
      'Group these browser tabs into meaningful Canvases (topics, projects or clients).\n' +
      'Rules:\n' +
      '- Each group needs at least 2 tabs. Leave unrelated tabs out; never force them.\n' +
      '- A tab id may appear in at most one group.\n' +
      '- Names: 1-3 words, Title Case, specific (e.g. "AI Research", "Client A", "Trip to Rome").\n' +
      '- If a group fits one of existingCanvases, set "existing" to that exact name.\n' +
      '- description: max 12 words.\n' +
      'Return: {"groups":[{"name":string,"description":string,"tabs":[tab ids],"existing":string|null,"confidence":number 0-1}]}\n\n' +
      JSON.stringify(payload);

    const raw = (await this.complete(prompt, 1800)) as { groups?: unknown };
    if (!Array.isArray(raw.groups)) throw new ProviderError(`${this.label}: reply had no "groups"`, 'bad-response');

    const byName = new Map((context?.canvases ?? []).map((c) => [normalize(c.name), c]));
    const used = new Set<string>();
    const out: CanvasSuggestion[] = [];
    for (const g of raw.groups as Record<string, unknown>[]) {
      if (!g || typeof g !== 'object') continue;
      const ids = (Array.isArray(g.tabs) ? g.tabs : [])
        .map((k) => key.get(String(k))?.id)
        .filter((id): id is string => !!id && !used.has(id));
      const existing = typeof g.existing === 'string' ? byName.get(normalize(g.existing)) : undefined;
      if (ids.length < (existing ? 1 : 2)) continue;
      ids.forEach((id) => used.add(id));
      const name = String(g.name ?? existing?.name ?? '').trim().slice(0, 40);
      if (!name) continue;
      const confidence = typeof g.confidence === 'number' ? Math.max(0, Math.min(1, g.confidence)) : 0.7;
      out.push({
        id: uid(),
        name: existing?.name ?? name,
        description: typeof g.description === 'string' ? g.description.slice(0, 140) : undefined,
        tabIds: ids,
        existingCanvasId: existing?.id,
        confidence,
        source: this.id,
      });
    }
    return out
      .filter((s) => !(s.existingCanvasId && s.tabIds.every((id) => input.find((t) => t.id === id)?.canvasId === s.existingCanvasId)))
      .sort((a, b) => b.tabIds.length - a.tabIds.length);
  }

  async suggestCanvasForTab(tab: TabMetadata, canvases: CanvasSummary[]): Promise<CanvasAssignmentSuggestion> {
    const prompt =
      'Which existing Canvas does this tab belong to? Answer null if none fits well.\n' +
      'Return: {"canvas": string|null, "confidence": number 0-1, "reason": string (max 8 words)}\n\n' +
      JSON.stringify({
        tab: { title: tab.title, host: tab.hostname, path: tab.path },
        canvases: canvases.map((c) => ({ name: c.name, hosts: c.hostnames.slice(0, 5) })),
      });
    const raw = (await this.complete(prompt, 200)) as { canvas?: unknown; confidence?: unknown; reason?: unknown };
    const match = canvases.find((c) => typeof raw.canvas === 'string' && normalize(c.name) === normalize(raw.canvas));
    return {
      tabId: tab.id,
      canvasId: match?.id,
      confidence: typeof raw.confidence === 'number' ? raw.confidence : match ? 0.6 : 0,
      reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 80) : undefined,
      source: this.id,
    };
  }

  async generateCanvasName(tabs: TabMetadata[]): Promise<string> {
    const prompt =
      'Name a workspace containing these tabs. 1-3 words, Title Case, specific.\n' +
      'Return: {"name": string}\n\n' +
      JSON.stringify(tabs.slice(0, 40).map((t) => ({ title: t.title, host: t.hostname })));
    const raw = (await this.complete(prompt, 60)) as { name?: unknown };
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
    if (!name) throw new ProviderError(`${this.label}: no name returned`, 'bad-response');
    return name;
  }
}
