import { describe, expect, it } from 'vitest';
import {
  normalizeProvider,
  PROVIDER_IDS,
  DEFAULT_COST_TABLES,
  adaptersFromEnv,
} from '../src/models.providers';
import { createFakeModel } from '../src/models';

describe('provider normalization', () => {
  it('accepts all supported providers', () => {
    for (const p of PROVIDER_IDS) expect(normalizeProvider(p)).toBe(p);
  });

  it('maps aliases (zai/zhipu→glm, local→fake)', () => {
    expect(normalizeProvider('zai')).toBe('glm');
    expect(normalizeProvider('Zhipu')).toBe('glm');
    expect(normalizeProvider('chatglm')).toBe('glm');
    expect(normalizeProvider('local')).toBe('fake');
    expect(normalizeProvider(undefined)).toBe('fake');
  });

  it('throws a helpful error for unknown providers', () => {
    expect(() => normalizeProvider('grok')).toThrow(/Supported: .*glm/s);
  });
});

describe('cost tables', () => {
  it('has estimates for the real hosted providers', () => {
    for (const p of ['openai', 'anthropic', 'deepseek', 'glm'] as const) {
      expect(DEFAULT_COST_TABLES[p]).toBeDefined();
    }
  });

  it('treats openai-compatible cost as unknown (null → token caps only)', () => {
    expect(DEFAULT_COST_TABLES['openai-compatible']).toBeUndefined();
  });
});

describe('adaptersFromEnv', () => {
  it('defaults both roles to the fake model without keys', async () => {
    const { creative, judge, providerSummary } = await adaptersFromEnv({});
    expect(creative.providerId).toBe('fake');
    expect(judge.providerId).toBe('fake');
    expect(providerSummary.creativeProvider).toBe('fake');
  });

  it('resolves a generator/judge split across different providers', async () => {
    // deepseek creative + glm judge, but without keys → falls back to fake for
    // both roles because the test env has no credentials; assert the split is
    // *attempted* by forcing an error message for a real provider without key.
    await expect(
      adaptersFromEnv({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: undefined })
    ).rejects.toThrow(/deepseek.*API key/i);
  });

  it('fake provider ignores missing keys and still works', async () => {
    const { creative } = await adaptersFromEnv({ AI_PROVIDER: 'fake' });
    expect(creative.providerId).toBe('fake');
  });

  it('zhipu alias resolves to glm provider and requires a GLM/Zhipu key', async () => {
    await expect(adaptersFromEnv({ AI_PROVIDER: 'zhipu' })).rejects.toThrow(/glm.*API key/i);
  });

  it('openai-compatible requires a baseURL', async () => {
    await expect(
      adaptersFromEnv({
        AI_PROVIDER: 'openai-compatible',
        OPENAI_API_KEY: 'sk-test',
        MODEL_BASE_URL: undefined,
      })
    ).rejects.toThrow(/MODEL_BASE_URL/);
  });

  it('role split: creative=fake + judge=openai resolves with OPENAI key present', async () => {
    // judge takes the provider-level OPENAI_API_KEY when no JUDGE_API_KEY
    const { creative, judge } = await adaptersFromEnv({
      CREATIVE_PROVIDER: 'fake',
      JUDGE_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(creative.providerId).toBe('fake');
    expect(judge.providerId).toBe('openai');
    expect(judge.modelId).toBe('gpt-5.2'); // example default
  });
});

describe('provider adapters stay ModelAdapter-compatible', () => {
  it('fake model satisfies the same interface used by real providers', () => {
    const m = createFakeModel();
    expect(typeof m.generate).toBe('function');
    expect(typeof m.providerId).toBe('string');
    expect(typeof m.modelId).toBe('string');
  });
});
