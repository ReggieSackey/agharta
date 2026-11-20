/**
 * V2 Engine 2 learning: observations -> new candidate ConceptualMap +
 * SearchPolicy. Pure function; Convex action orchestrates persistence.
 *
 * Learning updates THREE things:
 *   1. map edges: Beta posteriors per (structureTag, mechanism) on
 *      "produced a novel+coherent candidate" — hierarchical: shrunk toward the
 *      field posterior, which is itself shrunk toward the global posterior.
 *   2. policy compatWeights: logistic fit over hypothesis outcomes with
 *      importance weighting (inverse selection probability) for bias correction.
 *   3. policy fieldPosteriors + distancePreference: from observed transfer
 *      distances of successful vs unsuccessful hypotheses.
 */
import type {
  ConceptualMap, SearchPolicy, ExperimentObservation, Mechanism,
  ProblemStructure, MapEdge,
} from '@agharta/shared';
import { fitCompatWeights, jointFeatures, tagFieldFeature } from './compat';
import { SEED_MECHANISMS } from '@agharta/shared';

// mechanism library access lives in core; learning imports the seed list via a
// thin re-export to avoid a circular dependency.

export interface LearnResult {
  map: ConceptualMap;
  policy: SearchPolicy;
  /** how many observations actually updated parameters */
  observationsApplied: number;
  /** human/outcome-tier evidence included (never mixed into novelty targets) */
  humanEvidenceApplied: number;
  notes: string[];
}

const PRIOR_ALPHA = 1;
const PRIOR_BETA = 1;
/** shrinkage of tag×mechanism edges toward field posterior */
const EDGE_SHRINK = 0.3;

