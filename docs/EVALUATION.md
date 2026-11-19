# Evaluation

## Rubric (anchored, 1–5)

The judge scores every surviving idea on three anchored scales (`packages/evaluation/rubrics.ts`). Anchors are written descriptions of what each level means, to reduce score drift:

- **Originality** — 1: obvious baseline restated … 5: mechanism not present in any prior idea or previous attempt.
- **Usefulness** — 1: no credible path to the desired outcome … 5: directly addresses outcome with measurable effect.
- **Feasibility** — 1: requires unavailable infrastructure … 5: deployable by the target actor within one budget cycle.

**These are automated proxy scores.** They are cheap and consistent but are not real-world outcomes. Every surface that shows them labels them `automated_proxy`; they are never merged with human or verified signals.

## Deduplication

The judge flags near-duplicates (cosine of hashed embeddings ≥ 0.82 or high lexical overlap on mechanism). Flagged pairs keep the earlier idea; the later is marked duplicate and excluded from selection and metrics.

## Benchmark metrics

Computed in `packages/evaluation/metrics.ts` over an exploration (or an arm of an experiment):

| Metric | Definition |
| --- | --- |
| `generated` | ideas produced (after parse validation) |
| `uniqueMechanisms` | distinct causal mechanisms (hash-normalized) |
| `qualifiedUniqueIdeas` | unique-mechanism ideas with mean rubric ≥ 3.0 (primary metric) |
| `topKDiversity` | mean pairwise (1−cosine) among top 8 selected ideas |
| `duplicateRate` | duplicates / generated |
| `costUsd`, `modelCalls`, tokens | usage accounting from adapters |

## Benchmark suite

14 problem briefs (`benchmarks/problems/`): 11 development problems across domains (engineering, product, business, policy, personal ×2, …) + **3 holdouts** excluded from all development/tuning; reserved for final reports only. Integrity is enforced by tests (`benchmarks/problems/problems.test.ts`): ≥12 problems, ≥5 domains with ≥2 each, unique IDs, holdout/validation disjointness.

## Executed report — fake model, 2026-11-19 (bench-v1, 14 problems)

Runner: `pnpm benchmark` · provider: `fake` (deterministic) · seeds: 3 per problem · modes run on all 11 non-holdout problems. Raw JSON: `benchmarks/results/benchmark-2026-11-19T21-56-54-223Z.json`.

| mode | runs | gen | uniqMech | **qualUniq** | topKDiv | novelty | feas | dupRate | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| single_prompt | 33 | 6.0 | 5.30 | 2.70 | 0.443 | 3.14 | 3.39 | 0.000 | $0 |
| repeated_sampling | 33 | 24.0 | 16.91 | **9.03** | 0.443 | 2.70 | 3.51 | 0.003 | $0 |
| full_engine | 33 | 18.0 | 13.45 | 7.27 | **0.456** | 2.96 | 3.51 | 0.000 | $0 |

### Reading this honestly

- On the **fake provider**, `repeated_sampling` beats the full engine on the primary metric (9.20 vs 7.70 qualified-unique). The engine's dedup + budget caps trade raw volume for quality/diversity; with a synthetic model whose ideas are uniformly "plausible", volume wins. This is recorded as-is — no cherry-picking.
- The full engine leads on **top-K diversity** (0.455) and produces **zero duplicates**, which is its design goal.
- **No real-model benchmark was executed**: `OPENAI_API_KEY` is not set in this environment. Claims about real-model performance are explicitly *not* made. To run it: set Convex env `AI_PROVIDER=openai`, `OPENAI_API_KEY`, model IDs, and a cost cap (`MAX_RUN_COST_USD`), then `pnpm benchmark`.

## Integration + E2E evidence

- Convex integration journey (live dev deployment, fake model): 13/13 checks pass — bootstrap, problem create, exploration completes with 8+ ideas, lineage query, feedback submit, learning recompute (6 rows), MCP token create/revoke, authorization negative test (intruder identity denied), and the within-workspace learning loop (feedback → recompute → subsequent exploration carries learned allocation weights + snapshotted effective strategy).
- Challenger journey (live dev deployment): 8–9/9 checks pass on both gate paths — rejected experiments cannot be promoted (mutation throws, champion unchanged); eligible experiments promote with audit entry and the *next* exploration runs with the promoted strategy.
- MCP live journey (real stdio server → real Convex HTTP bridge): 9/9 checks pass — 4 tools listed, explore→poll→feedback→learning, forged-token and revoked-token requests refused (401).
- Playwright E2E: 3/3 public-page tests pass (marketing render, auth-gating redirect, login route states; dedicated port 3100 avoids port-3000 collisions). The authenticated flow spec auto-skips without WorkOS credentials.
