/**
 * LIVE provider-switch test: proves model-agnostic switching works end-to-end.
 *
 * Steps:
 *   1. (assumes AI_PROVIDER=glm was just set WITHOUT a GLM key)
 *      → start exploration → must reach status=failed with a clear
 *        "no API key" error (fail closed, no partial success).
 *   2. set AI_PROVIDER=fake back → start exploration → completes.
 *
 * Usage: npx tsx scripts/provider-switch.ts [phase]
 *   phase "expect-fail" (default when provider is misconfigured) or "expect-ok"
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import type { UserIdentityAttributes } from 'convex/server';

const api = anyApi as any;
const phase = process.argv[2] ?? 'expect-fail';

async function creds() {
  const deploymentRef = process.env.CONVEX_DEPLOYMENT ?? '';
  if (!deploymentRef) throw new Error('CONVEX_DEPLOYMENT not set');
  const deploymentName = deploymentRef.split(':')[1] ?? deploymentRef;
  const accessToken = JSON.parse(readFileSync(`${homedir()}/.convex/config.json`, 'utf8')).accessToken;
  const res = await fetch('https://api.convex.dev/api/deployment/authorize_within_current_project', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      selectedDeploymentName: deploymentName,
      projectSelection: {
        kind: 'teamAndProjectSlugs',
        teamSlug: process.env.CONVEX_TEAM_SLUG!,
        projectSlug: process.env.CONVEX_PROJECT_SLUG!,
      },
    }),
  });
  if (!res.ok) throw new Error(`authorize failed ${res.status}`);
  return (await res.json()) as { adminKey: string; url: string };
}

async function main() {
  const { adminKey, url } = await creds();
  const user = new ConvexHttpClient(url);
  const identity: UserIdentityAttributes = {
    tokenIdentifier: 'https://auth.workos.com|provider-switch-agent',
    subject: 'provider-switch-agent',
    issuer: 'https://auth.workos.com',
    name: 'Provider Switch Test',
  };
  // @ts-expect-error runtime method exists; typing lags in convex 1.51
  user.setAdminAuth(adminKey, identity);

  const me = await user.mutation(api.users.getOrCreateMe, {
    displayName: 'Provider Switch Test',
    email: 'provider-switch@test.local',
  });
  const problemId = (await user.mutation(api.problems.create, {
    workspaceId: me.workspaceId,
    title: `Provider switch probe (${phase})`,
    description:
      'Probe exploration for the provider-switch test: confirms fail-closed errors when a provider lacks credentials, and recovery when switched back.',
    desiredOutcome: 'Phase-appropriate terminal status with structured errors.',
    constraints: [],
    domain: 'other',
  })) as string;
  const ex = await user.mutation(api.explorations.start, { problemId, budgetPreset: 'quick' });

  let final: any = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    const st = await user.query(api.explorations.get, { explorationId: ex.explorationId });
    final = st.exploration;
    if (['completed', 'failed', 'cancelled'].includes(final?.status ?? '')) break;
  }

  if (phase === 'expect-fail') {
    const ok = final?.status === 'failed';
    const errs = JSON.stringify(final?.errors ?? []);
    const clear = /API key|provider/i.test(errs);
    console.log(`phase=expect-fail status=${final?.status} errors=${errs.slice(0, 260)}`);
    if (!ok || !clear) {
      console.error('FAIL: expected status=failed with a clear provider/credential error');
      process.exit(1);
    }
    console.log('PASS: misconfigured provider failed closed with a clear error');
  } else {
    console.log(`phase=expect-ok status=${final?.status}`);
    if (final?.status !== 'completed') {
      console.error('FAIL: expected completed exploration after switching back to fake');
      process.exit(1);
    }
    console.log('PASS: switching back to fake recovers end-to-end');
  }
}

main().catch((err) => {
  console.error('provider-switch crashed:', err);
  process.exit(1);
});
