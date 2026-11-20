# BUILD STATUS

Log of real progress. Nothing is marked done unless it ran.

## 2026-11-19 (session 1)

- Inspected environment: empty git repo at repo root; Node v24.12.0; pnpm installed (12.21.0).
- Confirmed current library versions on npm: next 16.4.6, convex 1.51.0, ai 7.0.x, @modelcontextprotocol/server 2.4.0 (v2 split confirmed), @workos-inc/authkit-nextjs 4.6.3, @ai-sdk/openai 4.0.x, zod 4.6.7, @xyflow/react 13.x, vitest 5.
- No OpenAI/WorkOS credentials available in this environment. Building with the deterministic fake model as the default provider; `.env.example` documents every required var. Real-credential paths (OpenAI adapter, WorkOS hosted login) are implemented but untested against live services — listed under Needs.
- Scaffold: pnpm workspace + root package.json + tsconfig.base + .gitignore + .env.example.

## 2026-11-19 (session 2 — build & verify)

**Packages (all typecheck + unit tests green):**
- `packages/shared` — Zod contracts, validators, hashEmbedding/cosine/lexical similarity, mulberry32/fnv1a, budget presets. **31 tests pass.**
- `packages/core` — fake + OpenAI adapters (AI SDK 7, structured output, retries), 32 source concepts w/ provenance, 4 differentiated operators, diversity selection w/ unusual-lineage slot, pure engine loop, champion strategy. **22 tests pass.**
- `packages/evaluation` — anchored 1–5 rubrics, judge w/ duplicate cross-check, metrics. **5 tests pass.**
- `packages/learning` — Beta-Bernoulli, Thompson + exploration floor, exposure-aware credit, challenger builder, promotion gate. **15 tests pass.**

**Convex (live dev deployment `kindhearted-rook-357`, team `reggiesackey`, project `aghearta`):**
- Full schema (18 tables) with indexes pushed successfully.
- Convex 1.51 adjustments made during push: `v` from `convex/values`; OIDC auth config shape for AuthKit; explicit method+path HTTP routes; queries/mutations split out of `'use node'` files (`internal/persist.ts`, `internal/optimizePersist.ts`); `_creationTime` removed from index fields; duplicate indexes deduped.
- Deployment env set: `AI_PROVIDER=fake`, `WORKOS_*` placeholders, `AGHARTA_TOKEN_HASH_KEY` (dev value — rotate before any real use).
- **Integration journey: 11/11 checks pass** (`pnpm test:convex`) — bootstrap → problem → exploration completes (10 ideas, fake model) → lineage → feedback → learning recompute (6 rows) → MCP token create/revoke → intruder-identity denial.

**Web (`apps/web`, Next.js 16.4.6):**
- All pages built and typechecked: marketing, login (graceful unconfigured state), dashboard, problems new/detail, exploration detail (sorting, operator filter, lineage panel, feedback), mechanisms, learning, settings (MCP tokens).
- Production build: 12 routes, clean.
- **Playwright E2E: 3/3 public tests pass**; auth-flow spec auto-skips without WorkOS credentials (documented).

**MCP (`apps/mcp`, SDK v2):**
- stdio server with 4 registered tools; runs under `node --experimental-strip-types`.
- **Integration test: 3/3 pass** — real client↔server handshake over stdio against a mock bridge; asserts token auth headers and evidence labels in responses.

**Benchmarks:**
- 13 problems (10 dev + 3 holdout) with expected-mechanism annotations.
- `pnpm benchmark` executed on the fake provider: 3 modes × 10 problems × 3 seeds. Honest result recorded in docs/EVALUATION.md: repeated_sampling (9.20 qualUniq) > full_engine (7.70) on the fake model; engine wins diversity (0.455) and zero duplicates. **No real-model run (no API key).**

**Docs:** README (narrative + quickstart + scripts), ARCHITECTURE (mermaid + execution model), EVALUATION (rubrics + genuine benchmark table + tier definitions), SECURITY (authz model, token design, gaps), REFERENCES (pinned versions + verified API notes).

**Determinism fix:** engine idea IDs now derive from exploration/generation/operator/title (was `Date.now()`-based) — the "same seed → same recommendations" property now holds across process runs (verified 8 consecutive runs).

**Lint:** flat-config ESLint (typescript-eslint) at root; web uses its own TS-aware config (`next lint` is removed in Next 16). 0 errors; remaining warnings were unused imports (benign).

## 2026-11-19 (session 3 — verification hardening, real bug fixes, closing both learning loops)

