# Security

## Authorization model

**Convex is the enforcement point, not the web middleware.** WorkOS AuthKit route protection (proxy.ts) is UX gating only. Every public Convex function:

1. reads `ctx.auth.getUserIdentity()` (WorkOS-issued JWT, verified by Convex against the AuthKit OIDC provider configured in `auth.config.ts`),
2. resolves workspace membership through the indexed `workspaceMembers` table (`convex/auth.ts`: `requireWorkspaceMembership`, `requireProblemAccess`, `requireExplorationAccess`, `requireIdeaAccess`),
3. and scopes every read/write to that workspace.

Verified by test: the integration script's "intruder denied" check holds a *different* identity against another workspace's exploration and asserts the call fails.

## MCP tokens

- Format `agt_<43 random chars>` generated server-side (`crypto.getRandomValues`).
- **Only the keyed hash is stored**: HMAC-SHA256 with `AGHARTA_TOKEN_HASH_KEY` (Convex env secret). Plaintext is returned exactly once at creation.
- Lookup is prefix-indexed (`tokenPrefix`, first 12 chars), then constant-time comparison of full hashes — no plaintext anywhere in the database.
- Tokens carry `revokedAt` / `expiresAt`; revoked or expired tokens fail authentication.
- The MCP client process only ever holds the personal token. Convex admin/deploy keys never leave the backend/CI.
- The HTTP bridge (`convex/http.ts`) binds every request to the token's workspace and calls internal functions with that workspace — clients cannot name arbitrary workspaces.

## Input and execution safety

- All client input validated by Convex `v.*` validators **and** Zod schemas (`ProblemInputSchema`, feedback enums, length caps) before persistence.
- Operators construct prompts from structured problem fields only. **No user-authored shell commands, URLs, or tool execution** exist anywhere in the operator path.
- Model output must parse against strict Zod schemas; failures are counted, retried with backoff, and surfaced as `ModelBoundaryError` — never silently coerced.
- Model-generated text is rendered as text nodes by React (no `dangerouslySetInnerHTML` anywhere).
- Budget caps (`maxTokens`, `maxCostUsd`, `maxGenerations`, `populationSize`) bound every run; `MAX_RUN_COST_USD` caps deployment-level spend.

## Rate/abuse limits

- MCP bridge auth failures return 401 without oracle information; constant-time compare prevents timing extraction.
- Benchmark dev bridge is **fail-closed**: refuses (404) unless `AGHARTA_BENCHMARK_TOKEN` is set, and requires constant-time-equal bearer.
- Idea listing bounded (take 200), lineage walk bounded (4 hops), feedback listing bounded.

## Secrets hygiene

- `.env.example` documents variables with no real values.
- `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `AGHARTA_TOKEN_HASH_KEY` are server/Convex-only; none are `NEXT_PUBLIC_*`.
- The repo contains no credentials; `.env.local` files are gitignored.
- Error details are persisted server-side (`explorations.errors`) for developers; user-facing surfaces show status only.

## Known gaps (tracked in BUILD_STATUS)

- No per-IP rate limiting on the HTTP bridge yet (Convex doesn't provide it natively; candidate: edge proxy or convex-rate-liter component).
- Token attempt counting (lockout after N failures) is not yet implemented.
- Audit logging is currently limited to promotion decisions (`promotionAudit`).


## Rate limiting & lockout (2026-11-20, verified live)

- Per-IP budget: 60 requests / 10-minute window on every authenticated HTTP route (REST + `/mcp`). Exceeding returns `429` with `Retry-After`; the event is audit-logged.
- Token lockout: 5 failed authentications sharing a token prefix trigger a 15-minute lockout checked before hash verification. A successful authentication resets the failure counter.
- Audit trail (`securityAudit`): auth denials, rate-limit hits, credential lifecycle (create/replace/delete — provider name only, never key material), token create/revoke, manual rollbacks.
- Live verification: `scripts/security-guard-live.ts` (6/6) — forged tokens rejected, lockout engages and blocks the legitimate token for that prefix, other prefixes unaffected, audit entries written, recovery after admin clear.
