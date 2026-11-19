import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  fnv1a,
  hashEmbedding,
  lexicalSimilarity,
  makeId,
  mulberry32,
  normalizeVector,
} from '../src/index';

describe('ids', () => {
  it('generates unique sequential ids', () => {
    const a = makeId('idea');
    const b = makeId('idea');
    expect(a).not.toBe(b);
    expect(a.startsWith('idea_')).toBe(true);
  });
  it('seeded ids are deterministic', () => {
    expect(makeId('idea', 'seed-x')).toBe(makeId('idea', 'seed-x'));
    expect(makeId('idea', 'seed-x')).not.toBe(makeId('idea', 'seed-y'));
  });
});

describe('rng', () => {
  it('mulberry32 is deterministic for a seed', () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
  it('produces values in [0,1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('lexical similarity', () => {
  it('identical text scores 1', () => {
    expect(lexicalSimilarity('ship a raft on the river', 'ship a raft on the river')).toBe(1);
  });
  it('unrelated text scores near 0', () => {
    expect(lexicalSimilarity('kubernetes cluster autoscaling', 'gardening tips for spring')).toBeLessThan(0.15);
  });
  it('word-overlapping paraphrase scores moderately', () => {
    const s = lexicalSimilarity(
      'shed stale requests to preserve fresh utility',
      'shed stale requests early to preserve utility under load'
    );
    expect(s).toBeGreaterThan(0.3);
  });
  it('synonym-level paraphrase scores low — documented lexical limitation', () => {
    const s = lexicalSimilarity(
      'shed stale requests to preserve fresh utility',
      'drop outdated requests to keep recent ones useful'
    );
    expect(s).toBeLessThan(0.15);
  });
});

describe('vectors', () => {
  it('normalizes to unit length', () => {
    const v = normalizeVector([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
  });
  it('cosine of identical vectors is 1', () => {
    const v = hashEmbedding('cache invalidation strategy');
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });
  it('hash embeddings differ for different text', () => {
    const a = hashEmbedding('cache invalidation strategy');
    const b = hashEmbedding('urban traffic flow management');
    expect(cosineSimilarity(a, b)).toBeLessThan(0.6);
  });
});

describe('fnv1a', () => {
  it('is deterministic', () => {
    expect(fnv1a('agharta')).toBe(fnv1a('agharta'));
    expect(fnv1a('agharta')).not.toBe(fnv1a('bitches'));
  });
});