Resumed the uncommitted build. Verified every prior claim, fixed what was actually broken, and extended live coverage. All changes below were executed, not assumed.

**Verification findings & fixes:**
- `pnpm test` previously failed at `benchmarks` (test script with no test files). Added a genuine benchmark-integrity suite (7 tests: ≥12 problems, ≥5 domains × ≥2, unique IDs, holdout/validation disjointness, complete briefs, version tag). It caught a real coverage gap — only one `personal` problem — fixed by adding `bp_skill_plateau` (14 problems now: 11 dev + 3 holdout).
- Stale `tsbuildinfo` had been masking a latent strictness error (`noUncheckedIndexedAccess` on `OPERATORS[...]` lookups) in core tests; surfaced and fixed with non-null assertions on the closed operator union.
- Removed 12 unused-import warnings; **lint is now 0 errors / 0 warnings**.
- E2E was silently testing a *different* Next 15 app occupying :3000 (`reuseExistingServer: true`). Playwright config now uses dedicated port 3100; all 3 public specs pass against this repo's app.

**Real bugs found by new live tests (fixed + re-verified):**
1. **Evaluations were never persisted** — the Convex engine runtime stubbed `persistEvaluation` as a no-op, so deployed explorations stored ideas with no scores (MCP results and dashboard would show `eval: null`). Added `persistEvaluationInternal` and wired the runtime; MCP live test now shows real rubric rows.
2. **Challenger experiments compared identical strategies** — `strategies.challenge` stored `changeProposal` but never applied it. Now parses structured `OptimizerOutput` (with deterministic `fallbackProposal`) and builds a genuinely different challenger via `buildChallenger`; experiment runner uses explicit `VALIDATION_PROBLEMS` (never holdout).
3. **Learned allocations were write-only** — `allocationDecisions` were computed but never read. `explorations.start` now merges the latest Thompson weights into the champion config (preserving the exploration floor), snapshots `effectiveStrategy` + `appliedAllocationWeights` on the exploration, and the runner prefers the snapshot.
4. **Zero-cost gate dead-end** — with the fake provider `costUsd=0`, `qualifiedPerDollar` was always 0 so the default promotion gate could never pass. The runner now falls back to `qualifiedUniqueIdeas` **explicitly labeled** in the rationale (never silently).

**New live evidence (all executed against dev deployment `kindhearted-rook-357`):**
- `pnpm test:convex` → **13/13** (now includes: feedback → recompute → subsequent exploration carries learned weights `{recombination:0.385, analogy:0.119, …}` + snapshotted effective strategy).
- `pnpm test:convex:mcp` (new, real stdio client → real HTTP bridge → real exploration) → **9/9**: 4 tools listed, explore→poll→feedback→learning summary, forged + revoked tokens refused (401).
- `pnpm test:convex:challenger` (new) → **9/9 across both gate paths**: rejection run (0% delta → promote throws, champion unchanged) and promotion run (+13.0% qualified-unique, labeled fallback basis, audit entry, follow-on exploration uses the promoted strategy).
- `pnpm benchmark` re-executed on the 14-problem suite (33 runs/mode): repeated_sampling 9.03 qualUniq > engine 7.27; engine best on diversity 0.456, feasibility 3.51, zero duplicates. Recorded as-is in docs/EVALUATION.md.
- Unit tests: **83 pass** (31 shared + 22 core + 5 evaluation + 15 learning + 7 benchmarks + 3 mcp). Typecheck and build clean across all workspaces.

**Docs updated:** README (learning-loop demo section with the four executed demonstrations, new scripts), EVALUATION (14-problem report + all live evidence), this file.

## 2026-11-19 (session 4 — model-agnostic providers)

User requirement: switchable models across DeepSeek, GLM, OpenAI, Anthropic, etc.

