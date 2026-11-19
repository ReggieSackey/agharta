/**
 * Real model adapter: Vercel AI SDK 7 + OpenAI provider.
 * Runs in Node (Convex "use node" actions, benchmarks, MCP).
 * NOT imported by pure engine tests — they use the fake model.
 *
 * AI SDK 7 structured output: generateText({ output: Output.object({ schema }) }).
 */
import { generateText, Output } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { ZodType } from 'zod';
import type { GenerateRequest, ModelAdapter } from './models';
import { withRetries, createFakeModel } from './models';
import type { Usage } from '@agharta/shared';

export interface OpenAiAdapterOptions {
  apiKey: string;
  modelId: string;
  /** allow overriding for judge/creative split */
  costTable?: { inputPerMillion: number; outputPerMillion: number };
  maxRetries?: number;
}

export function createOpenAiModelAdapter(opts: OpenAiAdapterOptions): ModelAdapter {
  const openai = createOpenAI({ apiKey: opts.apiKey });
  const model = openai(opts.modelId);
  const retries = opts.maxRetries ?? 2;
  return {
    providerId: 'openai',
    modelId: opts.modelId,
    costTable:
      opts.costTable ?? { inputPerMillion: 1.25, outputPerMillion: 10 },
    async generate<T>(req: GenerateRequest, schema: ZodType<T>): Promise<{ data: T; usage: Usage; modelId: string }> {
      const result = await withRetries(`openai:${req.operator}`, retries, async () => {
        const r = await generateText({
          model,
          system: req.system,
          prompt: req.prompt,
          output: Output.object({ schema: schema as ZodType<T> }),
        });
        return r;
      });
      const out = result.output;
      const u = result.usage;
      const inputTokens = u.inputTokens ?? 0;
      const outputTokens = u.outputTokens ?? 0;
      return {
        data: out,
        usage: {
          inputTokens,
          outputTokens,
          costUsd:
            (inputTokens / 1e6) * this.costTable.inputPerMillion +
            (outputTokens / 1e6) * this.costTable.outputPerMillion,
          modelCalls: 1,
          wallClockMs: 0,
        },
        modelId: opts.modelId,
      };
    },
  };
}

/** Adapter factory from environment (Convex action env / benchmark env). */
export function adapterFromEnv(env: Record<string, string | undefined>): ModelAdapter {
  const provider = env['AI_PROVIDER'] ?? 'fake';
  if (provider === 'openai') {
    const key = env['OPENAI_API_KEY'];
    if (!key) throw new Error('AI_PROVIDER=openai but OPENAI_API_KEY is not set');
    return createOpenAiModelAdapter({
      apiKey: key,
      modelId: env['CREATIVE_MODEL_ID'] ?? 'gpt-5.2',
    });
  }
  return createFakeModel();
}
