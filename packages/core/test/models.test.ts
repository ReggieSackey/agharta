import { describe, expect, it } from 'vitest';
import { createFakeModel, withRetries, ModelBoundaryError } from '../src/models';
import { z } from 'zod';

const SimpleSchema = z.object({ ok: z.boolean() });

describe('fake model', () => {
  it('rejects mismatched schema deterministically (ZodError, not crash)', async () => {
    const m = createFakeModel();
    await expect(
      m.generate({ requestId: 'r1', operator: 'divergent', system: 's', prompt: 'p' }, SimpleSchema)
    ).rejects.toThrow();
  });
  it('parses when schema matches synthesized payload', async () => {
    const m = createFakeModel();
    const res = await m.generate(
      { requestId: 'r1', operator: 'divergent', system: 's', prompt: 'p\n\nProduce exactly 3 ideas.' },
      z.object({ ideas: z.array(z.object({ title: z.string() })).min(1) }).passthrough()
    );
    expect(res.data.ideas.length).toBeGreaterThan(0);
    expect(res.usage.inputTokens).toBeGreaterThan(0);
    expect(res.usage.costUsd).toBe(0);
  });
});

describe('withRetries', () => {
  it('retries then succeeds', async () => {
    let n = 0;
    const v = await withRetries('x', 3, async () => {
      n += 1;
      if (n < 2) throw new Error('nope');
      return 'ok';
    });
    expect(v).toBe('ok');
    expect(n).toBe(2);
  });
  it('caps attempts and throws ModelBoundaryError', async () => {
    let n = 0;
    await expect(
      withRetries('x', 2, async () => {
        n += 1;
        throw new Error('always fails');
      })
    ).rejects.toBeInstanceOf(ModelBoundaryError);
    expect(n).toBe(2);
  });
});
