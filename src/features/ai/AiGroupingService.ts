import { withTimeout } from '../../lib/async';
import type {
  AiProviderConfig,
  CanvasAssignmentSuggestion,
  CanvasSuggestion,
  CanvasSummary,
  Preferences,
  TabMetadata,
} from '../../types';
import { LocalHeuristicProvider } from './providers/localHeuristic';
import { OpenAiCompatibleProvider, type ProviderDeps } from './providers/openaiCompatible';
import { ProviderError, type AiGroupingProvider } from './types';

export type AiRunResult<T> = {
  result: T;
  providerId: string;
  providerLabel: string;
  model?: string;
  fellBackToLocal: boolean;
  errors: string[];
};

const COOLDOWN_MS: Partial<Record<ProviderError['kind'], number>> = {
  'rate-limit': 10 * 60_000,
  server: 2 * 60_000,
  network: 60_000,
  timeout: 2 * 60_000,
};

export type ServiceDeps = ProviderDeps & {
  setCooldown: (providerId: string, until: number) => Promise<void>;
};

/**
 * Provider chain: user-configured free providers in priority order, then the
 * on-device heuristic. A failing provider never breaks the product — it is put
 * on cooldown and the next one is tried.
 */
export class AiGroupingService {
  readonly local = new LocalHeuristicProvider();

  constructor(
    private readonly getPrefs: () => Preferences,
    private readonly deps: ServiceDeps,
  ) {}

  createProvider(config: AiProviderConfig): OpenAiCompatibleProvider {
    return new OpenAiCompatibleProvider(config, this.deps);
  }

  chain(): AiGroupingProvider[] {
    const prefs = this.getPrefs();
    const remote = prefs.ai.enabled ? prefs.ai.providers.filter((p) => p.enabled).map((p) => this.createProvider(p)) : [];
    return [...remote, this.local];
  }

  private async run<T>(
    label: string,
    task: (p: AiGroupingProvider) => Promise<T>,
    accept: (r: T) => boolean = () => true,
  ): Promise<AiRunResult<T>> {
    const errors: string[] = [];
    for (const provider of this.chain()) {
      if (provider !== this.local && !(await provider.isAvailable().catch(() => false))) continue;
      try {
        const result = await withTimeout(task(provider), provider === this.local ? 10_000 : 30_000, label);
        if (!accept(result)) {
          errors.push(`${provider.label}: returned nothing usable`);
          continue;
        }
        return {
          result,
          providerId: provider.id,
          providerLabel: provider.label,
          model: provider instanceof OpenAiCompatibleProvider ? provider.lastModel : undefined,
          fellBackToLocal: provider === this.local && errors.length > 0,
          errors,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(message);
        const kind = err instanceof ProviderError ? err.kind : 'timeout';
        const cool = COOLDOWN_MS[kind];
        if (cool) await this.deps.setCooldown(provider.id, Date.now() + cool);
      }
    }
    // The local provider never throws in practice; this is a last resort.
    throw new Error(errors.join('; ') || `${label} failed`);
  }

  /**
   * @param cloudTabs minimised metadata for cloud providers
   * @param deviceTabs richer metadata for on-device providers (local heuristic, Ollama, LM Studio)
   */
  organize(cloudTabs: TabMetadata[], canvases: CanvasSummary[], deviceTabs = cloudTabs): Promise<AiRunResult<CanvasSuggestion[]>> {
    const task = (p: AiGroupingProvider) => p.clusterTabs(p.isCloud ? cloudTabs : deviceTabs, { canvases });
    return this.run('Grouping', task, (r) => r.length > 0).catch(async () => ({
      result: [],
      providerId: 'local',
      providerLabel: this.local.label,
      fellBackToLocal: true,
      errors: [],
    }));
  }

  /** New-tab suggestions run on-device only: fast, private and free of rate limits. */
  suggestForTab(tab: TabMetadata, canvases: CanvasSummary[]): Promise<CanvasAssignmentSuggestion> {
    return this.local.suggestCanvasForTab(tab, canvases);
  }

  generateName(tabs: TabMetadata[]): Promise<AiRunResult<string>> {
    return this.run('Naming', (p) => p.generateCanvasName(tabs), (r) => r.trim().length > 0);
  }
}
