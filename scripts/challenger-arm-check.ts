/**
 * Local sanity check: does the analogy-heavy challenger beat the champion on
 * qualifiedUniqueIdeas over the validation problems (fake model)? Informs
 * whether the zero-cost gate fallback yields a promotable result.
 */
import { runExploration, createFakeModel } from '@agharta/core';
import { ModelJudge, engineJudgeAdapter, computeMetrics, DEFAULT_THRESHOLDS } from '@agharta/evaluation';
import { buildChallenger } from '@agharta/learning';
import { defaultChampion } from '@agharta/core';
import { budgetFor } from '@agharta/shared';
import { VALIDATION_PROBLEMS } from '@agharta/benchmarks';

const seeds = [11, 22, 33];
const budget = budgetFor('quick');

async function arm(strategy: ReturnType<typeof defaultChampion>) {
  const judge = new ModelJudge(createFakeModel());
  let qualified = 0;
  let diversity = 0;
  let runs = 0;
  for (const bp of VALIDATION_PROBLEMS) {
    for (const seed of seeds) {
      const ideas: any[] = [];
      const evals = new Map();
      const runtime = {
        async persistIdea(i: any) { ideas.push(i); return i.id; },
        async persistEdge() {}, async persistIdeaSource() {}, async recordInvocation() {},
        async persistEvaluation(e: any) { evals.set(e.ideaId, e); },
        async reportProgress() {}, async log() {}, async shouldCancel() { return false; },
      };
      await runExploration({
        explorationId: `local:${strategy.version}:${bp.id}:${seed}`,
        problem: bp.toProblemContext(),
        strategy,
        budget,
        seed,
        judge: engineJudgeAdapter(judge),
        creativeModel: createFakeModel(),
      }, runtime as any);
      const m = computeMetrics(
        { ideas, evaluations: evals as any, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, modelCalls: 0, wallClockMs: 0 } as any },
        DEFAULT_THRESHOLDS,
      );
      qualified += m.qualifiedUniqueIdeas;
      diversity += m.topKDiversity;
      runs += 1;
    }
  }
  return { qualified, diversity: diversity / runs };
}

const champion = defaultChampion('champ');
const challenger = buildChallenger(champion, {
  rationale: 'test', promptChange: null, weightChange: { operator: 'analogy', newWeight: 0.45 },
}, 'chall');

async function main() {
  console.log('champion  ', champion.operatorWeights, await arm(champion));
  console.log('challenger', challenger.operatorWeights, await arm(challenger));
}
main();
