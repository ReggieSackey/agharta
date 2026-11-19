# AGHARTA

> **Agharta is a self-improving creative search engine.** It approaches a problem through multiple strategies, tracks how each idea was formed, evaluates and compares the results, learns which strategies work in different contexts, and makes that learning visible. It can be used through a web dashboard or an MCP client.

**Status:** v0.1 — build status in [docs/BUILD_STATUS.md](docs/BUILD_STATUS.md).

---

## What it does

Give Agharta a difficult, open-ended problem ("reduce ER readmissions without new staff", "make municipal budgeting participatory"). It runs a multi-generation creative search:

1. **Four creative operators** generate candidate interventions — `divergent`, `analogy`, `inversion`, `recombination` — each grounded in a curated library of 32 cross-domain source mechanisms with provenance.
2. **Every idea carries provenance**: operator, generation, parent ideas (lineage), and the source concepts that inspired it.
3. **An anchored-rubric judge** scores originality/usefulness/feasibility (1–5) and cross-checks for near-duplicates.
4. **Diversity-aware selection** keeps the next generation meaningfully different (quality proxy + min-distance to selected), with a reserved slot for unusual-but-viable ideas.
5. **The learning loop** watches what happens to ideas — generated → shortlisted → attempted → succeeded/failed — and reallocates operator budgets via Thompson sampling with an exploration floor, per problem domain. Nothing is promoted without a benchmark gate **and** explicit user confirmation.
6. **Evidence tiers are strict**: automated proxy scores, human shortlists, and verified real-world outcomes are stored, labeled, and charted separately. An automated score is never presented as a real outcome.

## Quickstart

Requires Node 22+, pnpm (`npm i -g pnpm`), and a Convex account (`npx convex login`).

```bash
pnpm install

# 1. Deploy Convex functions (creates dev deployment + .env.local)
npx convex dev

# 2. Configure the web app
cp .env.example apps/web/.env.local   # then fill WORKOS_* values
pnpm build                            # inlines NEXT_PUBLIC_* env

# 3. Run everything
pnpm dev:web      # http://localhost:3000
pnpm dev:mcp      # optional: MCP stdio server (needs AGHARTA_MCP_TOKEN)
```

Without WorkOS credentials the login page shows a configuration notice; the marketing page and auth-gating middleware still work (that is what the E2E suite covers).

