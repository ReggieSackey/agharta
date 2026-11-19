# BUILD STATUS

Log of real progress. Nothing is marked done unless it ran.

## 2026-11-19

- Inspected environment: empty git repo at repo root; Node v24.12.0; pnpm installed (12.21.0).
- Confirmed current library versions on npm: next 16.4.6, convex 1.51.0, ai 7.0.x, @modelcontextprotocol/server 2.4.0 (v2 split confirmed), @workos-inc/authkit-nextjs 4.6.3, @ai-sdk/openai 4.0.x, zod 4.6.7, @xyflow/react 13.x, vitest 5.
- Convex MCP `status` reports no deployment for this directory yet — will provision an anonymous dev deployment via `npx convex dev` (no login credentials available in this environment).
- No OpenAI/WorkOS credentials available in this environment. Building with the deterministic fake model as the default provider; `.env.example` documents every required var. Real-credential paths (OpenAI adapter, WorkOS hosted login) are implemented but untested against live services — listed under Needs.
- Scaffold: pnpm workspace + root package.json + tsconfig.base + .gitignore + .env.example.

## Next

- packages/shared → core → evaluation → learning packages with tests.
- Convex schema + functions; anonymous dev deployment push.
- Web dashboard, MCP stdio server, benchmarks.
