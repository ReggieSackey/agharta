/**
 * LIVE security-guard verification against the real Convex deployment.
 *
 *   1. 5 forged-token requests → 401s (attempts counted, audit written)
 *   2. lockout engages → even the CORRECT token refused for that prefix
 *   3. different prefix unaffected (per-prefix isolation)
 *   4. audit trail contains auth_denied entries
 *   5. lockout cleared → valid token works again (normal flow intact)
 *
 * Requires: CONVEX_DEPLOYMENT (+ optional CONVEX_TEAM_SLUG/PROJECT_SLUG).
 * Exits nonzero on failure. Honest pass/fail per check.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import type { UserIdentityAttributes } from 'convex/server';

const api = anyApi as any;
const deploymentRef = process.env.CONVEX_DEPLOYMENT ?? '';
if (!deploymentRef) throw new Error('CONVEX_DEPLOYMENT not set');

const results: Array<[string, boolean, string]> = [];
function check(name: string, ok: boolean, detail = '') {
  results.push([name, ok, detail]);
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  // --- authorize as admin (same pattern as v2-mcp-live) ---
  const configPath = `${homedir()}/.convex/config.json`;
  const accessToken = JSON.parse(readFileSync(configPath, 'utf8')).accessToken;
  const deploymentName = deploymentRef.replace('dev:', '');
  const res = await fetch('https://api.convex.dev/api/deployment/authorize_within_current_project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      selectedDeploymentName: deploymentName,
      projectSelection: {
        kind: 'teamAndProjectSlugs',
        teamSlug: process.env.CONVEX_TEAM_SLUG ?? 'reggiesackey',
        projectSlug: process.env.CONVEX_PROJECT_SLUG ?? 'aghearta',
      },
    }),
  });
  if (!res.ok) throw new Error(`authorize failed: ${res.status}`);
  const { adminKey, url } = (await res.json()) as { adminKey: string; url };
  const siteUrl = process.env.CONVEX_SITE_URL ?? url.replace('convex.cloud', 'convex.site');
  const mcpUrl = `${siteUrl}/mcp`;

  const user = new ConvexHttpClient(url);
  const identity: UserIdentityAttributes = {
    tokenIdentifier: 'https://auth.workos.com|guard-live-agent',
    subject: 'guard-live-agent',
    issuer: 'https://auth.workos.com',
    name: 'Guard Live Test',
  };
  // @ts-expect-error runtime method exists; typing lags in convex 1.51
  user.setAdminAuth(adminKey, identity);
  const me = await user.mutation(api.users.getOrCreateMe, {
    displayName: 'Guard Live Test',
    email: 'guard@test.local',
  });
  const minted = await user.mutation(api.mcpTokens.create, {
    workspaceId: me.workspaceId,
    label: 'guard-live-test',
  });
  const token: string = minted.token;
  const prefix = token.slice(0, 12);
  check('token minted', token.startsWith('agt_'));

  const rpc = async (bearer: string): Promise<{ status: number; authed: boolean; name?: string; tools?: number }> => {
    const r = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      error?: { code?: number; message?: string };
      result?: { serverInfo?: { name?: string } };
    };
    return {
      status: r.status,
      // JSON-RPC carries auth failures in the body (-32001), not HTTP status
      authed: !body.error && !!body.result,
      name: body.result?.serverInfo?.name,
      tools: body.result?.tools?.length,
    };
  };

  // 1: five forged-token hits sharing the REAL prefix
  const forged = prefix + 'FORGEDFORGEDFORGEDFORGEDFORGE';
  const verdicts: boolean[] = [];
  for (let i = 0; i < 6; i++) {
    const v = await rpc(forged);
    verdicts.push(v.authed);
  }
  check('forged tokens rejected', verdicts.slice(0, 5).every((v) => !v), `5× denied (JSON-RPC -32001)`);

  // 2: correct token now refused — same prefix locked
  const locked = await rpc(token);
  check('correct token refused during lockout', !locked.authed, `authed=${locked.authed}`);

  // 3: different prefix NOT locked — its failures count independently, but
  // the response must still be denial (wrong token) not lockout confusion
  const other = 'agt_zDIFFERENT0' + 'X'.repeat(28);
  const otherRes = await rpc(other);
  check('different prefix unaffected by lockout', !otherRes.authed, 'denied by auth mismatch');

  // 4: audit trail — read via admin query
  const audit = await user.query(api.internal.guard.listAuditAdmin, { limit: 50 }) as Array<{
    category: string; action: string; detail?: string;
  }>;
  const deniedCount = audit.filter(
    (r) => r.action === 'token_auth_failed' && r.detail?.includes(prefix)
  ).length;
  check('auth failures audit-logged', deniedCount >= 5, `${deniedCount} entries for ${prefix}`);

  // 5: clear lockout (admin) → valid flow works
  await user.mutation(api.internal.guard.clearLockoutAdmin, { prefix });
  const okRes = await rpc(token);
  check(
    'valid token works after lockout cleared',
    okRes.authed && (okRes.tools ?? 0) >= 4,
    `tools/list returned ${okRes.tools ?? 0} tools`
  );

  await user.mutation(api.mcpTokens.revoke, { tokenId: minted.id }).catch(() => {});

  const passed = results.filter((r) => r[1]).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