- **`packages/core/src/models.providers.ts`** (new): one provider-agnostic factory over official AI SDK packages — `openai` (`@ai-sdk/openai`), `anthropic` (`@ai-sdk/anthropic`), `deepseek` (`@ai-sdk/deepseek`), `glm` (`@ai-sdk/zai`; aliases `zai`/`zhipu`/`chatglm`), `openai-compatible` (`@ai-sdk/openai-compatible` for Ollama/vLLM/Groq/OpenRouter via `MODEL_BASE_URL`), and `fake`. Generator/judge split (`CREATIVE_PROVIDER`/`JUDGE_PROVIDER` + per-role model ids, keys, baseURLs, cost overrides) so the judge can be a different model family than the generator. Estimated per-provider cost tables (overridable; unknown → $0 + token/wall-clock caps). Switching is env-only — no code changes, engine untouched (it only ever saw the `ModelAdapter` interface).
- 12 new unit tests (aliases, unknown-provider error, key requirements, baseURL requirement, role split, fake fallback). Core now 34 tests; suite 95.
- Convex call sites (`internal/search.ts`, `internal/optimize.ts`) rewired to `adaptersFromEnv`; `.env.example` documents the full matrix.
- **Bug found + fixed by the live switch test:** provider construction sat outside the action's error handling, so a misconfigured provider left explorations stuck `queued` forever. Moved inside a guarded section → `status=failed` with `provider configuration error: …` guidance.
- **Live evidence (`scripts/provider-switch.ts`):** set `AI_PROVIDER=glm` with no key → exploration fails closed with the exact expected message; switch back to `fake` → completes. Full regression after: `test:convex` 13/13, `test:convex:mcp` 9/9, `test:convex:challenger` 9/9.
- Real-model calls (deepseek/glm/openai/anthropic) remain **unexecuted** — no credentials in this environment. The switch plumbing is verified; actual generation quality with each provider is a `npx convex env set` away once a key exists.

## Verification snapshot (end of session 4)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | ✅ all workspaces |
| `pnpm test` | ✅ 95 tests |
| `pnpm lint` | ✅ 0 errors, 0 warnings |
| `pnpm test:convex` | ✅ 13/13 live |
| `pnpm test:convex:mcp` | ✅ 9/9 live |
| `pnpm test:convex:challenger` | ✅ 9/9 live (both gate paths) |
| `pnpm test:convex:provider` | ✅ live switch: glm-without-key fails closed; fake recovers |
| `pnpm test:e2e` | ✅ 3 passed, 1 skipped (no WorkOS creds) |
| `pnpm build` | ✅ web + packages |
| `pnpm benchmark` | ✅ executed (fake model), report in docs/EVALUATION.md |
| Real-model smoke | ❌ not run — no OPENAI_API_KEY |
| Hosted AuthKit login | ❌ not run — no WorkOS credentials (placeholder client ID in dev) |

## Needs / next prioritized

1. **Real credentials smoke tests** — set `OPENAI_API_KEY` in Convex env + cost cap, run one real exploration and the real-model benchmark; set real WorkOS client/API key and run the authenticated E2E flow end-to-end.
2. **Rotate dev secrets** — `AGHARTA_TOKEN_HASH_KEY` and `WORKOS_COOKIE_PASSWORD` are dev placeholders.
3. ~~HTTP-bridge rate limiting + token attempt lockout~~ **closed in session 6** (verified live 6/6).
4. Learning-page challenger flow UI polish; scheduler for periodic `recomputeOperatorStats` after feedback bursts.
5. GitHub Actions CI (typecheck/test/build matrix).
6. External retrieval for source concepts (SSRF-guarded); GEPA-style prompt optimization experiments.
7. Deploy web (Vercel) + `npx convex deploy` for prod deployment.

## 2026-11-20 (session 6 — security gaps closed)

All three flagged security gaps implemented and verified live:

1. **Per-IP rate limiting** — `authAttempts` counters + `checkAndConsumeIp` mutation (60 req / 10 min window per IP, atomic check+consume in one mutation). Applied to all 5 authenticated HTTP routes (4 REST + `/mcp` JSON-RPC). Exceeding → HTTP 429 with `Retry-After`.
2. **Token attempt lockout** — 5 failed auths per token prefix → 15-minute lockout, checked *before* any hash work. Successful auth clears failures. Verified live: 5 forgeries lock the prefix; the CORRECT token is then refused; a different prefix is unaffected; admin can clear the lockout early.
3. **Security audit log** — `securityAudit` table: auth denials (with prefix + failure count), rate-limit hits, credential create/replace/delete, token create/revoke, manual rollbacks. No secret material logged. Admin query surfaces recent entries.

**Live evidence:** `scripts/security-guard-live.ts` → **6/6** on `kindhearted-rook-357`. Full regression after: v2-mcp-live **11/11**, v2-byok-live **7/7**, v2-loop-live **14/14** — the guard does not impede legitimate traffic (each suite makes ~10-20 requests under the 60/window budget).

## 2026-11-19 (session 5 — V2 build: two-engine architecture)

Executed the AGHARTA V2 brief end to end. All items below ran; nothing is claimed from scaffolding alone.

