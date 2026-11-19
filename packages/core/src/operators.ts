/**
 * Four creative operators. Each has a DIFFERENT causal strategy, prompt, and
 * provenance contract — not four wrappers around one prompt.
 *
 *  - divergent:   distinct causal mechanisms & assumptions, baseline generator
 *  - analogy:     curated cross-domain source concepts; abstract → map → propose
 *  - inversion:   invert/relax a constraint, then repair against hard constraints
 *  - recombination: fuse two genuinely distinct parents, record incompatibilities
 */
import type { Idea, OperatorId, OperatorOutput, SourceConcept, Usage } from '@agharta/shared';
import { OperatorOutputSchema, EMPTY_USAGE, addUsage, lexicalSimilarity, mulberry32 } from '@agharta/shared';
import { z } from 'zod';
import type { ModelAdapter } from './models';
import { SOURCE_CONCEPTS } from './concepts';

// ---------------------------------------------------------------------------
// Operator context
// ---------------------------------------------------------------------------

export interface ProblemContext {
  title: string;
  description: string;
  desiredOutcome: string;
  constraints: string[];
  domain: string;
  previouslyTried: string[];
}

export interface ParentIdeaRef {
  id: string;
  title: string;
  causalMechanism: string;
  intervention: string;
  operatorId: OperatorId;
}

export interface OperatorRunContext {
  problem: ProblemContext;
  /** parents for recombination (gen > 0) */
  parents: ParentIdeaRef[];
  /** seeded RNG for reproducible source selection */
  seed: number;
  /** strategy prompt overrides */
  promptOverrides?: Partial<Record<OperatorId, string>>;
}

export interface OperatorResult {
  outputs: OperatorOutput[];
  /** source concepts offered to the model (analogy provenance) */
  offeredSourceIds: string[];
  inversionNotes: string[];
  usage: Usage;
}

// ---------------------------------------------------------------------------
// Model boundary schema (batch of raw ideas; engine assigns IDs & lineage)
// ---------------------------------------------------------------------------

const OperatorBatchSchema = z.object({
  ideas: z.array(OperatorOutputSchema).min(1).max(6),
});

// ---------------------------------------------------------------------------
// The four operators
// ---------------------------------------------------------------------------

const SYSTEM_PREAMBLE =
  'You are part of Agharta, a creative search engine. You output ONLY valid JSON matching the requested schema. No markdown fences, no commentary. Ideas must be concrete, mechanistic, and falsifiable. Every idea must be grounded in a causal story, not vibes.';

export interface Operator {
  readonly id: OperatorId;
  readonly defaultPrompt: string;
  buildPrompt(ctx: OperatorRunContext): { system: string; user: string; meta: OperatorMeta };
}

export interface OperatorMeta {
  offeredSourceIds: string[];
  inversionNotes: string[];
}

export const DIVERGENT: Operator = {
  id: 'divergent',
  defaultPrompt:
    'Generate candidate interventions grounded in DISTINCT causal mechanisms. Each idea must name a different mechanism by which the desired outcome is produced. Vary the assumptions each idea depends on; do not produce variations of one lever. For every idea give: a specific intervention, the causal mechanism (why it works), 2-4 assumptions, 2-4 failure modes, and a cheap test that could falsify it within a week.',
  buildPrompt(ctx) {
    const tried = ctx.problem.previouslyTried.length
      ? `Approaches already tried (produce mechanisms DIFFERENT from these): ${ctx.problem.previouslyTried.join('; ')}`
      : 'No prior approaches described.';
    return {
      system: SYSTEM_PREAMBLE,
      user: `Problem: ${ctx.problem.title}\nDomain: ${ctx.problem.domain}\nDescription: ${ctx.problem.description}\nDesired outcome: ${ctx.problem.desiredOutcome}\nConstraints (respect these): ${ctx.problem.constraints.join('; ') || 'none stated'}\n${tried}\n\n${this.defaultPrompt}`,
      meta: { offeredSourceIds: [], inversionNotes: [] },
    };
  },
};

export const ANALOGY: Operator = {
  id: 'analogy',
  defaultPrompt:
    'You will receive 3 source concepts from other domains. For each: (1) abstract its causal structure to a mechanism schema, (2) map each element of the schema to the target problem, (3) state which mappings hold and which break, (4) propose a target-domain intervention that preserves the transferable structure while respecting hard constraints. Ideas whose mapping breaks on a hard constraint must say so. Return ONLY ideas grounded in the given sources; cite each idea with the source concept id in brackets.',
  buildPrompt(ctx) {
    const picked = selectSources(ctx.problem, ctx.seed);
    const src = picked
      .map((c) => `[${c.id}] (${c.domain}) ${c.name}: ${c.description} — transferable: ${c.transferableMechanism}`)
      .join('\n');
    return {
      system: SYSTEM_PREAMBLE,
      user: `Problem: ${ctx.problem.title}\nDomain: ${ctx.problem.domain}\nDescription: ${ctx.problem.description}\nDesired outcome: ${ctx.problem.desiredOutcome}\nHard constraints: ${ctx.problem.constraints.join('; ') || 'none stated'}\n\nSOURCE CONCEPTS:\n${src}\n\n${this.defaultPrompt}`,
      meta: { offeredSourceIds: picked.map((c) => c.id), inversionNotes: [] },
    };
  },
};