**Deterministic fake model (no API keys needed):** set Convex env `AI_PROVIDER=fake` (`npx convex env set AI_PROVIDER fake`). Every test, the Convex integration journey, and the benchmark report below run on this provider — results are reproducible and free.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev:web` | Next.js dev server on :3000 |
| `pnpm dev:convex` | Push Convex functions once (`npx convex dev --once`) |
| `pnpm dev:mcp` | MCP stdio server (needs `AGHARTA_MCP_TOKEN`, `AGHARTA_CONVEX_HTTP_URL`) |
| `pnpm build` | Build all packages + web |
| `pnpm test` | Unit tests (shared, core, evaluation, learning, benchmarks, mcp) |
| `pnpm test:convex` | Live Convex integration journey incl. learning-allocation loop (13 checks) |
| `pnpm test:convex:mcp` | Live MCP↔bridge↔exploration journey incl. token forgery/revocation denials (9 checks) |
| `pnpm test:convex:challenger` | Live challenger experiment journey: both gate paths, promotion audit, follow-on use (9 checks) |
| `pnpm test:e2e` | Playwright E2E (public pages always; auth flow with credentials; port 3100) |
| `pnpm typecheck` | TypeScript across all workspaces |
| `pnpm lint` | ESLint |
| `pnpm benchmark` | Benchmark runner: single-prompt vs repeated-sampling vs full engine |

## Architecture (short)

pnpm monorepo: `apps/web` (Next.js 16 + AuthKit + Convex), `apps/mcp` (MCP SDK v2 stdio server), `convex/` (database + durable actions), `packages/{shared,core,evaluation,learning}` (pure, testable domain logic), `benchmarks/` (14 problems incl. holdouts).

Details and Mermaid diagram: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Evaluation honesty

The judge's rubric scores are an **automated proxy**, not ground truth. The benchmark table in [docs/EVALUATION.md](docs/EVALUATION.md) reports the fake-model run executed during this build: on that provider, repeated sampling currently beats the full engine on qualified-unique ideas — recorded as-is, no cherry-picking. Real-model benchmarks require `OPENAI_API_KEY` and were not executed (no credentials in this environment).

## The learning loop, demonstrated (not claimed)

Every statement below was executed against the live dev deployment during this build; the checks live in `scripts/`:

1. **Within-workspace allocation learning** (`pnpm test:convex`): outcome feedback → `recomputeOperatorStats` → Thompson-sampled allocation written with seed → the *next* exploration snapshots non-uniform learned weights (observed: recombination 0.385, analogy 0.119) and runs with them.
2. **Challenger gate — rejection path** (`pnpm test:convex:challenger`): a challenger that didn't clear the pre-declared gate (0% delta < 10% required) was marked `rejected`; `strategies.promote` threw; the champion was untouched.
3. **Challenger gate — promotion path** (same script, later run): an analogy-weighted challenger improved the primary metric 13.0% over 4 validation problems × 3 seeds (labeled zero-cost fallback basis), promoted with an audit entry (`v0.1 → v0.2-challenger`), and a subsequent exploration ran under the promoted strategy.
4. **MCP from a real client** (`pnpm test:convex:mcp`): a real stdio MCP server + client handshake listed all 4 tools, ran an exploration to completion (8 ideas with operator provenance and proxy-score labels), submitted feedback, and the bridge refused both forged and revoked tokens (401).

## Model-agnostic providers

The engine talks to a single `ModelAdapter` interface; the provider behind it is env-config and can be switched per deployment or per role:

| `AI_PROVIDER` | Package | Notes |
| --- | --- | --- |
| `openai` | `@ai-sdk/openai` | default model `gpt-5.2` |
| `anthropic` | `@ai-sdk/anthropic` | e.g. `claude-sonnet-4-5` |
| `deepseek` | `@ai-sdk/deepseek` | e.g. `deepseek-chat` |
| `glm` (aliases `zai`/`zhipu`) | `@ai-sdk/zai` | e.g. `glm-4.6` |
| `openai-compatible` | `@ai-sdk/openai-compatible` | any OpenAI-style API via `MODEL_BASE_URL` (Ollama, vLLM, Groq, OpenRouter…) |
| `fake` | built-in | deterministic, free, default |

Split generator and judge across providers with `CREATIVE_PROVIDER` / `JUDGE_PROVIDER` (+ per-role `*_MODEL_ID`, `*_API_KEY`, `*_BASE_URL`, `*_COST_*`). All set via `npx convex env set` — verified live: a misconfigured provider fails the exploration with a clear error (never a stuck run), and switching back recovers immediately. See `.env.example` for the full matrix.

## MCP usage

```bash
# 1. Create a personal token in Settings → MCP tokens (plaintext shown once)
# 2. Point a client at the server:
AGHARTA_CONVEX_HTTP_URL=https://<deployment>.convex.site \
AGHARTA_MCP_TOKEN=agt_... \
node apps/mcp/src/index.ts
```

Four tools: `explore_problem`, `get_exploration`, `submit_idea_feedback`, `get_learning_summary`. The token authenticates via keyed HMAC hash through a fail-closed Convex HTTP bridge — it is never a Convex admin key.

## Security notes

- Every Convex query/mutation validates identity + workspace membership (tested: intruder identity is denied).
- MCP tokens stored as HMAC-SHA256 keyed hashes, constant-time comparison, revocable.
- No user-authored shell/URL execution anywhere in operators.
- See [docs/SECURITY.md](docs/SECURITY.md).

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, data flow, Mermaid diagram
- [docs/EVALUATION.md](docs/EVALUATION.md) — rubrics, metrics, benchmark report (genuine results, labeled)
- [docs/SECURITY.md](docs/SECURITY.md) — authz model, token handling, rate/cost limits
- [docs/REFERENCES.md](docs/REFERENCES.md) — pinned dependency versions and reference URLs
- [docs/BUILD_STATUS.md](docs/BUILD_STATUS.md) — what shipped, what's verified, next tasks
