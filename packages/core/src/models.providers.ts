/**
 * Provider-agnostic model adapters (Vercel AI SDK 7).
 *
 * One factory, six providers:
 *   openai            — @ai-sdk/openai        (official)
 *   anthropic         — @ai-sdk/anthropic     (official)
 *   deepseek          — @ai-sdk/deepseek      (official)
 *   glm               — @ai-sdk/zai           (Zhipu GLM, official)
 *   openai-compatible — @ai-sdk/openai-compatible (any baseURL: Ollama, vLLM,
 *                       Groq, OpenRouter, self-hosted gateways, …)
 *   fake              — deterministic local model (tests/benchmarks, no keys)
 *
 * Switching is env-driven and supports a generator/judge split (different
 * providers per role — the judge should ideally be a different model family
 * than the generator).
 *
 * Structured output uses the AI SDK 7 pattern:
 *   generateText({ output: Output.object({ schema }) })
 * validated with Zod at every model boundary, with capped retries.
 */
import type { ZodType } from 'zod';
import type { LanguageModel } from 'ai';
import { generateText, Output } from 'ai';
import type { GenerateRequest, ModelAdapter } from './models';
import { withRetries } from './models';
import type { Usage } from '@agharta/shared';

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

export const PROVIDER_IDS = ['openai', 'anthropic', 'deepseek', 'glm', 'openai-compatible', 'fake'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Alias table so env values like "zai"/"zhipu" map to the glm provider. */
const PROVIDER_ALIASES: Record<string, ProviderId> = {
  zai: 'glm',
  zhipu: 'glm',
  chatglm: 'glm',
  'openai_compatible': 'openai-compatible',
  openaicompatible: 'openai-compatible',
  local: 'fake',
};

export function normalizeProvider(raw: string | undefined): ProviderId {
  const v = (raw ?? 'fake').trim().toLowerCase();
  if ((PROVIDER_IDS as readonly string[]).includes(v)) return v as ProviderId;
  if (PROVIDER_ALIASES[v]) return PROVIDER_ALIASES[v]!;
  throw new Error(
    `Unknown AI_PROVIDER "${raw}". Supported: ${PROVIDER_IDS.join(', ')} (aliases: zai/zhipu→glm).`
  );
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

export interface CostTable {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * Rough list-price estimates (USD per 1M tokens) used ONLY for budget caps and
 * dashboard spend display — never for billing. Prices change; override with
 * MODEL_COST_INPUT / MODEL_COST_OUTPUT (per-role: CREATIVE_COST_INPUT, …).
 * `null` means "unknown" → cost tracked as $0 and budget falls back to
 * token/wall-clock caps.
 */
export const DEFAULT_COST_TABLES: Partial<Record<ProviderId, CostTable>> = {
  openai: { inputPerMillion: 1.25, outputPerMillion: 10 },
  anthropic: { inputPerMillion: 3, outputPerMillion: 15 },
  deepseek: { inputPerMillion: 0.27, outputPerMillion: 1.1 },
  glm: { inputPerMillion: 0.6, outputPerMillion: 2.2 },
};

function estimateCost(table: CostTable | null | undefined, inputTokens: number, outputTokens: number): number {
  if (!table) return 0;
  return (inputTokens / 1e6) * table.inputPerMillion + (outputTokens / 1e6) * table.outputPerMillion;
}

// ---------------------------------------------------------------------------
// Adapter construction
// ---------------------------------------------------------------------------

export interface ProviderModelOptions {
  provider: ProviderId;
  modelId: string;
  apiKey?: string;
  /** required for openai-compatible */
  baseURL?: string;
  /** label for openai-compatible accounting */
  providerName?: string;
  costTable?: CostTable | null;
  maxRetries?: number;
}

async function loadLanguageModel(opts: ProviderModelOptions): Promise<LanguageModel> {
  const key = opts.apiKey ?? '';
  switch (opts.provider) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI({ apiKey: key, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}) })(opts.modelId);
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      return createAnthropic({ apiKey: key })(opts.modelId);
    }
    case 'deepseek': {
      const { createDeepSeek } = await import('@ai-sdk/deepseek');
      return createDeepSeek({ apiKey: key })(opts.modelId);
    }
    case 'glm': {
      const { createZai } = await import('@ai-sdk/zai');
      return createZai({ apiKey: key })(opts.modelId);
    }
    case 'openai-compatible': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      if (!opts.baseURL) throw new Error('openai-compatible provider requires MODEL_BASE_URL (e.g. http://localhost:11434/v1)');
      return createOpenAICompatible({
        name: opts.providerName ?? 'openai-compatible',
        baseURL: opts.baseURL,
        apiKey: key || undefined,
      })(opts.modelId);
    }
    default:
      throw new Error(`loadLanguageModel: provider "${opts.provider}" has no real model (use createFakeModel)`);
  }
}

