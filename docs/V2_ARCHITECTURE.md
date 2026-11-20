# Agharta V2 — Architecture & Migration Plan

Status: implementing. This document records the design decisions and the migration from the operator-centric V1 architecture to the two-engine experimental architecture.

## What changes conceptually

| | V1 | V2 |
| --- | --- | --- |
| Central search unit | 4 creative operators (divergent/analogy/inversion/recombination) | **Hypotheses** connecting problem structures to transferable mechanisms |
| What is learned | Per-operator success rates → operator weights | **Compatibility parameters** between problem structures and mechanisms + a **search policy** (effort allocation, distance preference, exploration) |
| Learning trigger | Feedback recompute + manual challenger runs | **Asynchronous** after every experiment, with automatic gated promotion |
| Primary objective | Balanced proxy score | **Novelty** (coherence/relevance are gates, not objectives) |
| Interface | Dashboard + local MCP stdio | + **Remote MCP (Streamable HTTP)** for ChatGPT and other assistants |
| Keys | Server-configured | **BYOK**: per-workspace encrypted provider credentials |

The V1 operators survive as *investigation techniques* inside Engine 1 (e.g. inversion is applied while stress-testing a hypothesis's assumptions) but no longer define the search space. V1 data is preserved untouched; V2 writes to new tables.

## Engine 1 — Experimental Creative Search (`packages/core/src/search/`)

Seven steps, each a pure, testable module talking to `ModelAdapter`:

```
interpret → consult map/policy → hypothesize → investigate → evaluate novelty → refine → record
```

1. **interpret** — LLM produces a validated `ProblemStructure` (objective, structure tags, actors/incentives/constraints, conventional solutions to move beyond, uncertainties). Fake model synthesizes deterministic structures.
2. **consult** — snapshot the *active* `ConceptualMap` + `SearchPolicy` versions (Engine 2 artifacts). The snapshot is recorded on the experiment; mid-experiment promotions never affect a running experiment.
3. **hypothesize** — select mechanisms and form ~6 hypotheses: exploitation slots (top compatibility under the learned policy), exploration slots (distant/uncertain), 1 wildcard (challenges the problem framing). Selection is a function of learned parameters — this is the lever Engine 2 moves.
4. **investigate** — per hypothesis: understand mechanism → extract causal structure → map onto the problem → generate candidates → critique (assumption attacks, inversion of the problem's constraints) → refine/discard. Recombination of survivors from different hypotheses is allowed.
5. **evaluate novelty** — multi-reference: distance from conventional solutions, distance from siblings, cross-domain transfer distance, coherence gate, duplicate detection. Novelty is a *composite with evidence*, never a single LLM number.
6. **refine** — spend remaining budget deepening the most novel coherent candidates → 2–3 final proposals with the mechanism story, why it differs, how to test it, assumptions.
7. **record** — full experimental record including rejected hypotheses, intermediate candidates, evaluations, usage, versions, errors.

## Engine 2 — Asynchronous Learning (`packages/learning/src/v2/`)

Runs in Convex internal actions after experiments complete (scheduled, idempotent, checkpointed). Produces versioned artifacts:

### ConceptualMap (versioned, immutable docs)

- **Nodes**: problem-structure tags, mechanisms (seeded from the curated library + discovered), transfer types.
- **Edges**: weighted relations `structureTag ↔ mechanism` with *learned* compatibility weights; `mechanism ↔ mechanism` similarity; provenance and evidence counts on every edge.
- Initial version = seed library with uniform priors. Learning updates edge weights from experiment evidence (hierarchical Beta-Bernoulli with shrinkage — see below).

### SearchPolicy (versioned, immutable docs)

Concrete algorithm — **hierarchical Bayesian compatibility model with Thompson sampling** (chosen over alternatives in `docs/V2_LEARNING.md`):

- Per-mechanism and per-field Beta-Bernoulli posteriors over "produced a novel + coherent candidate", shrunk toward the global posterior by exposure (empirical-Bayes weighting). Works from zero data (priors) and stays honest with tiny data.
- A **compatibility function** `compat(structure, mechanism)` = logistic regression over hashed joint features (structure tags × mechanism embedding buckets × distance), ridge-regularized, trained on all hypothesis outcomes. With no data this is the prior; with data it generalizes across problems — the map changes *which* mechanisms get picked for *new* problem shapes.
- **Selection**: Thompson draws (seeded, logged) over candidate mechanisms scored by compat + learned distance preference; exploitation slots take the top draws, exploration slots are forced from uncertain/distant regions (hard floor, not reducible by learning), 1 wildcard.
- Selection probabilities are logged per hypothesis for selection-bias correction (Engine 2 sees outcomes mostly for hypotheses Engine 1 chose).

### Evidence tiers

Automated novelty estimates, human feedback, and real outcomes are separate counters. Missing feedback is `unknown`, never failure. Novelty (automated + human) dominates; real-world outcomes modulate coherence/relevance only.

### Automatic promotion (gates, audit, rollback)

- Engine 2 fits a **challenger** (map + policy). A fixed **validation set** (4 non-holdout benchmark problems, never trained on; 3 holdout problems touched only for periodic audits) runs both champion and challenger with matched budgets and seeds.
- Gate (predeclared, confidence-aware): challenger must improve mean novelty by ≥ 8% with ≥ 95% posterior confidence (paired per-problem comparison), no coherence regression beyond 2%, and ≥ 4 validation problems. Fail any → retain champion.
- Pass → **automatic promotion**: atomically flip the `activeArtifacts` pointer, write an audit entry, keep every prior version. Rollback = pointer flip + audit (tested).
- Learning jobs are idempotent (experiment-processing checkpoints; double-runs write identical stats).

## Model orchestration (3 compute classes)

- **Creative**: the workspace's configured generative model.
- **Decision** (`packages/core/src/decisions/`): three interchangeable providers behind `DecisionProvider` (classifyStructure / rankHypotheses / screenCandidates):
  - **policy decider** (default): computed directly from the learned policy snapshot — `compat()` weights ARE the ranking; zero cost, zero latency, auditable. Screen is conservative lexical relevance capped at 30% of candidates.
  - **Jev decider** (optional, `JEV_API_KEY`): calls `POST https://api.typesafe.ai/v1/systemone` — classify = one Noul battery, rank = one request with a Score question per mechanism (parallel), screen = Noul per candidate. Cost metered at the documented $0.042/Mtok input. Rank output only *modulates* the learned prior within a [0.5, 1.5] multiplier shrunk by answer confidence — Jev reorders exploitation, never replaces the policy and never touches the exploration floor. Missing/malformed answers fall back to learned rank (no fabrication).
  - **LLM decider** (benchmark arm): the creative model itself answers decision calls — measures what dedicating generative capacity to decisions costs.
  - `withFallback` wraps any provider: per-call fallback to the policy decider with failure recording — the engine works without Jev even mid-run.
  - Engine 1 records `decisionProvider`, `decisionCostUsd`, `decisionModelCalls` in every experiment's `modelInfo` — cost/quality attribution is inspectable per run.
- **Learning**: Engine 2 fits on recorded observations (no model calls needed for the statistical core; optional LLM assist for concept extraction is behind a flag).

## BYOK credentials

- `providerCredentials` table stores only AES-256-GCM ciphertext. Key = HKDF(master from Convex env `AGHARTA_CREDENTIAL_KEY`, workspaceId) — per-workspace derivation isolates workspaces from each other.
- Plaintext exists once at submission, decrypted only inside internal actions at run time; never returned to clients after save, never logged, never in MCP responses.
- Per-run and per-workspace spend caps; connection validation with a cheap test call; hard fail-closed with clear errors when credentials are missing (verified live in V1; same paths reused).

## Privacy

Private learning: per-workspace artifacts. Shared baseline: seed library + versioned public baseline artifacts. No cross-workspace flow of problems/ideas/embeddings — enforced in authorization. Deletion removes workspace data including derived private artifacts (documented behavior).

## Remote MCP + ChatGPT

- Local stdio server unchanged.
- New **Streamable HTTP** MCP endpoint on Convex (`/mcp`, JSON-RPC over POST, stateless mode per spec) authenticated with the existing personal tokens; workspace-scoped identical to stdio tools.
- ChatGPT connection: OpenAI's developer-app flow registers a remote MCP endpoint + OAuth; we serve the required discovery manifest, document the exact registration/publish steps, and implement the token-authenticated endpoint. Publishing requires an OpenAI developer account — external step, documented, not fabricated.

## Migration sequence

1. Stage 1: V2 contracts + mechanism library (additive).
2. Stage 2: Engine 1 modules + tests (fake model).
3. Stage 3: Engine 2 learning + versioning + tests.
4. Stage 4: promotion gates + rollback + Convex wiring + live learning-loop proof.
5. Stage 5: Jev adapter + decision benchmark.
6. Stage 6: BYOK, remote MCP, dashboard views.
7. Stage 7: full verification + benchmarks + honest reporting.

V1 tables/operators remain functional during migration; V2 experiments use new tables (`experiments`, `hypotheses`, `experimentCandidates`, `conceptualMapVersions`, `policyVersions`, `learningRuns`, `artifactEvaluations`, `activeArtifacts`, `providerCredentials`).
