/**
 * Inspect V2 learning-run state on the live deployment (read-only).
 * Same auth path as the other live scripts.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import type { UserIdentityAttributes } from 'convex/server';

const api = anyApi as any;

async function main() {
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
        teamSlug: process.env.CONVEX_TEAM_SLUG ?? '',
        projectSlug: process.env.CONVEX_PROJECT_SLUG ?? '',
      },
    }),
  });
  if (!res.ok) throw new Error(`authorize failed ${res.status}`);
  const { adminKey, url } = (await res.json()) as { adminKey: string; url: string };
  const client = new ConvexHttpClient(url);
  const identity: UserIdentityAttributes = {
    tokenIdentifier: 'https://auth.workos.com|v2-loop-live-agent',
    subject: 'v2-loop-live-agent',
    issuer: 'https://auth.workos.com',
  };
  // @ts-expect-error runtime method exists; typing lags in convex 1.51
  client.setAdminAuth(adminKey, identity);

  const me = await client.mutation(api.users.getOrCreateMe, { displayName: 'V2 Loop Live Test', email: 'v2-loop@test.local' });
  const active = await client.query(api.experiments.activeArtifacts, {});
  const runs = active.recentLearningRuns ?? [];
  console.log('learning runs visible:', runs.length);
  for (const r of runs.slice(0, 3)) {
    console.log('--- run', r._id, r.status);
    console.log('   candidatePolicy:', r.candidatePolicyVersionId);
    const ev = r.evaluation;
    if (ev) {
      console.log('   champion mean novelty:', ev.championMetrics?.meanNovelty?.toFixed(3));
      console.log('   challenger mean novelty:', ev.challengerMetrics?.meanNovelty?.toFixed(3));
      console.log('   P(challenger>better):', ev.challengerBetterProb);
      console.log('   passed:', ev.passed, '— reasons:', ev.reasons);
    } else {
      console.log('   error:', r.error);
    }
  }
  void me;
}
main().catch((e) => { console.error(e); process.exit(1); });
