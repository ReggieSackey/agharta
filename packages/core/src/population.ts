/**
 * Population management: dedup, viability gating, greedy diverse selection
 * with a reserved slot for unusual/underexplored lineages.
 *
 * Selection is a HEURISTIC (labeled as such everywhere it is surfaced):
 *   maximize qualityProxy + diversityWeight * minDistanceToSelected
 * while reserving >=1 slot for the most original viable-but-lower-scored idea.
 */
import type { Evaluation, Idea, OperatorId } from '@agharta/shared';
import { hashEmbedding, cosineSimilarity, lexicalSimilarity, makeId } from '@agharta/shared';

export interface Candidate {
  idea: Idea;
  evaluation: Evaluation;
}

export interface SelectOutcome {
  selected: Candidate[];
  rejected: Array<{ idea: Idea; reason: string }>;
  /** heuristic label — surfaced to UI */
  heuristic: 'greedy-quality-diversity-with-reserved-unusual-slot';
}

export interface SelectOptions {
  /** how many to select */
  target: number;
  /** weight of diversity term relative to quality proxy (proxy is 1..5) */
  diversityWeight: number;
  /** similarity above which two ideas are treated as duplicates */
  duplicateThreshold: number;
  /** min viability: feasibility gate from the rubric */
  minFeasibility: number;
  /** min distance for the reserved unusual slot (0..1) */
  unusualMinDistance: number;
}

export const DEFAULT_SELECT_OPTIONS: SelectOptions = {
  target: 6,
  diversityWeight: 0.35,
  duplicateThreshold: 0.82,
  minFeasibility: 2,
  unusualMinDistance: 0.55,
};

/** Exact + near duplicate detection across a candidate set. */
export function dedupe(candidates: Candidate[], threshold: number): { unique: Candidate[]; duplicates: Array<{ idea: Idea; reason: string }> } {
  const unique: Candidate[] = [];
  const duplicates: Array<{ idea: Idea; reason: string }> = [];
  for (const cand of candidates) {
    const dupOf = unique.find(
      (u) =>
        u.idea.title.trim().toLowerCase() === cand.idea.title.trim().toLowerCase() ||
        similarity(u.idea, cand.idea) >= threshold
    );
    if (dupOf) {
      duplicates.push({ idea: cand.idea, reason: `near-duplicate of "${dupOf.idea.title}" (similarity >= ${threshold})` });
    } else {
      unique.push(cand);
    }
  }
  return { unique, duplicates };
}

function similarity(a: Idea, b: Idea): number {
  const emb = cosineSimilarity(hashEmbedding(ideaText(a)), hashEmbedding(ideaText(b)));
  const lex = lexicalSimilarity(ideaText(a), ideaText(b));
  return Math.max(emb, lex);
}
function ideaText(i: Idea): string {
  return `${i.title}\n${i.intervention}\n${i.causalMechanism}`;
}

/**
 * Greedy diverse selection.
 * Steps:
 *  1. reject exact duplicates and below-viability candidates
 *  2. score = qualityProxy(evaluation)
 *  3. greedily pick argmax(score + diversityWeight * minDistanceToSelected)
 *  4. reserve one slot for the most original viable idea NOT already selected
 */
export function selectDiverse(candidates: Candidate[], opts: SelectOptions = DEFAULT_SELECT_OPTIONS): SelectOutcome {
  const rejected: Array<{ idea: Idea; reason: string }> = [];
  // 1. viability + exact dup pass
  const viable: Candidate[] = [];
  const seenTitles = new Set<string>();
  for (const cand of candidates) {
    if (cand.evaluation.feasibility < opts.minFeasibility) {
      rejected.push({ idea: cand.idea, reason: `feasibility ${cand.evaluation.feasibility} below minimum ${opts.minFeasibility}` });
      continue;
    }
    const titleKey = cand.idea.title.trim().toLowerCase();
    if (seenTitles.has(titleKey)) {
      rejected.push({ idea: cand.idea, reason: 'exact duplicate title' });
      continue;
    }
    seenTitles.add(titleKey);
    viable.push(cand);
  }
  if (viable.length === 0) return { selected: [], rejected, heuristic: 'greedy-quality-diversity-with-reserved-unusual-slot' };

  // 2. compute quality proxy
  const quality = (c: Candidate) =>
    c.evaluation.originality * 0.4 + c.evaluation.usefulness * 0.4 + c.evaluation.feasibility * 0.2;

  // 3. greedy pick with diversity term + near-dup rejection against selected
  const selected: Candidate[] = [];
  const dist = (c: Candidate) =>
    selected.length === 0 ? 1 : Math.min(...selected.map((s) => similarity(s.idea, c.idea)));
  const regularSlots = Math.max(1, opts.target - 1); // hold one slot for unusual
  while (selected.length < regularSlots && viable.length > 0) {
    // reject near-duplicates of already-selected first
    for (let i = viable.length - 1; i >= 0; i--) {
      const c = viable[i]!;
      if (selected.some((s) => similarity(s.idea, c.idea) >= opts.duplicateThreshold)) {
        rejected.push({ idea: c.idea, reason: 'near-duplicate of an already-selected idea' });
        viable.splice(i, 1);
      }
    }
    if (viable.length === 0) break;
    let best: Candidate | undefined;
    let bestVal = -Infinity;
    for (const c of viable) {
      const val = quality(c) + opts.diversityWeight * dist(c) * 5; // scale dist to score range
      if (val > bestVal) {
        bestVal = val;
        best = c;
      }
    }
    if (!best) break;
    selected.push(best);
    viable.splice(viable.indexOf(best), 1);
  }

  // 4. reserved unusual slot: most original viable idea not yet selected;
  //    fallback keeps the most original remaining even if similar —
  //    originality is uncertain and unusual lineages are not pruned for weirdness
  const unusual =
    [...viable]
      .filter((c) => dist(c) >= opts.unusualMinDistance)
      .sort((a, b) => b.evaluation.originality - a.evaluation.originality)[0] ??
    [...viable].sort((a, b) => b.evaluation.originality - a.evaluation.originality)[0];
  if (unusual) {
    selected.push(unusual);
    viable.splice(viable.indexOf(unusual), 1);
  }
  for (const c of viable) {
    rejected.push({ idea: c.idea, reason: 'not selected (heuristic quality+diversity)' });
  }
  return { selected, rejected, heuristic: 'greedy-quality-diversity-with-reserved-unusual-slot' };
}

/** Group ideas into distinct causal-mechanism clusters (annotated, heuristic). */
export function annotateMechanisms(ideas: Idea[]): Array<{ mechanismId: string; ideas: Idea[]; label: string }> {
  const clusters: Array<{ mechanismId: string; ideas: Idea[]; label: string }> = [];
  for (const idea of ideas) {
    const match = clusters.find((cl) => lexicalSimilarity(cl.label, idea.causalMechanism) > 0.45);
    if (match) {
      match.ideas.push(idea);
    } else {
      clusters.push({
        mechanismId: `mech_${clusters.length + 1}`,
        label: idea.causalMechanism.slice(0, 160),
        ideas: [idea],
      });
    }
    idea.mechanismId = clusters.find((cl) => cl.ideas.includes(idea))!.mechanismId;
  }
  return clusters;
}
