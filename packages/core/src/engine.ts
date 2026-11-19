/**
 * The exploration engine: normalize problem → generation loop → evaluation →
 * dedup → diverse selection → refine → finalize, with budget enforcement,
 * cancellation checkpoints, and full lineage persistence.
 *
 * The engine is PURE: given the same model adapter behavior + seed it is
 * deterministic. Persistence is delegated to a Runtime port implemented by
 * Convex (durable) and by the in-memory runtime (tests/benchmarks).
 */
import type {
  Budget,
  Evaluation,
  Idea,
  OperatorId,
  OperatorOutput,
  SearchStrategy,
  Usage,
} from '@agharta/shared';
import { addUsage, EMPTY_USAGE, makeId, mulberry32, OPERATOR_IDS } from '@agharta/shared';
import type { ModelAdapter } from './models';
import { runOperator, OPERATORS, type ProblemContext } from './operators';
import { selectDiverse, dedupe, DEFAULT_SELECT_OPTIONS, type Candidate } from './population';
import { allocateOpportunities } from './strategies';

// ---------------------------------------------------------------------------
// Runtime port — implemented by Convex actions (durable) and tests (memory)
// ---------------------------------------------------------------------------

export interface EngineEvent {
  type: 'stage' | 'generation_complete' | 'idea_persisted' | 'log';
  message: string;
  data?: Record<string, unknown>;
}

