/**
 * LIVE BYOK test: set credential (fake provider key), verify ciphertext-only
 * storage, run an experiment that resolves through BYOK, delete credential.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import type { UserIdentityAttributes } from 'convex/server';

const api = anyApi as any;
const results: string[] = [];
const check = (name: string, ok: boolean, detail = '') =>
  results.push(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);

async function main() {
  const deploymentRef = process.env.CONVEX_DEPLOYMENT ?? '';
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
  const { adminKey, url } = (await res.json()) as { adminKey: string; url: string };
  const user = new ConvexHttpClient(url);
  const identity: UserIdentityAttributes = {
    tokenIdentifier: 'https://auth.workos.com|byok-live-agent',
    subject: 'byok-live-agent',
    issuer: 'https://auth.workos.com',
    name: 'BYOK Live Test',
  };
  // @ts-expect-error runtime method exists; typing lags in convex 1.51
  user.setAdminAuth(adminKey, identity);
  const me = await user.mutation(api.users.getOrCreateMe, {
    displayName: 'BYOK Live Test',
    email: 'byok@test.local',
  });

  // 1. set a credential (fake provider — key material is dummy)
  const DUMMY_KEY = 'sk-byok-test-dummy-key-DO-NOT-USE';
  const set1 = await user.action(api.credentials.setCredential, {
    provider: 'fake',
    apiKey: DUMMY_KEY,
    label: 'byok-live-test',
  });
  check('setCredential accepted', set1?.updated === false || set1?.updated === true, JSON.stringify(set1));

  // 2. metadata listing NEVER contains the key
  const listed: any = await user.query(api.credentialsManage.listCredentials, {});
  const flat = JSON.stringify(listed);
  check('list returns metadata only (no key material)', !flat.includes(DUMMY_KEY) && !flat.includes('apiKey'));
  check('listing shows the fake provider entry', Array.isArray(listed) && listed.some((c: any) => c.provider === 'fake' && c.hasKey));

  // 3. experiment resolves through BYOK (fake provider path)
  const ex = await user.mutation(api.experiments.start, {
    problemText: 'Independent bookstore: online sales cannibalize in-store events, but events are the brand. Reconcile without killing either. Move beyond "do both better".',
    domain: 'business',
    budgetPreset: 'quick',
    title: 'Bookstore channel conflict',
  });
  let rec: any = null;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const st = await user.query(api.experiments.get, { experimentId: ex.experimentId });
    if (st?.status === 'completed' || st?.status === 'failed') { rec = st; break; }
  }
  check('experiment ran with BYOK credential present', rec?.status === 'completed', rec?.status ?? 'timeout');

  // 4. delete credential
  const del = await user.mutation(api.credentialsManage.deleteCredential, { provider: 'fake' });
  check('deleteCredential', del?.deleted === true, JSON.stringify(del));
  const listed2: any = await user.query(api.credentialsManage.listCredentials, {});
  check('credential gone after delete', !listed2.some((c: any) => c.provider === 'fake'));

  // 5. after deletion, experiments still work via env/fake fallback
  const ex2 = await user.mutation(api.experiments.start, {
    problemText: 'City swim lessons have 2-year waitlists; poor kids lose. Beyond building more pools.',
    domain: 'policy',
    budgetPreset: 'quick',
    title: 'Swim lesson scarcity',
  });
  let rec2: any = null;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const st = await user.query(api.experiments.get, { experimentId: ex2.experimentId });
    if (st?.status === 'completed' || st?.status === 'failed') { rec2 = st; break; }
  }
  check('experiment works after credential deletion (fallback)', rec2?.status === 'completed', rec2?.status ?? 'timeout');

  void me;
  console.log('\n=== BYOK LIVE RESULTS ===');
  for (const r of results) console.log(r);
  const failed = results.filter((r) => r.startsWith('✖')).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