export function learn(
  baseMap: ConceptualMap,
  basePolicy: SearchPolicy,
  observations: ExperimentObservation[],
  knownMechanisms: Mechanism[] = SEED_MECHANISMS,
  seed = 42
): LearnResult {
  const notes: string[] = [];
  const mechById = new Map(knownMechanisms.map((m) => [m.id, m]));

  // ---------------- 1. map edges: hierarchical Beta updates ----------------
  const edgeKey = (tag: string, mechId: string) => `${tag}→${mechId}`;
  const edges = new Map<string, MapEdge>(
    baseMap.edges.map((e) => [edgeKey(e.from, e.to), { ...e }])
  );

  // field-level accumulators (level 2 of the hierarchy)
  const fieldSuccess = new Map<string, { a: number; b: number }>();
  let observationsApplied = 0;
  let humanEvidenceApplied = 0;

  for (const obs of observations) {
    for (const h of obs.hypothesisOutcomes) {
      const mech = mechById.get(h.mechanismId);
      if (!mech) continue;
      observationsApplied++;

      // automated tier drives novelty learning
      const success = h.producedNovelCoherent ? 1 : 0;
      const failure = h.producedNovelCoherent ? 0 : 1;

      // importance weight: inverse selection probability, clipped (bias correction)
      const weight = Math.min(4, 1 / Math.max(0.05, h.selectionProbability));

      for (const tag of h.structureTags) {
        const k = edgeKey(tag, h.mechanismId);
        const cur = edges.get(k) ?? {
          from: `tag:${tag}`, // node id in the map
          to: h.mechanismId,
          compatibility: 0.5,
          alpha: PRIOR_ALPHA,
          beta: PRIOR_BETA,
          humanEvidenceCount: 0,
          automatedEvidenceCount: 0,
        };
        cur.alpha += success * weight;
        cur.beta += failure * weight;
        cur.automatedEvidenceCount += 1;
        cur.compatibility = shrink(
          cur.alpha / (cur.alpha + cur.beta),
          fieldPosteriorMean(h.mechanismField, fieldSuccess)
        );
        edges.set(k, cur);
      }

      // field accumulator
      const fs = fieldSuccess.get(h.mechanismField) ?? { a: 0, b: 0 };
      fs.a += success;
      fs.b += failure;
      fieldSuccess.set(h.mechanismField, fs);

      // human tier: modulates coherence/relevance weighting only
      if (h.humanShortlisted > 0 || h.humanRejected > 0) {
        humanEvidenceApplied++;
        const net = h.humanShortlisted - h.humanRejected;
        for (const tag of h.structureTags) {
          const k = edgeKey(tag, h.mechanismId);
          const cur = edges.get(k)!;
          // human evidence nudges compatibility at reduced weight, and only
          // recorded in counts (never conflated with novelty targets)
          cur.humanEvidenceCount += h.humanShortlisted + h.humanRejected;
          cur.alpha += net > 0 ? 0.25 * net : 0;
          cur.beta += net < 0 ? 0.25 * (-net) : 0;
          edges.set(k, cur);
        }
      }
    }
  }

  // recompute all compatibilities with final field posteriors
  for (const e of edges.values()) {
    const mech = mechById.get(e.to);
    if (mech) e.compatibility = shrink(e.alpha / (e.alpha + e.beta), fieldPosteriorMean(mech.field, fieldSuccess));
  }

  // ---------------- 2. policy: compat logistic fit ----------------
  const fitExamples = observations.flatMap((obs) =>
    obs.hypothesisOutcomes
      .filter((h) => mechById.has(h.mechanismId))
      .map((h) => {
        const mech = mechById.get(h.mechanismId)!;
        return {
          structure: obs.problemStructure,
          mechanism: mech,
          outcome: h.producedNovelCoherent,
          weight: Math.min(4, 1 / Math.max(0.05, h.selectionProbability)),
        };
      })
  );
  const fit = fitCompatWeights(fitExamples, basePolicy, { seed });

  // ---------------- 3. field posteriors + distance preference ----------
  const fieldPosteriors: Record<string, { alpha: number; beta: number }> = { ...basePolicy.fieldPosteriors };
  for (const [field, { a, b }] of fieldSuccess) {
    const cur = fieldPosteriors[field] ?? { alpha: PRIOR_ALPHA, beta: PRIOR_BETA };
    fieldPosteriors[field] = { alpha: cur.alpha + a, beta: cur.beta + b };
  }

  // distance preference: if far transfers outperformed near ones on novelty,
  // shift preference toward distance; bounded 0.1..0.9, changes slowly
  let distancePreference = basePolicy.distancePreference;
  const farOutcomes = observations.flatMap((o) => o.hypothesisOutcomes).filter((h) => (h.policyScore ?? 0) < 0.4);
  if (farOutcomes.length >= 4) {
    const farRate = farOutcomes.filter((h) => h.producedNovelCoherent).length / farOutcomes.length;
    const nearOutcomes = observations.flatMap((o) => o.hypothesisOutcomes).filter((h) => (h.policyScore ?? 0) >= 0.4);
    const nearRate = nearOutcomes.length > 0
      ? nearOutcomes.filter((h) => h.producedNovelCoherent).length / nearOutcomes.length
      : 0.5;
    const delta = (farRate - nearRate) * 0.2; // slow, bounded
    distancePreference = clamp01(distancePreference + delta);
  }

  // ---------------- assemble versioned artifacts ----------------
  const mapMajorMinor = /^map-v(\d+)\.(\d+)$/.exec(baseMap.version);
  const nextMapVersion = mapMajorMinor
    ? `map-v${mapMajorMinor[1]}.${parseInt(mapMajorMinor[2]!, 10) + 1}`
    : 'map-v0.1';
  const policyMajorMinor = /^policy-v(\d+)\.(\d+)$/.exec(basePolicy.version);
  const nextPolicyVersion = policyMajorMinor
    ? `policy-v${policyMajorMinor[1]}.${parseInt(policyMajorMinor[2]!, 10) + 1}`
    : 'policy-v0.1';

  const newMap: ConceptualMap = {
    versionId: `${nextMapVersion}:${seed}`,
    version: nextMapVersion,
    createdAt: Date.now(),
    nodes: baseMap.nodes,
    edges: [...edges.values()],
    parentVersionId: baseMap.versionId,
  };

  // slots stay as policy learned them unless evidence says exploration
  // underperforms — but NEVER below the hard floor
  const explorationFloor = basePolicy.explorationFloor; // immutable floor
  const slots = { ...basePolicy.slots };
  // (slot tuning left to the gate evaluation; floor is never reducible)

  const newPolicy: SearchPolicy = {
    versionId: `${nextPolicyVersion}:${seed}`,
    version: nextPolicyVersion,
    createdAt: Date.now(),
    compatWeights: fit.weights,
    compatBias: fit.bias,
    distancePreference,
    slots,
    explorationFloor,
    fieldPosteriors,
    parentVersionId: basePolicy.versionId,
  };

  if (observationsApplied === 0) notes.push('no applicable observations; artifacts unchanged except version');
  if (humanEvidenceApplied > 0) notes.push(`human-tier evidence applied to ${humanEvidenceApplied} hypotheses (coherence weighting only)`);

  return { map: newMap, policy: newPolicy, observationsApplied, humanEvidenceApplied, notes };
}

function fieldPosteriorMean(field: string, acc: Map<string, { a: number; b: number }>): number {
  const f = acc.get(field);
  if (!f) return 0.5;
  return (PRIOR_ALPHA + f.a) / (PRIOR_ALPHA + f.a + PRIOR_BETA + f.b);
}

function shrink(mean: number, toward: number, amount = EDGE_SHRINK): number {
  return mean * (1 - amount) + toward * amount;
}

function clamp01(n: number): number {
  return Math.max(0.1, Math.min(0.9, Math.round(n * 1e4) / 1e4));
}
