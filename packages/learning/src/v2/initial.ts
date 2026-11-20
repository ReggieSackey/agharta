/**
 * Initial (v0.1) learning artifacts: the seed conceptual map and search policy.
 * Every workspace starts from these; Engine 2 versions forward from here.
 */
import type { ConceptualMap, SearchPolicy, MapNode } from '@agharta/shared';
import { SEED_MECHANISMS, SEED_STRUCTURE_TAGS } from '@agharta/shared';
import { hashStr } from './compat';

export function initialConceptualMap(now = Date.now()): ConceptualMap {
  const nodes: MapNode[] = [];
  for (const tag of SEED_STRUCTURE_TAGS) {
    nodes.push({ id: `tag:${tag}`, kind: 'structure_tag', label: tag, embBucket: bucket(tag) });
  }
  for (const m of SEED_MECHANISMS) {
    nodes.push({
      id: m.id,
      kind: 'mechanism',
      label: `${m.name} (${m.field})`,
      embBucket: bucket(m.field + m.mechanism),
      mechanism: m,
    });
  }
  // no edges initially — uniform 0.5 priors are implicit until evidence arrives;
  // the map ships with the curated library as nodes only.
  return {
    versionId: 'map-v0.1:seed',
    version: 'map-v0.1',
    createdAt: now,
    nodes,
    edges: [],
  };
}

export function initialSearchPolicy(now = Date.now()): SearchPolicy {
  return {
    versionId: 'policy-v0.1:seed',
    version: 'policy-v0.1',
    createdAt: now,
    compatWeights: {},        // zero-shot: bias-only prior
    compatBias: 0,            // sigmoid(0) = 0.5 — uniform compatibility
    distancePreference: 0.5,
    slots: { exploitation: 3, exploration: 2, wildcard: 1 },
    explorationFloor: 0.25,   // hard floor — learning cannot reduce below this
    fieldPosteriors: {},      // Beta(1,1) priors per field once observed
    parentVersionId: undefined,
  };
}

function bucket(text: string): string {
  return `b${hashStr(text) % 64}`;
}
