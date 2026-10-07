import type { CanvasAssignmentSuggestion, CanvasSuggestion, CanvasSummary, TabMetadata } from '../../types';

export type ClusterContext = {
  canvases: CanvasSummary[];
};

export interface AiGroupingProvider {
  id: string;
  label: string;
  isCloud: boolean;
  isAvailable(): Promise<boolean>;

  clusterTabs(input: TabMetadata[], context?: ClusterContext): Promise<CanvasSuggestion[]>;
  suggestCanvasForTab(tab: TabMetadata, canvases: CanvasSummary[]): Promise<CanvasAssignmentSuggestion>;

  generateCanvasName(tabs: TabMetadata[]): Promise<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate-limit' | 'server' | 'network' | 'timeout' | 'bad-response' | 'config',
    readonly status?: number,
  ) {
    super(message);
  }
}