export const INVERSION: Operator = {
  id: 'inversion',
  defaultPrompt:
    'Identify the 2-3 most load-bearing implicit assumptions or constraints of this problem. For each, INVERT or relax it (e.g., assume the opposite holds, or the constraint is 10x looser). From the inverted world, derive an intervention, then REPAIR it so it respects the real hard constraints again. For each idea, record: which assumption was inverted (in invertedConstraint), whether the core inverted move survived the repair (survivedRepair true/false). Discard ideas where repair erased the inversion entirely.',
  buildPrompt(ctx) {
    const parentsNote =
      ctx.parents.length > 0
        ? `Parent ideas (you may invert their core assumptions specifically): ${ctx.parents.map((p) => p.title).join('; ')}`
        : 'No parent ideas.';
    return {
      system: SYSTEM_PREAMBLE,
      user: `Problem: ${ctx.problem.title}\nDomain: ${ctx.problem.domain}\nDescription: ${ctx.problem.description}\nDesired outcome: ${ctx.problem.desiredOutcome}\nHard constraints (MUST hold after repair): ${ctx.problem.constraints.join('; ') || 'none stated'}\n${parentsNote}\n\n${this.defaultPrompt}`,
      meta: { offeredSourceIds: [], inversionNotes: [] },
    };
  },
};

export const RECOMBINATION: Operator = {
  id: 'recombination',
  defaultPrompt:
    'You will receive two parent ideas with different causal mechanisms. Find the complementary structure: what one parent does well where the other fails. Combine them into a single intervention that keeps the leverage points of both mechanisms. State explicitly where the parents conflict and how the child resolves it. The child must not be a mere concatenation; it must have a unified causal mechanism.',
  buildPrompt(ctx) {
    const a = ctx.parents[0];
    const b = ctx.parents[1];
    if (!a || !b) {
      return {
        system: SYSTEM_PREAMBLE,
        user: `Problem: ${ctx.problem.title}\n\nNo two distinct parents available yet; produce divergent alternatives to seed later recombination.`,
        meta: { offeredSourceIds: [], inversionNotes: [] },
      };
    }
    return {
      system: SYSTEM_PREAMBLE,
     user: `Problem: ${ctx.problem.title}\nDomain: ${ctx.problem.domain}\nHard constraints: ${ctx.problem.constraints.join('; ') || 'none stated'}\n\nPARENT A [${a.id}] (${a.operatorId}): ${a.title} — ${a.intervention} — mechanism: ${a.causalMechanism}\nPARENT B [${b.id}] (${b.operatorId}): ${b.title} — ${b.intervention} — mechanism: ${b.causalMechanism}\n\n${this.defaultPrompt}`,
      meta: { offeredSourceIds: [], inversionNotes: [] },
    };
  },
};

export const OPERATORS: Record<OperatorId, Operator> = {
  divergent: DIVERGENT,
  analogy: ANALOGY,
  inversion: INVERSION,
  recombination: RECOMBINATION,
};

// ---------------------------------------------------------------------------
// Source selection for analogy (near/moderate/far strata by lexical similarity)
// ---------------------------------------------------------------------------

export function selectSources(problem: ProblemContext, seed: number, k = 3): SourceConcept[] {
  const target = `${problem.title} ${problem.description} ${problem.domain}`;
  const scored = SOURCE_CONCEPTS.map((c) => ({
    c,
    sim: lexicalSimilarity(target, `${c.domain} ${c.name} ${c.description} ${c.transferableMechanism}`),
  }));
  scored.sort((a, b) => b.sim - a.sim);
  const near = scored.slice(0, 8);
  const mid = scored.slice(8, 20);
  const far = scored.slice(20);
  const rng = mulberry32(seed);
  const pickFrom = (pool: typeof scored): SourceConcept | undefined => {
    if (pool.length === 0) return undefined;
    return pool[Math.floor(rng() * pool.length)]!.c;
  };
  const out: SourceConcept[] = [];
  for (const p of [pickFrom(near), pickFrom(mid), pickFrom(far)]) {
    if (p && !out.some((o) => o.id === p.id)) out.push(p);
  }
  return out.slice(0, k);
}

// ---------------------------------------------------------------------------
// Runner: operator + model + Zod validation, capped retries
// ---------------------------------------------------------------------------

export async function runOperator(
  operator: Operator,
  ctx: OperatorRunContext,
  model: ModelAdapter,
  n: number,
  requestIdPrefix: string
): Promise<OperatorResult> {
  const { system, user, meta } = operator.buildPrompt(ctx);
  const override = ctx.promptOverrides?.[operator.id];
  const prompt = override ? `${user}\n\nADDITIONAL STRATEGY GUIDANCE:\n${override}` : user;
  const outputs: OperatorOutput[] = [];
  let usage = EMPTY_USAGE;
  const perCall = 3;
  const batches = Math.max(1, Math.ceil(n / perCall));
  for (let b = 0; b < batches; b++) {
    const requestId = `${requestIdPrefix}:${operator.id}:s${ctx.seed}:b${b}`;
    const res = await model.generate(
      {
        requestId,
        operator: operator.id,
        system,
        prompt: `${prompt}\n\nProduce exactly ${Math.min(perCall, n - b * perCall)} ideas.`,
      },
      OperatorBatchSchema
    );
    outputs.push(...res.data.ideas);
    usage = addUsage(usage, res.usage);
  }
  // Analogy provenance validation: model-cited sources must exist in the library.
  if (operator.id === 'analogy') {
    for (const out of outputs) {
      for (const sid of out.sourceConceptIds) {
        if (!SOURCE_CONCEPTS.some((c) => c.id === sid)) {
          throw new Error(`Analogy idea "${out.title}" referenced unknown source concept ${sid}`);
        }
      }
    }
  }
  return { outputs, offeredSourceIds: meta.offeredSourceIds, inversionNotes: meta.inversionNotes, usage };
}
