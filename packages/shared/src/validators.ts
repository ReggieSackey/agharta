/**
 * Domain utilities: deterministic IDs, seeded RNG, lexical similarity.
 * No external deps. Works in browser, Node, and Convex runtimes.
 */

/** Deterministic ID generator (ULP-ordered enough for tests; Convex assigns real IDs at persistence). */
let idCounter = 0;
export function makeId(prefix: string, seed?: string): string {
  if (seed !== undefined) {
    // Stable, collision-resistant for our cardinalities: FNV-1a of seed + prefix.
    const h = fnv1a(`${prefix}:${seed}`);
    return `${prefix}_${h.toString(36)}`;
  }
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36).padStart(4, '0')}`;
}

export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // force to unsigned 32-bit
  return h >>> 0;
}

/** Mulberry32 seeded PRNG — tiny, deterministic, adequate for sampling. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lexical similarity fallback (Jaccard over word shingles) when embeddings
 * are unavailable. Returns 0..1 similarity. Explicitly NOT calibrated
 * semantic distance — used for dedup flags and heuristics only.
 */
export function lexicalSimilarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by',
  'at', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'as', 'that',
  'this', 'these', 'those', 'from', 'into', 'can', 'could', 'may', 'might',
  'will', 'would', 'should', 'must', 'not', 'but', 'than', 'then', 'so',
]);

function shingles(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  const out = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    out.add(words[i]!);
    if (i + 1 < words.length) out.add(`${words[i]!} ${words[i + 1]!}`);
  }
  return out;
}

/** Cosine similarity between two equal-length or sparse vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb =  0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Normalize a vector to unit length (embedding normalization). */
export function normalizeVector(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/** Hash-based token embedding for the deterministic local embedding fallback. */
export function hashEmbedding(text: string, dims = 128): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const s of shingles(text)) {
    const h = fnv1a(s) % dims;
    v[h] = v[h]! + 1;
  }
  return normalizeVector(v);
}

/** Escape user/model text for safe plain-text sinks (React text nodes auto-escape). */
export function escapeMarkdown(text: string): string {
  return text.replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'));
}

/** Clamp helper used across scoring code. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
