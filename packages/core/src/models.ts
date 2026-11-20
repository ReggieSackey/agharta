/**
 * Model provider adapter layer.
 *
 * Two implementations:
 *  - `createFakeModel`: deterministic, seeded, zero-cost. Powers local tests,
 *    benchmarks, and any run without API credentials. NEVER calls a network.
 *  - `createOpenAiModel` (node adapter file `models.openai.ts`): real adapter
 *    via Vercel AI SDK 7 `generateText` + `Output.object({ schema })`.
 *
 * The adapter interface is the single model boundary of the engine; every
 * call is Zod-validated at the boundary.
 */
import type { OperatorId, Usage } from '@agharta/shared';
import { mulberry32, fnv1a, SEED_STRUCTURE_TAGS, SEED_MECHANISMS, getMechanism } from '@agharta/shared';

/** V2 engine step kinds (fake model synthesizes for each deterministically). */
export type V2OperatorKind =
  | 'interpret'
  | 'hypothesize'
  | 'investigate'
  | 'recombine'
  | 'novelty_judge'
  | 'refine';

/** A structured generation request the engine issues to a model. */
export interface GenerateRequest {
  /** stable identifier used for seeding/caching/tests */
  requestId: string;
  operator: OperatorId | 'judge' | 'optimizer' | V2OperatorKind;
  system: string;
  prompt: string;
  /** JSON schema of expected structured output (informational for fakes). */
  outputHint?: string;
}

export interface GenerateResult<T> {
  data: T;
  usage: Usage;
  modelId: string;
}

export interface CostTable {
  /** USD per 1M input tokens */
  inputPerMillion: number;
  /** USD per 1M output tokens */
  outputPerMillion: number;
}

/**
 * The model boundary. Implementations MUST:
 *  - validate output against the caller's Zod schema,
 *  - retry malformed output up to `maxRetries` with capped attempts,
 *  - account usage honestly (fakes account synthetic token counts).
 */
export interface ModelAdapter {
  readonly providerId: string;
  readonly modelId: string;
  readonly costTable: CostTable;
  generate<T>(req: GenerateRequest, schema: { parse: (u: unknown) => T }): Promise<GenerateResult<T>>;
}

// ---------------------------------------------------------------------------
// Deterministic fake model
// ---------------------------------------------------------------------------

/**
 * Fake model: produces plausible structured OperatorOutput / Evaluation JSON
 * deterministically from (requestId seed x prompt content). It is NOT an LLM;
 * its outputs vary by seed and operator so selection/dedup/learning logic is
 * exercised for real.
 */
export function createFakeModel(opts: { modelId?: string } = {}): ModelAdapter & { reset: () => void } {
  let calls = 0;
  const reset = () => { calls = 0; };
  return {
    providerId: 'fake',
    modelId: opts.modelId ?? 'fake-deterministic-v1',
    costTable: { inputPerMillion: 0, outputPerMillion: 0 },
    async generate<T>(req: GenerateRequest, schema: { parse: (u: unknown) => T }): Promise<GenerateResult<T>> {
      calls += 1;
      const rng = mulberry32(fnv1a(req.requestId + req.prompt.slice(0, 64)));
      const payload = synthesize(req, rng);
      const usage = synthesizeUsage(req, calls);
      return {
        data: schema.parse(payload),
        usage,
        modelId: this.modelId,
      };
    },
    reset,
  };
}


// ---------------------------------------------------------------------------
// V2 fake-model vocab + helpers
// ---------------------------------------------------------------------------
const ACTORS_V2 = ['the user', 'gatekeepers', 'peers', 'competitors', 'institutions', 'algorithms'];
const OBSTACLES_V2 = ['attention scarcity', 'coordination failure', 'information asymmetry', 'incentive misalignment', 'timing mismatch'];
const FEATURES_V2 = ['bottleneck structure', 'feedback delay', 'redundancy need', 'signaling problem', 'allocation problem', 'search problem', 'trust deficit'];
const INSTRUMENTS_V2 = ['protocol', 'market', 'ritual', 'artifact', 'contract', 'filter', 'schedule'];
const ACTIONS_V2 = ['redesign the loop so feedback arrives within days', 'create a second track with different selection rules', 'make the current bottleneck visible to all parties', 'introduce a sacrificial fast-fail layer'];
const TESTS_V2 = ['run two parallel small versions and compare outcomes', 'instrument the bottleneck and track it for a week', 'recruit five friendly users and measure the signaling effect'];
const FIELDS_V2 = ['biology', 'economics', 'engineering', 'urban planning', 'immunology', 'aerospace'];