export interface EngineRuntime {
  /** persist an idea; return its durable id */
  persistIdea(idea: Idea, evaluation: Evaluation | null): Promise<string>;
  /** persist a parent→child edge */
  persistEdge(parentId: string, childId: string, relation: 'mutation' | 'recombination' | 'refinement' | 'analogy_transfer'): Promise<void>;
  /** record which sources an analogy idea used */
  persistIdeaSource(ideaId: string, sourceConceptId: string, distance: number | undefined, notes: string | undefined): Promise<void>;
  /** record an operator invocation with usage */
  recordInvocation(operator: OperatorId, usage: Usage, meta: { outputsGenerated: number; contextHash: string; modelId: string; promptVersion: string }): Promise<void>;
  /** persist evaluation after judging */
  persistEvaluation(evaluation: Evaluation): Promise<void>;
  /** update progress (0..1) and stage label */
  reportProgress(progress: number, stage: string): Promise<void>;
  /** append a structured log/error line */
  log(event: EngineEvent): Promise<void>;
  /** Return false to request cancellation (checked between stages). */
  shouldCancel(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface ExplorationResult {
  status: 'completed' | 'cancelled' | 'failed' | 'budget_exceeded';
  recommendations: Array<{ ideaId: string; title: string; tradeoffs: string }>;
  selectedIdeas: Idea[];
  rejectedLog: Array<{ idea: Idea; reason: string }>;
  usage: Usage;
  generationsRun: number;
  mechanisms: Array<{ mechanismId: string; label: string; count: number }>;
  error?: string;
}

export interface EngineConfig {
  explorationId: string;
  problem: ProblemContext;
  strategy: SearchStrategy;
  budget: Budget;
  seed: number;
  /** judge from the evaluation package, injected to avoid a package cycle */
  judge: {
    evaluate(idea: Idea, allIdeas: Idea[]): Promise<{ evaluation: Evaluation; usage: Usage }>;
  };
  creativeModel: ModelAdapter;
}

export async function runExploration(cfg: EngineConfig, rt: EngineRuntime): Promise<ExplorationResult> {
  const startedAt = Date.now();
  let usage = EMPTY_USAGE;
  const allIdeas: Idea[] = [];
  const allEvaluations = new Map<string, Evaluation>();
  const rejectedLog: Array<{ idea: Idea; reason: string }> = [];
  const seenTitles = new Set<string>();
  let cancelled = false;

  await rt.reportProgress(0.02, 'normalizing-problem');
  await rt.log({ type: 'stage', message: `Exploration ${cfg.explorationId} started (budget ${cfg.budget.preset}, seed ${cfg.seed})` });

  const maxGens = Math.min(cfg.budget.maxGenerations, cfg.strategy.maxGenerations);
  const rng = mulberry32(cfg.seed);

  for (let gen = 0; gen < maxGens && !cancelled; gen++) {
    await rt.reportProgress(0.05 + (gen / maxGens) * 0.75, `generation-${gen + 1}`);
    // operator allocation for this generation
    const slots = Math.max(4, Math.min(cfg.strategy.populationSize, Math.ceil(cfg.budget.maxCandidates / maxGens)));
    let alloc = allocateOpportunities(cfg.strategy.operatorWeights, slots, cfg.strategy.explorationFloor);
    // generation 0 has no parents: recombination cannot run honestly —
    // redistribute its slots to parentless operators so budget is not wasted
    if (gen === 0 && alloc.recombination > 0) {
      const extra = alloc.recombination;
      alloc = { ...alloc, recombination: 0 };
      const rest = (OPERATOR_IDS.filter((o) => o !== 'recombination') as OperatorId[]);
      let i = 0;
      while (extra > 0) {
        const target = rest[i % rest.length]!;
        alloc[target] += 1;
        i += 1;
        if (i % rest.length === 0) break; // distribute at most one extra per operator this pass
      }
      // if still remaining (extra > rest.length), dump into divergent
      if (extra > rest.length) alloc.divergent += extra - rest.length;
    }

    // pick parents from prior generation for recombination/inversion
    const parentsPool = allIdeas.filter((i) => i.generation === gen - 1);
    let newThisGen = 0;

    for (const op of OPERATOR_IDS) {
      const n = alloc[op];
      if (n <= 0) continue;
      if (await rt.shouldCancel()) { cancelled = true; break; }

      // recombination needs two distinct-mechanism parents
      const parents = pickParents(parentsPool, rng);
      if (op === 'recombination' && parents.length < 2) continue;

      const result = await runOperator(OPERATORS[op]!, {
        problem: cfg.problem,
        parents,
        seed: cfg.seed + gen * 1000 + hashOp(op),
        promptOverrides: strategyOverrides(cfg.strategy),
      }, cfg.creativeModel, n, `${cfg.explorationId}:g${gen}`);

      usage = addUsage(usage, result.usage);
      await rt.recordInvocation(op, result.usage, {
        outputsGenerated: result.outputs.length,
        contextHash: `${fnv1aStr(cfg.problem.title + op + gen)}`,
        modelId: cfg.creativeModel.modelId,
        promptVersion: cfg.strategy.version,
      });

      for (const out of result.outputs) {
        const titleKey = out.title.trim().toLowerCase();
        if (seenTitles.has(titleKey)) {
          rejectedLog.push({ idea: stubIdea(cfg.explorationId, out, op, gen), reason: 'exact duplicate title within exploration' });
          continue;
        }
        seenTitles.add(titleKey);
        const idea: Idea = {
          id: makeId('idea', `${cfg.explorationId}:${gen}:${op}:${titleKey}`),
          explorationId: cfg.explorationId,
          title: out.title,
          intervention: out.intervention,
          causalMechanism: out.causalMechanism,
          assumptions: out.assumptions,
          failureModes: out.failureModes,
          proposedTest: out.proposedTest,
          operatorId: op,
          parentIds: op === 'recombination' ? parents.map((p) => p.id) : op === 'inversion' && parents[0] ? [parents[0].id] : [],
          sourceConceptIds: out.sourceConceptIds,
          generation: gen,
          invertedConstraint: out.invertedConstraint,
          survivedRepair: out.survivedRepair,
        };
        allIdeas.push(idea);
        newThisGen += 1;
        const durableId = await rt.persistIdea(idea, null);
        idea.id = durableId;
        for (const pid of idea.parentIds) {
          await rt.persistEdge(pid, durableId, op === 'recombination' ? 'recombination' : 'mutation');
        }
        for (const sid of idea.sourceConceptIds) {
          await rt.persistIdeaSource(durableId, sid, undefined, 'curated library concept');
        }
      }
    }

    // evaluate the generation's new ideas
    const genIdeas = allIdeas.filter((i) => i.generation === gen);
    await rt.reportProgress(0.15 + ((gen + 1) / maxGens) * 0.6, `evaluating-generation-${gen + 1}`);
    for (const idea of genIdeas) {
      if (newThisGen === 0 && genIdeas.length === 0) break;
      const { evaluation, usage: ju } = await cfg.judge.evaluate(idea, allIdeas);
      usage = addUsage(usage, ju);
      allEvaluations.set(idea.id, evaluation);
      await rt.persistEvaluation(evaluation);
    }
    await rt.log({ type: 'generation_complete', message: `Generation ${gen + 1}: ${genIdeas.length} ideas, cumulative usage $${usage.costUsd.toFixed(4)}` });

    // budget guard between generations
    if (usage.costUsd >= cfg.budget.maxCostUsd) {
      await rt.log({ type: 'log', message: `Cost cap $${cfg.budget.maxCostUsd} reached; stopping early` });
      break;
    }
    if (Date.now() - startedAt > cfg.budget.maxWallClockMs) {
      await rt.log({ type: 'log', message: 'Wall-clock budget reached; stopping early' });
      break;
    }
  }

  // final selection
  await rt.reportProgress(0.85, 'selecting');
  const candidates: Candidate[] = allIdeas
    .map((idea) => ({ idea, evaluation: allEvaluations.get(idea.id)! }))
    .filter((c) => c.evaluation);
  const { unique, duplicates } = dedupe(candidates, DEFAULT_SELECT_OPTIONS.duplicateThreshold);
  rejectedLog.push(...duplicates);
  const outcome = selectDiverse(unique, { ...DEFAULT_SELECT_OPTIONS, target: finalTarget(cfg.budget) });
  rejectedLog.push(...outcome.rejected);

  await rt.reportProgress(1, 'completed');
  return {
    status: cancelled ? 'cancelled' : 'completed',
    recommendations: outcome.selected.map((c) => ({
      ideaId: c.idea.id,
      title: c.idea.title,
      tradeoffs: `proxy ${proxyOf(c)} — heuristic; feasibility ${c.evaluation.feasibility}/5, originality ${c.evaluation.originality}/5 (judge uncertainty ${(c.evaluation.uncertainty * 100).toFixed(0)}%)`,
    })),
    selectedIdeas: outcome.selected.map((c) => c.idea),
    rejectedLog,
    usage,
    generationsRun: maxGens,
    mechanisms: mechanismSummary(unique),
    error: undefined,
  };
}

// helpers ---------------------------------------------------------------

function strategyOverrides(s: SearchStrategy): Partial<Record<OperatorId, string>> | undefined {
  const any = OPERATOR_IDS.some((op) => s.prompts[op]?.trim().length > 0);
  if (!any) return undefined;
  const out: Partial<Record<OperatorId, string>> = {};
  for (const op of OPERATOR_IDS) {
    const p = s.prompts[op];
    if (p && p.trim().length > 0) out[op] = p;
  }
  return out;
}

function pickParents(pool: Idea[], rng: () => number): Idea[] {
  if (pool.length < 2) return pool.slice(0, 2);
  // pick two with distinct causal mechanisms for genuine recombination
  const shuffled = [...pool].sort(() => rng() - 0.5);
  const a = shuffled[0]!;
  const b = shuffled.slice(1).find((x) => x.causalMechanism !== a.causalMechanism) ?? shuffled[1]!;
  return [a, b];
}

function finalTarget(budget: Budget): number {
  // 4–8 diverse recommendations per the brief
  return budget.preset === 'quick' ? 4 : budget.preset === 'standard' ? 6 : 8;
}

function proxyOf(c: Candidate): number {
  return c.evaluation.originality * 0.4 + c.evaluation.usefulness * 0.4 + c.evaluation.feasibility * 0.2;
}

function mechanismSummary(candidates: Candidate[]): Array<{ mechanismId: string; label: string; count: number }> {
  const byMech = new Map<string, { label: string; count: number }>();
  for (const c of candidates) {
    const key = c.idea.mechanismId ?? hashOf(c.idea.causalMechanism).toString(36);
    const entry = byMech.get(key) ?? { label: c.idea.causalMechanism.slice(0, 120), count: 0 };
    entry.count += 1;
    byMech.set(key, entry);
  }
  return [...byMech.entries()].map(([mechanismId, v]) => ({ mechanismId, ...v }));
}

function hashOf(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function hashOp(op: OperatorId): number {
  return op.length * 7 + op.charCodeAt(0);
}

function fnv1aStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function stubIdea(explorationId: string, out: OperatorOutput, op: OperatorId, gen: number): Idea {
  return {
    id: makeId('idea_rejected', `${explorationId}:${gen}:${op}:${out.title.trim().toLowerCase()}`),
    explorationId,
    title: out.title,
    intervention: out.intervention,
    causalMechanism: out.causalMechanism,
    assumptions: out.assumptions,
    failureModes: out.failureModes,
    proposedTest: out.proposedTest,
    operatorId: op,
    parentIds: [],
    sourceConceptIds: [],
    generation: gen,
  };
}
