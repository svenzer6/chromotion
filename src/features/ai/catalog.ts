// Chromotion is free and fully open source: it never needs an account or an
// API key. Grouping runs on-device; optionally it can use an open-source model
// running on the user's own computer through an OpenAI-compatible local server.
// Model names are not hard-coded: the live /models list of the server is used.
// See docs/AI_PROVIDER_POLICY.md.

export type ProviderPreset = {
  id: string;
  label: string;
  baseUrl: string;
  docsUrl: string;
  note: string;
};

export const CATALOG_CHECKED_AT = '2026-10-07';

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
    note: 'Open source. Start Ollama with OLLAMA_ORIGINS=chrome-extension://* so the extension may talk to it.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    docsUrl: 'https://lmstudio.ai/docs',
    note: 'Free desktop app. Enable “Start server” in the Developer tab.',
  },
  {
    id: 'custom',
    label: 'Other local server',
    baseUrl: 'http://localhost:8080/v1',
    docsUrl: 'https://github.com/ggml-org/llama.cpp',
    note: 'Any OpenAI-compatible server on this computer (llama.cpp, Jan, vLLM, LocalAI…).',
  },
];

export const presetById = (id: string): ProviderPreset =>
  PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];

/** Only servers on this computer are allowed; returns the host permission pattern. */
export const originPattern = (baseUrl: string): string | undefined => {
  try {
    const u = new URL(baseUrl);
    if (!/^https?:$/.test(u.protocol) || !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return undefined;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return undefined;
  }
};
