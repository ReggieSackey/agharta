# AGHARTA

**Agharta makes LLMs more creative — measurably, and increasingly so with use.** Instead of asking a model once and hoping for inspiration, Agharta runs an **experimental creative search**: it interprets what your problem *is* structurally, borrows specific causal mechanisms from unrelated fields, tests competing transfer hypotheses, and returns the most novel coherent ideas — while an asynchronous learning engine studies every experiment and gets better at searching.

Works with any major model provider (OpenAI, Anthropic, DeepSeek, GLM, or any OpenAI-compatible endpoint — bring your own key), through a web dashboard or an [MCP](https://modelcontextprotocol.io) client like ChatGPT or Cursor.

> *Agharta* is named after the 1975 Miles Davis album — an hour of improvised, structured searching by a small ensemble. That's the spirit: improvisation with provenance.

---

## Why this exists

Ask an LLM for unconventional ideas on a hard problem and you get the same recycled advice every time. One prompt, no search, no memory of what worked.

Agharta's answer is not a better prompt. It is **two engines**:

### Engine 1 — Experimental Creative Search (runs when you submit a problem)

1. **Interpret** — a model produces a structured representation of the problem: objective, actors, incentives, constraints, and the conventional solutions you want to move *beyond*.
2. **Consult** — retrieve the currently active learned conceptual map + search policy (versioned artifacts published by Engine 2).
3. **Hypothesize** — form ~6 competing hypotheses, each connecting the problem's structure to a **specific transferable mechanism** (not "borrow from biology" but a named causal mechanism from immunology, auction design, ecology, aerospace, …). Three exploitation slots (learned-promising), two exploration slots (uncertain/distant territory — mandatory), one wildcard that attacks the problem's framing.
4. **Investigate** — for each hypothesis: extract the mechanism's causal principle, map it onto the problem, generate concrete candidates, then *critique* the transfer for invalid assumptions. Rejected paths are kept.
5. **Evaluate novelty** against multiple reference points — conventional solutions, sibling candidates in the same run, transfer distance, substantive difference — with coherence and relevance as gates, not goals.
6. **Refine** the top novel-coherent candidates into 2–3 final proposals: the mechanism story, why it differs from conventional advice, a concrete test step, and honest assumptions.
7. **Record everything** — hypotheses (all of them), intermediate candidates, evaluations, usage, versions, errors. Failed experiments are signal, not noise.

### Engine 2 — Asynchronous Learning (runs after experiments, out of band)

Every completed experiment becomes structured observations. Engine 2:

- Fits **hierarchical Beta-Bernoulli posteriors** (tag→mechanism edges, shrunk toward field-level and global priors) and a **regularized logistic compatibility model** `compat(problem structure, mechanism)` trained on hypothesis outcomes with inverse-selection-probability weighting to correct exploration bias.
- Publishes **immutable, versioned artifacts**: a `ConceptualMap` (nodes + learned weighted edges) and a `SearchPolicy` (compatibility weights, distance preference, slot allocation, field posteriors). Nothing is edited in place; every version has provenance.
- **Champion vs challenger**: when a learning run proposes new artifacts, both versions run on a fixed validation suite (matched budgets, matched seeds, disjoint from training data). A pre-declared gate — ≥8% mean-novelty improvement at ≥95% posterior confidence, no coherence regression — decides. Pass → **automatic promotion** (atomic pointer swap, auditable, one-click rollback). Fail → champion retained. No human in the loop, no unverifiable claims.

**The loop that matters:** experiment → observation → learning → gated promotion → *next experiment selects different hypotheses*. This is testable and tested — synthetic evidence shifts learned compatibility, which shifts hypothesis selection probabilities, which changes what Engine 1 investigates next. The exploration floor is hard-coded and learning cannot remove it.

## What's in the box

- **Two-engine search + learning** (`packages/core`, `packages/learning`, `packages/shared`) — pure, testable modules with Zod-validated boundaries.
- **Web dashboard** (Next.js 16 + Convex): submit problems, watch experiments run, inspect every hypothesis (including rejected ones and why), an **interactive conceptual map** with evidence behind every learned edge, learning-run history with gate decisions and rollback, and BYOK settings.
- **MCP, local + remote**: a stdio server for local clients and a **Streamable HTTP endpoint** (`/mcp`, JSON-RPC 2.0, token-authenticated) for ChatGPT and other hosted assistants — tools: `explore_problem`, `get_exploration`, `submit_idea_feedback`, `get_learning_summary`.
- **BYOK credential vault**: AES-256-GCM at rest, per-workspace HKDF-derived keys, plaintext never returned to clients or logged. Delete anytime; runs fall back to server config or the deterministic fake provider.
- **Benchmarks**: fixed problem suites (development / validation / holdout) comparing single-prompt, repeated-sampling, and full-engine runs; decision-tier comparison (LLM-decisions vs algorithmic-learned-policy vs optional Jev) on cost, latency, novelty, coherence.

## Model-agnostic, provider-independent

The engine talks to one `ModelAdapter` interface. Swap providers via environment variables or per-workspace BYOK — no code changes:

| `AI_PROVIDER` | Package |
| --- | --- |
| `openai` | `@ai-sdk/openai` |
| `anthropic` | `@ai-sdk/anthropic` |
| `deepseek` | `@ai-sdk/deepseek` |
| `glm` (aliases: `zai`, `zhipu`) | `@ai-sdk/zai` |
| `openai-compatible` (Ollama, vLLM, Groq, OpenRouter, …) | `@ai-sdk/openai-compatible` |
| `fake` (default; deterministic, zero-cost, for dev/tests) | — |

Optional decision tier: set `JEV_API_KEY` to route cheap classify/rank/screen calls through [Jev](https://docs.typesafe.ai) (TypeSafe AI). Without it — or if Jev errors mid-run — decisions fall back to the algorithmic decider computed from the learned policy. The learned policy always remains authoritative; Jev can reorder exploitation priorities within bounds, never touch the exploration floor.

## Quick start

```bash
pnpm install
pnpm dev            # web dashboard on :3000 (fake provider — works with no keys)
```

Optional:

```bash
npx convex env set AI_PROVIDER=openai
npx convex env set OPENAI_API_KEY=sk-...
pnpm test           # full unit suite
pnpm test:convex    # live integration against your Convex deployment
```

See `.env.example` for every variable and `docs/V2_ARCHITECTURE.md` for the full architecture.

## Connecting to ChatGPT

1. Sign in to the dashboard → **Settings** → create an MCP token.
2. ChatGPT → Settings → Connectors → Add connector → `https://<your-deployment>.convex.site/mcp` with the token.
3. Ask: *"Use the agharta explore_problem tool: I need an unconventional approach to …"*
4. Results arrive in the conversation; the full experiment (hypotheses, rejections, evaluations) is in your dashboard. Feedback you give flows into Engine 2.

The discovery manifest is served at `/.well-known/mcp-manifest.json`. Self-hosting notes are in `docs/`.

## Evidence honesty (the core design rule)

Three tiers of evidence are stored, labeled, and displayed separately — never merged:

1. **Automated** — model-judged novelty/coherence with uncertainty and evaluator identity.
2. **Human** — your shortlists, ratings, and rejections.
3. **Real outcomes** — attempted/succeeded/failed, marked `self_reported` unless verified.

When the system claims learning improved search, you can see the gate evaluation: champion vs challenger novelty, posterior confidence, and the reasons a promotion passed or failed. Where data is insufficient to demonstrate improvement, the docs say so plainly.

## Repository layout

```
packages/shared      Zod contracts, mechanism library (37 curated cross-domain mechanisms), budgets, usage
packages/core        Engine 1 (search/engine2), model adapters (fake + 5 providers), decision tier
packages/learning    Engine 2 (compat model, selection, learning pipeline, promotion gate)
packages/evaluation  Judge rubrics (V1 engine)
apps/web             Next.js dashboard
apps/mcp             stdio MCP server
convex               schema, actions, HTTP routes (/mcp, manifest), BYOK vault, learning workers
benchmarks           problem suites + reproducible runners (incl. decision-tier comparison)
docs                 architecture, security, evaluation, build log
```

MIT licensed. Self-hostable end to end — the core system is open-source and provider-independent; no inference is billed by Agharta.
