# References

Versions pinned by `pnpm-lock.yaml`; verified during the 2026-11-19 build. Local, version-matched docs were read where available (`node_modules/<pkg>/docs`, package READMEs) instead of relying on memory.

## Core platform

| Dependency | Version | Reference |
| --- | --- | --- |
| Next.js | 16.4.6 | https://nextjs.org/docs — proxy/middleware pattern (`proxy.ts`), App Router, `params` Promise API |
| React | 19.2.0 | https://react.dev |
| Convex | 1.51.0 | https://docs.convex.dev — see notes below on 1.51 specifics |
| @workos-inc/authkit-nextjs | 4.6.3 | https://workos.com/docs/user-management/authkit |
| Tailwind CSS | 4.3.5 | https://tailwindcss.com/docs |
| @xyflow/react | 13.0.2 | https://reactflow.dev — lineage graph view |

## Convex 1.51 specifics verified during build

- `v` (validators) is imported from `convex/values`, **not** re-exported by `convex/server`.
- Auth config for AuthKit uses the OIDC provider shape `{ domain, applicationID }` (`https://auth.workos.com` + WorkOS client ID) — https://docs.convex.dev/auth/authkit
- `httpRouter.route` requires explicit `method` and exact `path` (no prefix routing).
- Queries/mutations cannot be defined in `'use node'` files; they were split into default-runtime modules (`convex/internal/persist.ts`, `optimizePersist.ts`).
- `_creationTime` is appended to indexes automatically and must not be listed explicitly.
- Internal function references for files under `convex/internal/` are `internal.<module>.<fn>` (single `internal` prefix in code; `internal/…` in function names).
- Convex + AuthKit guide: https://docs.convex.dev/auth/authkit · auto-provisioning: https://docs.convex.dev/auth/authkit/auto-provision

## WorkOS AuthKit v4 specifics verified during build

- `getAuthorizationUrl` was replaced by `getSignInUrl()` / `getSignUpUrl()` server helpers.
- Client components: `AuthKitProvider`, `useAuth`, `useAccessToken` from `@workos-inc/authkit-nextjs/components`.
- Middleware env: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY` (server), `WORKOS_COOKIE_PASSWORD`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI` (the redirect URI env is `NEXT_PUBLIC_`-prefixed in v4).
- Callback route: `handleAuth()` from `authkit-nextjs` at `/app/callback/route.ts`.

## AI / MCP

| Dependency | Version | Reference |
| --- | --- | --- |
| ai (Vercel AI SDK) | 7.x | https://ai-sdk.dev — `generateText` + `Output.object({ schema })` structured output; usage fields are `inputTokens`/`outputTokens` in v7 |
| @modelcontextprotocol/server | 2.4.0 | https://modelcontextprotocol.io — TS SDK v2: `server.registerTool(name, { inputSchema: ZodRawShape }, handler)` |
| @modelcontextprotocol/client | 2.4.0 | used by the stdio integration test |

## Learning / statistics background (design, not dependencies)

- Thompson sampling: Russo & Van Roy, *Introduction to Bandits and Learning to Optimize* — https://web.stanford.edu/~bvr/pubs/TS_Tutorial.pdf
- Beta-Bernoulli posteriors for binary outcomes; exploration floor to prevent starvation (standard bandit practice).
- GEPA / Jevons-style prompt optimization tracked in BUILD_STATUS as future work: https://arxiv.org/abs/2507.19457 (GEPA)

## Tooling

| Tool | Version |
| --- | --- |
| pnpm | 12.21.0 |
| TypeScript | 5.7 |
| Vitest | 5.1 |
| Playwright | 1.56 |
| Node | ≥ 22 (24 LTS current default) |