export async function createProviderModelAdapter(opts: ProviderModelOptions): Promise<ModelAdapter> {
  const model = await loadLanguageModel(opts);
  const retries = opts.maxRetries ?? 2;
  // unknown table → null → cost $0 (token/wall-clock caps still bound the run)
  const table = opts.costTable !== undefined ? opts.costTable : (DEFAULT_COST_TABLES[opts.provider] ?? null);
  return {
    providerId: opts.provider,
    modelId: opts.modelId,
    costTable: table ?? { inputPerMillion: 0, outputPerMillion: 0 },
    async generate<T>(req: GenerateRequest, schema: ZodType<T>): Promise<{ data: T; usage: Usage; modelId: string }> {
      const result = await withRetries(`${opts.provider}:${req.operator}`, retries, async () =>
        generateText({
          model,
          system: req.system,
          prompt: req.prompt,
          output: Output.object({ schema: schema as ZodType<T> }),
        })
      );
      const inputTokens = result.usage.inputTokens ?? 0;
      const outputTokens = result.usage.outputTokens ?? 0;
      return {
        data: result.output,
        usage: {
          inputTokens,
          outputTokens,
          costUsd: estimateCost(table, inputTokens, outputTokens),
          modelCalls: 1,
          wallClockMs: 0,
        },
        modelId: opts.modelId,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Environment wiring (Convex actions, benchmarks, MCP)
// ---------------------------------------------------------------------------

export interface ProviderEnv {
  /** default provider for both roles unless role-split below */
  AI_PROVIDER?: string;
  /** role splits (take precedence over AI_PROVIDER) */
  CREATIVE_PROVIDER?: string;
  JUDGE_PROVIDER?: string;
  /** API keys per provider */
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  /** GLM/Zhipu accepts either name */
  GLM_API_KEY?: string;
  ZHIPU_API_KEY?: string;
  ZAI_API_KEY?: string;
  /** role-specific keys (rare; usually one key per provider) */
  CREATIVE_API_KEY?: string;
  JUDGE_API_KEY?: string;
  /** model ids */
  CREATIVE_MODEL_ID?: string;
  JUDGE_MODEL_ID?: string;
  /** baseURL for openai-compatible (and openai override) */
  MODEL_BASE_URL?: string;
  CREATIVE_BASE_URL?: string;
  JUDGE_BASE_URL?: string;
  /** cost overrides, USD per 1M tokens */
  MODEL_COST_INPUT?: string;
  MODEL_COST_OUTPUT?: string;
  CREATIVE_COST_INPUT?: string;
  CREATIVE_COST_OUTPUT?: string;
  JUDGE_COST_INPUT?: string;
  JUDGE_COST_OUTPUT?: string;
}

function apiKeyFor(provider: ProviderId, env: ProviderEnv, roleKey?: string): string | undefined {
  if (roleKey) return roleKey;
  switch (provider) {
    case 'openai': return env.OPENAI_API_KEY;
    case 'anthropic': return env.ANTHROPIC_API_KEY;
    case 'deepseek': return env.DEEPSEEK_API_KEY;
    case 'glm': return env.GLM_API_KEY ?? env.ZHIPU_API_KEY ?? env.ZAI_API_KEY;
    case 'openai-compatible': return env.OPENAI_API_KEY; // most gateways issue OpenAI-style keys
    default: return undefined;
  }
}

/** Sensible example model ids per provider — verify against provider docs. */
const EXAMPLE_MODEL_IDS: Partial<Record<ProviderId, string>> = {
  openai: 'gpt-5.2',
  anthropic: 'claude-sonnet-4-5',
  deepseek: 'deepseek-chat',
  glm: 'glm-4.6',
  'openai-compatible': 'custom-model',
};

function costTableFrom(
  provider: ProviderId,
  env: ProviderEnv,
  inOverride?: string,
  outOverride?: string
): CostTable | null {
  if (inOverride !== undefined && outOverride !== undefined) {
    const i = Number(inOverride);
    const o = Number(outOverride);
    if (Number.isFinite(i) && Number.isFinite(o)) return { inputPerMillion: i, outputPerMillion: o };
  }
  return DEFAULT_COST_TABLES[provider] ?? null;
}

async function adapterForRole(
  role: 'creative' | 'judge',
  env: ProviderEnv
): Promise<ModelAdapter> {
  const roleProvider = role === 'creative' ? env.CREATIVE_PROVIDER : env.JUDGE_PROVIDER;
  const provider = normalizeProvider(roleProvider ?? env.AI_PROVIDER);
  if (provider === 'fake') {
    const { createFakeModel } = await import('./models');
    return createFakeModel();
  }
  const modelId =
    (role === 'creative' ? env.CREATIVE_MODEL_ID : env.JUDGE_MODEL_ID) ??
    EXAMPLE_MODEL_IDS[provider]!;
  const apiKey = apiKeyFor(
    provider,
    env,
    role === 'creative' ? env.CREATIVE_API_KEY : env.JUDGE_API_KEY
  );
  if (!apiKey && provider !== 'openai-compatible') {
    throw new Error(`${role} provider "${provider}" selected but no API key is set (see .env.example for the expected variable)`);
  }
  const baseURL =
    (role === 'creative' ? env.CREATIVE_BASE_URL : env.JUDGE_BASE_URL) ?? env.MODEL_BASE_URL;
  const costTable = costTableFrom(
    provider,
    env,
    role === 'creative' ? env.CREATIVE_COST_INPUT ?? env.MODEL_COST_INPUT : env.JUDGE_COST_INPUT ?? env.MODEL_COST_INPUT,
    role === 'creative' ? env.CREATIVE_COST_OUTPUT ?? env.MODEL_COST_OUTPUT : env.JUDGE_COST_OUTPUT ?? env.MODEL_COST_OUTPUT
  );
  return createProviderModelAdapter({ provider, modelId, apiKey, baseURL, costTable });
}

/** Build both adapters (generator + judge) from environment. */
export async function adaptersFromEnv(
  env: ProviderEnv
): Promise<{ creative: ModelAdapter; judge: ModelAdapter; providerSummary: Record<string, string | null> }> {
  const creative = await adapterForRole('creative', env);
  const judge = await adapterForRole('judge', env);
  return {
    creative,
    judge,
    providerSummary: {
      creativeProvider: creative.providerId,
      creativeModel: creative.modelId,
      judgeProvider: judge.providerId,
      judgeModel: judge.modelId,
    },
  };
}