function pickStr(arr: string[], rng: () => number): string {
  return arr[Math.floor(rng() * arr.length)]!;
}
function pickN<T>(arr: T[], n: number, rng: () => number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length > 0) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]!);
  return out;
}
function tagsFromPrompt(p: string): string[] {
  return [...p.matchAll(/tag[:"]+([a-z_]+)/g)].map((m) => m[1]!);
}
function firstLine(s: string): string {
  return s.split('\n')[0] ?? s;
}

function synthesizeUsage(req: GenerateRequest, calls: number): Usage {
  // Synthetic but honest accounting: proportional to prompt + ~300-700 output tokens.
  const inputTokens = Math.ceil(req.prompt.length / 4) + 120;
  const outputTokens = 240 + (fnv1a(req.requestId) % 460);
  return { inputTokens, outputTokens, costUsd: 0, modelCalls: 1, wallClockMs: 1 + (calls % 3) };
}

/**
 * Synthesize payloads in the OUTER shape each caller's schema expects:
 *  - creative operators → { ideas: [...] } (OperatorBatchSchema)
 *  - judge → JudgeOutputSchema shape
 *  - optimizer → OptimizerOutputSchema shape
 */
function synthesize(req: GenerateRequest, rng: () => number): unknown {
  const seedText = req.system + '|' + req.prompt;
  const variant = fnv1a(req.requestId);
  const num = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  if (req.operator === 'judge') {
    return {
      originality: num(2, 5),
      usefulness: num(2, 5),
      feasibility: num(2, 5),
      structuralValidity: num(2, 5),
      uncertainty: Math.round(rng() * 0.6 * 10) / 10,
      justification: `Fake-judge critique of "${seedText.slice(0, 40)}…": mechanism is coherent with moderate assumptions.`,
      duplicateOf: null,
    };
  }
  if (req.operator === 'optimizer') {
    return {
      rationale: 'Fake optimizer: tweak analogy prompt emphasis toward mapping constraints.',
      promptChange: {
        operator: 'analogy',
        newPrompt:
          'Abstract the source mechanism; map each causal link to the target; propose an intervention that respects hard constraints; flag mappings that fail.',
      },
      weightChange: null,
    };
  }
  // ---------------- V2 engine operators ----------------
  if (req.operator === 'interpret') {
    const tags = pickN([...SEED_STRUCTURE_TAGS], 2 + (variant % 3), rng);
    return {
      objective: `Help the user achieve: ${firstLine(req.prompt).slice(0, 300)}`,
      structureTags: tags,
      actors: [pickStr(ACTORS_V2, rng), pickStr(ACTORS_V2, rng)],
      incentives: [`Fast results with minimal effort (${seedText.length % 50} chars context)`],
      constraints: ['Limited time budget', 'Must not violate hard constraints from the brief'],
      resources: ['Existing network', 'Small discretionary budget'],
      obstacles: [pickStr(OBSTACLES_V2, rng)],
      conventionalSolutions: [
        'Do more of the standard approach with greater volume',
        'Ask experts for advice',
        'Copy what worked for peers',
      ],
      previouslyTried: ['Volume approach', 'expert advice', 'peer imitation'].slice(0, 1 + (variant % 3)),
      uncertainties: ['Whether the user can access the needed resources'],
      interpretationConfidence: 3 + (variant % 3),
    };
  }
  if (req.operator === 'hypothesize') {
    // parse mechanism ids from the prompt (engine lists candidate ids)
    const ids = [...req.prompt.matchAll(/Mechanism candidate: (sc_[a-z_]+)/g)].map((m) => m[1]!);
    const hypotheses = (ids.length > 0 ? ids : ['sc_immune']).map((mid) => {
      const mech = getMechanism(mid) ?? SEED_MECHANISMS[0]!;
      return {
        mechanismId: mid,
        transferRationale: `The ${mech.name.toLowerCase()} mechanism (${mech.mechanism}) may transfer because the problem exhibits ${pickStr(tagsFromPrompt(req.prompt), rng) || 'structural'} features it addresses.`,
        structuralMapping: [
          {
            problemFeature: pickStr(FEATURES_V2, rng),
            mechanismElement: mech.mechanism.slice(0, 200),
            mappingConfidence: Math.round(rng() * 0.8 * 10) / 10 + 0.1,
          },
        ],
        expectedProduce: `A concrete intervention applying ${mech.name.toLowerCase()} to the target problem.`,
        invalidatingAssumptions: [
          `The problem context satisfies "${mech.appliesWhen.slice(0, 180)}"`,
        ],
      };
    });
    return { hypotheses };
  }
  if (req.operator === 'investigate') {
    const mid = /Mechanism: (sc_[a-z_]+)/.exec(req.prompt)?.[1] ?? 'sc_immune';
    const mech = getMechanism(mid) ?? SEED_MECHANISMS[0]!;
    const nCand = 2 + (variant % 2);
    const candidates = [];
    for (let i = 0; i < nCand; i++) {
      candidates.push({
        title: `${mech.name}-inspired ${pickStr(INSTRUMENTS_V2, rng)} ${i === 0 ? 'first pass' : 'variant'}`,
        proposal: `Apply ${mech.mechanism.slice(0, 180)} to the problem: ${firstLine(req.prompt).slice(0, 200)}. Concretely, ${pickStr(ACTIONS_V2, rng)}.`,
        transferStory: `${mech.name} works by ${mech.mechanism.slice(0, 160)}. Mapping: the problem's ${pickStr(FEATURES_V2, rng)} corresponds to the mechanism's source condition; the intervention recreates the mechanism's causal role in the target context.`,
        differenceFromConventional: `Conventional approaches optimize within the current framing; this borrows the ${mech.field} mechanism of ${mech.name.toLowerCase()}, changing the causal structure rather than the effort level.`,
        explorationStep: `Run a 2-week bounded test: ${pickStr(TESTS_V2, rng)}, and measure whether the mechanism's signature (e.g., ${mech.appliesWhen.slice(0, 120)}) appears.`,
        assumptions: [`The ${mech.field} dynamics apply at problem scale`, 'The user can implement the minimal version'],
        limitations: ['Transfer is structural, not literal', 'Effect sizes unknown in this domain'],
      });
    }
    return {
      causalPrinciple: `Underlying principle of ${mech.name}: ${mech.mechanism}`,
      candidates,
      critique: {
        survived: (fnv1a(req.requestId) % 10) > 2, // 70% survive
        invalidAssumptions: [],
        coherenceNotes: 'Fake critique: mapping holds for the primary feature; secondary features unverified.',
      },
    };
  }
  if (req.operator === 'recombine') {
    const mids = [...req.prompt.matchAll(/Mechanism: (sc_[a-z_]+)/g)].map((m) => m[1]!);
    const pair = mids.length >= 2 ? [mids[0]!, mids[1]!] : ['sc_immune', 'sc_toc_elevation'];
    const a = getMechanism(pair[0]!) ?? SEED_MECHANISMS[0]!;
    const b = getMechanism(pair[1]!) ?? SEED_MECHANISMS[1]!;
    return {
      candidates: [
        {
          title: `${a.name} × ${b.name} hybrid`,
          proposal: `Combine: ${a.mechanism.slice(0, 140)}; layered with ${b.mechanism.slice(0, 140)}.`,
          transferStory: `The two mechanisms compose at different causal levels: ${a.name} handles ${pickStr(FEATURES_V2, rng)} while ${b.name} handles sequencing.`,
          differenceFromConventional: 'Conventional advice addresses one layer; the hybrid restructures two layers at once.',
          explorationStep: 'Prototype the minimal hybrid for two weeks; compare against single-mechanism variants.',
          assumptions: ['The mechanisms do not conflict at implementation level'],
          limitations: ['Hybrid complexity raises failure modes'],
          parentHypothesisIds: ['hyp_a', 'hyp_b'],
        },
      ],
    };
  }
  if (req.operator === 'novelty_judge') {
    return {
      vsConventional: num(2, 5),
      vsSiblings: num(2, 5),
      transferDistance: num(2, 5),
      substantiveDifference: num(2, 5),
      coherence: Math.round((0.5 + rng() * 0.5) * 10) / 10,
      relevance: Math.round((0.5 + rng() * 0.5) * 10) / 10,
      uncertainty: Math.round(rng() * 0.5 * 10) / 10,
      justification: `Fake novelty assessment: candidate ${firstLine(req.prompt).slice(0, 60)} differs from conventional by borrowing a ${pickStr(FIELDS_V2, rng)} mechanism.`,
      duplicateOf: null,
    };
  }
  if (req.operator === 'refine') {
    const mid = /Mechanism: (sc_[a-z_]+)/.exec(req.prompt)?.[1] ?? 'sc_immune';
    const mech = getMechanism(mid) ?? SEED_MECHANISMS[0]!;
    return {
      title: `Refined ${mech.name} application`,
      proposal: `Deepened proposal: ${mech.mechanism.slice(0, 200)} — implemented as a staged, testable program.`,
      transferStory: `Mechanism faithfully transferred: each causal link mapped to a problem element.`,
      differenceFromConventional: `Moves from advice-level to mechanism-level change via ${mech.field} dynamics.`,
      explorationStep: `First concrete step: ${pickStr(TESTS_V2, rng)}.`,
      assumptions: ['Mechanism preconditions hold'],
      limitations: ['Novel, unvalidated in this domain'],
    };
  }
  // creative operators: parse requested count from the prompt tail ("Produce exactly N ideas.")
  const m = /Produce exactly (\d+) ideas?/.exec(req.prompt);
  const count = m ? Math.min(6, parseInt(m[1]!, 10)) : 3;
  const ideas = [];
  for (let i = 0; i < count; i++) {
    ideas.push(synthesizeIdea(seedText, variant + i * 31, rng, req.operator));
  }
  return { ideas };
}

function synthesizeIdea(seedText: string, variant: number, rng: () => number, op: string): unknown {
  const v2 = fnv1a(`${seedText}:${variant}`);
  const pick = <T>(arr: T[]): T => arr[v2 % arr.length]!;
  const num = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const label = pick(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M']);
  const mech = pick(MECHANISMS);
  const actor = pick(ACTORS);
  const instrument = pick(INSTRUMENTS);
  const observable = pick(OBSERVABLES);
  const constraintShift = pick(CONSTRAINT_SHIFTS);
  return {
    title: `${op[0]!.toUpperCase()}${label}${v2 % 97}: ${mech.title}`,
    intervention: `${mech.action}. Deploy ${instrument} at the ${actor}'s decision point, begin at ${num(2, 25)}% of volume, expand only after the ${observable} signal stays flat for ${num(1, 3)} weeks.`,
    causalMechanism: `${mech.cause} Once installed, ${actor} experiences ${constraintShift}, which is exactly the slack the problem leaves unused today.`,
    assumptions: [
      `${actor} can observe ${observable} in near-real time`,
      `Instrumentation overhead stays under ${num(1, 9)}% of throughput`,
      `${pick(['No regulatory blocker exists', 'The accounting treatment is acceptable', 'Users accept the changed contract', 'The signal cannot be gamed cheaply'])}`,
    ],
    failureModes: [
      `${observable} is noisy below ${num(5, 30)}% adoption, so early reads mislead`,
      `${pick(['The mechanism depends on rare tail events', 'Second-order congestion appears at scale', 'The instrumentation cost dominates at small scale', 'Actors adapt strategically and defeat the signal'])}`,
    ],
    proposedTest: `${pick(['Shadow-mode', 'Staged rollout', 'Backtest on logs', 'Pilot with one segment'])} over ${num(1, 4)} weeks; decision metric: ${observable}; abandon if the ${pick(['p95', 'median', 'worst-decile'])} moves against us by more than ${num(2, 10)}%.`,
    sourceConceptIds: op === 'analogy' ? [pick(['sc_cache', 'sc_backpressure', 'sc_kanban', 'sc_auction', 'sc_traffic', 'sc_pigou', 'sc_toc', 'sc_immune', 'sc_control', 'sc_brt'])] : [],
    invertedConstraint: op === 'inversion' ? pick(['assume latency is free', 'assume budget is unlimited', 'assume users will switch tools', 'assume zero coordination cost', 'assume demand is perfectly forecastable']) : undefined,
    survivedRepair: op === 'inversion' ? rng() > 0.25 : undefined,
  };
}

/** Distinct mechanism seeds with unique vocabularies so fake ideas differ lexically. */
const MECHANISMS = [
  { title: 'reserve tiering by access temperature', action: 'Split the workload into hot and cold tiers with different quality/cost contracts', cause: 'Access frequency follows a skewed distribution, so serving the hot tail cheaply funds better treatment of the rest' },
  { title: 'explicit backpressure to the source', action: 'Propagate saturation upstream as refusal tokens that callers must respect', cause: 'Making overload visible at the origin lets decentralized senders self-throttle before damage compounds' },
  { title: 'sacrificial fast-fail boundary', action: 'Install a cheap guard that aborts doomed work before expensive resources commit', cause: 'Failing early converts wasted deep work into a small bounded loss' },
  { title: 'feed-forward scheduling from forecasts', action: 'Act on predicted arrival patterns minutes ahead instead of reacting after queues form', cause: 'Forecastable disturbances are cheaper to pre-empt than to correct' },
  { title: 'work-in-progress caps at the constraint', action: 'Limit concurrent items passing the bottleneck to a fixed slot count', cause: 'Artificial scarcity forces queueing at the right place and exposes hidden variability' },
  { title: 'stop-the-line defect escalation', action: 'Halt the flow on any defect and route it to root-cause repair immediately', cause: 'Converting defects into immediate signals prevents drift accumulation' },
  { title: 'elevation of the single bottleneck', action: 'Add capacity or remove waste only at the measured constraint, nowhere else', cause: 'System throughput is set by one binding constraint; improving elsewhere is invisible' },
  { title: 'voting across independent replicas', action: 'Run three independent executions and take the majority result', cause: 'Independent errors decorrelate, so majority vote suppresses random failure modes' },
  { title: 'staged shedding of spent structure', action: 'Retire components whose purpose has completed instead of carrying them forward', cause: 'Structure that helped earlier phases becomes pure drag later' },
  { title: 'asymmetric cross-feed before separation', action: 'Let the stronger branch resource the weaker one before they diverge', cause: 'Pre-separation transfer raises total capability beyond what either branch could reach alone' },
  { title: 'truthful-bid priority auction', action: 'Allocate scarce slots by sealed bids where winners pay the second price', cause: 'Second-price rules make honest valuation the dominant strategy, revealing private information' },
  { title: 'externality pricing at the margin', action: 'Charge a small per-unit fee on the hidden cost the behavior imposes', cause: 'Internalizing the externality shifts many small decentralized decisions without mandates' },
  { title: 'self-sorting service menu', action: 'Offer deliberately differentiated tiers and let users choose their own level', cause: 'A well-designed menu induces self-selection, revealing preferences no survey could capture' },
  { title: 'layered risk transfer', action: 'Slice exposure into severity bands and assign each band to the party best able to hold it', cause: 'Different bands have different economics, so matching holder to band minimizes total cost of risk' },
  { title: 'removing the shortcut that hurts everyone', action: 'Delete the locally-optimal link that causes global congestion', cause: 'Individually rational routing can aggregate into a worse equilibrium; removing options can improve it' },
  { title: 'pay-before-board separation', action: 'Move the slow verification step out of the critical path into a pre-stage', cause: 'Parallelizing validation with arrival removes the largest single delay source' },
  { title: 'single pooled queue discipline', action: 'Replace per-server queues with one shared line feeding all servers', cause: 'Pooling eliminates the variance penalty of assignment luck across servers' },
  { title: 'visible-maintenance signaling', action: 'Keep small public artifacts obviously well-kept at all times', cause: 'Perceived baseline care anchors expectations and measurably shifts behavior of strangers' },
  { title: 'bounded delegated budget', action: 'Hand a real but capped allocation to those with the most local information', cause: 'Local deciders hold information headquarters lacks, and the cap bounds worst-case error' },
  { title: 'contrast-table diagnosis', action: 'Tabulate conditions under which the outcome appears, disappears, and varies', cause: 'Systematic co-variation isolates which candidate cause actually carries the effect' },
  { title: 'assignment-mechanism benchmarking', action: 'Compare the observed result against the distribution of all possible assignments', cause: 'Using the randomization itself as yardstick separates signal from arrangement luck' },
  { title: 'tiny-batch integration cadence', action: 'Cut the batch size of merged work by an order of magnitude', cause: 'Smaller batches shorten feedback delay and reduce the cost of each error' },
  { title: 'amplify-then-prune option search', action: 'Generate many cheap variants and cull aggressively by measured binding', cause: 'Selection environments are noisy, so overproduction plus late selection beats early commitment' },
  { title: 'reinforce-successful-trail signaling', action: 'Deposit weak markers on routes that worked and let followers amplify them', cause: 'Graded reinforcement coordinates the collective without any central planner' },
  { title: 'deliberate slack absorption', action: 'Reserve idle capacity on purpose where variance enters the system', cause: 'Buffers convert arrival variance into waiting instead of failure cascades' },
  { title: 'controlled small-fire risk discharge', action: 'Trigger minor, scheduled failures to consume accumulated risk pressure', cause: 'Small deliberate stress events prevent the catastrophic unscheduled one' },
  { title: 'pioneer-stage sequencing', action: 'Deploy quick-and-dirty versions first to condition the ground for durable ones', cause: 'Early crude stages alter the environment in ways that make later stages viable' },
  { title: 'low-dose stress strengthening', action: 'Expose the system to small controlled doses of the harmful load', cause: 'Sub-harmful stress triggers adaptation that raises capacity above baseline' },
  { title: 'keystone intervention at the chokepoint', action: 'Change the single structural element everything else routes through', cause: 'Chokepoints multiply small differences into system-wide reorganization' },
  { title: 'incentive realignment via measurement', action: 'Change what is counted and rewarded rather than what is asked', cause: 'Agents optimize measured variables; measurement design is incentive design' },
];

const ACTORS = [
  'edge router', 'on-call engineer', 'requesting client', 'regional scheduler', 'pricing engine',
  'support triage lead', 'inventory planner', 'release manager', 'fraud analyst', 'product team',
];

const INSTRUMENTS = [
  'a token-bucket governor', 'a sidecar evaluator', 'a shadow ledger', 'a staging queue', 'a budget scoreboard',
  'a probability forecast', 'a circuit-breaker probe', 'a tiered contract', 'an audit beacon', 'a capacity reservation',
];

const OBSERVABLES = [
  'queue depth', 'staleness distribution', 'cost per completed unit', 'defect escape rate', 'handoff latency',
  'utilization spread', 'error budget burn', 'conversion funnel shape', 'rework share', 'time-to-first-value',
];

const CONSTRAINT_SHIFTS = [
  'a lower coordination burden', 'a shifted cost curve', 'a shorter feedback loop', 'a wider operating envelope',
  'a relaxed capacity ceiling', 'a bounded worst case', 'a reversible commitment',
];

// ---------------------------------------------------------------------------
// Retry helper used by all adapters (capped attempts, structured errors)
// ---------------------------------------------------------------------------

export class ModelBoundaryError extends Error {
  override readonly cause?: unknown;
  constructor(
    message: string,
    readonly attempts: number,
    cause?: unknown
  ) {
    super(message);
    this.name = 'ModelBoundaryError';
    this.cause = cause;
  }
}

export async function withRetries<T>(
  label: string,
  maxRetries: number,
  fn: () => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw new ModelBoundaryError(
    `${label} failed after ${maxRetries} attempts`,
    maxRetries,
    lastErr
  );
}