**Stage 1 — contracts + representation** (`packages/shared/src/v2.ts`, `mechanisms.ts`): ProblemStructure / Mechanism / Hypothesis / ExperimentRecord / ConceptualMap / SearchPolicy / ArtifactEvaluation / ExperimentObservation schemas; curated 37-mechanism cross-domain library with provenance + appliesWhen. Fixed a real dependency cycle (`core → learning → evaluation → core`) by moving `ExplorationMetrics` to shared.

**Stage 2 — Engine 1** (`packages/core/src/search/engine2.ts`): 7-step experimental cycle (interpret → consult → hypothesize → investigate → recombine → novelty-judge → refine) with slot-based hypothesis selection, rejected-path preservation, multi-reference novelty, full experiment records. Fake model synthesizes every step deterministically.

**Stage 3 — Engine 2** (`packages/learning/src/v2/`): compat (L2 logistic over hashed joint features), selection (Thompson sampling + hard exploration floor), learn (posterior updates with IPW bias correction), observe (structured observations with evidence tiers), initial (seed artifacts). **End-to-end test proves learning changes the next experiment:** synthetic evidence shifts compat weights → selection probabilities change → different mechanisms get investigated.

**Stage 4 — automatic optimization** (`convex/internal/v2.ts`, `v2store.ts`): async learning worker; champion/challenger validation bench (4 problems × 3 seeds, matched budgets); confidence-aware gate (≥8% novelty @ ≥95% posterior, coherence non-regression); atomic promotion + pair-exact rollback; idempotent processing. Fixes found by live tests: `processedByLearning` defaulted undefined (eq(false) matched nothing); promotion-audit schema rejected V2 ids.

**Stage 5 — decision tier** (`packages/core/src/decisions/`): DecisionProvider interface; **policy decider** (algorithmic, computed from learned policy snapshot, zero cost); **Jev decider** (verified against current docs: POST /v1/systemone, choice/score/noul primitives, $0.042/Mtok input) — rank output only modulates the learned prior within [0.5, 1.5]; per-call fallback chain. Engine integration: classify assist + bounded pre-judging screen (≤30% drop), decision usage recorded in modelInfo. Three-arm benchmark (`benchmarks/decisions.ts`) with honest skip labeling.

**Stage 6 — UX + security**: BYOK vault (AES-256-GCM, per-workspace HKDF keys, fingerprints only in UI, fail-closed missing-key path — verified live); remote MCP endpoint `/mcp` (Streamable HTTP JSON-RPC, token auth, 4 tools) + `/.well-known/mcp-manifest.json`; dashboard: `/experiments` (+ detail), `/v2learning` (runs, gates, rollback), settings BYOK panel, interactive conceptual-map graph with edge-evidence inspection.

**Live verification on dev deployment `kindhearted-rook-357` (all re-run after Stage 5 deploy):**
- `scripts/v2-loop-live.ts` — **14/14**: full loop, slot counts, active-snapshot reuse, idempotent learning, rollback.
- `scripts/v2-mcp-live.ts` — **11/11**: remote MCP init/tools/explore/poll/feedback/summary, auth rejection, manifest.
- `scripts/v2-byok-live.ts` — **7/7**: set/list (metadata only)/delete credential, runs with and without BYOK.
- Unit suite — **121 pass** (31 shared + 23 learning + 52 core incl. 14 decision + 5 evaluation + 7 benchmarks + 3 mcp).
- Decision benchmark executed (fake creative model): policy-tier decisions cost $0.000000 and 0 calls vs LLM-tier 18 calls / 12,081 tokens per 9 experiments; novelty within noise (3.497 vs 3.543 composite — screening cannot create novelty, only preserve it). **Jev arm NOT executed — no JEV_API_KEY; reported as skipped, not fabricated.**

**Not executed (credentials unavailable):** real-model runs (OpenAI/Anthropic/DeepSeek/GLM), Jev live calls, hosted WorkOS login, ChatGPT connector publishing. All code paths implemented and fixture-tested; each is one env var away.

## Verification snapshot (end of session 5)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | ✅ all workspaces |
| `pnpm test` | ✅ 121 tests |
| `pnpm build` (web) | ✅ 15 routes |
| `v2-loop-live` | ✅ 14/14 live |
| `v2-mcp-live` | ✅ 11/11 live |
| `v2-byok-live` | ✅ 7/7 live |
| Decision benchmark | ✅ executed (fake model); Jev arm honestly skipped |
| Real-model smoke | ❌ no provider keys in env |
| Jev live | ❌ no JEV_API_KEY |
| ChatGPT connector publish | ❌ external review step (docs written) |
