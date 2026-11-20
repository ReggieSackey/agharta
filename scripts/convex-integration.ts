/**
 * Convex integration test (dev deployment).
 *
 * Exercises the real deployed functions end-to-end:
 *   identity bootstrap → workspace → problem → exploration (fake model) →
 *   ideas + lineage → feedback → learning recompute → MCP token creation.
 *
 * Requires:
 *   - CONVEX_DEPLOYMENT set (via `npx convex dev`) e.g. dev:kindhearted-rook-357
 *   - Convex access token in ~/.convex/config.json (used to mint an admin key)
 *   - AI_PROVIDER=fake on the deployment (deterministic, free runs)
 *
 * Usage: npx tsx scripts/convex-integration.ts
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import type { UserIdentityAttributes, FunctionReference } from 'convex/server';

const api = anyApi as any;

// Your Convex team/project slugs (dashboard URL shows them):
//   https://dashboard.convex.dev/<teamSlug>/<projectSlug>
// Set via environment or .env.local (gitignored):
const TEAM_SLUG = process.env.CONVEX_TEAM_SLUG ?? '';
const PROJECT_SLUG = process.env.CONVEX_PROJECT_SLUG ?? '';
if (!TEAM_SLUG || !PROJECT_SLUG) {
  throw new Error('Set CONVEX_TEAM_SLUG and CONVEX_PROJECT_SLUG (from your Convex dashboard URL) — e.g. in .env.local');
}

async function getDeploymentCredentials() {
  const deploymentRef = process.env.CONVEX_DEPLOYMENT ?? '';
  if (!deploymentRef) throw new Error('CONVEX_DEPLOYMENT not set — run `npx convex dev` first');
  const deploymentName = deploymentRef.split(':')[1] ?? deploymentRef;
  const accessToken = JSON.parse(readFileSync(`${homedir()}/.convex/config.json`, 'utf8')).accessToken;

  // control-plane: authorize against the dev deployment, receive admin key + url
  const res = await fetch('https://api.convex.dev/api/deployment/authorize_within_current_project', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      selectedDeploymentName: deploymentName,
      projectSelection: { kind: 'teamAndProjectSlugs', teamSlug: TEAM_SLUG, projectSlug: PROJECT_SLUG },
    }),
  });
  if (!res.ok) throw new Error(`authorize failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { adminKey: string; url: string; deploymentName: string };
  return data;
}

interface Results {
  pass: number;
  fail: number;
}

async function main() {
  const { adminKey, url, deploymentName } = await getDeploymentCredentials();
  console.log(`integration target: ${deploymentName} (${url})`);

  const admin = new ConvexHttpClient(url);
  // @ts-expect-error runtime method exists; typing lags in convex 1.51
  admin.setAdminAuth(adminKey);

  // admin-key-authenticated client acting as a fake AuthKit user identity
  const identity: UserIdentityAttributes = {
    tokenIdentifier: 'https://auth.workos.com|integration-test-agent',
    subject: 'integration-test-agent',
    issuer: 'https://auth.workos.com',
    name: 'Integration Test',
  };
  const user = new ConvexHttpClient(url);
  // @ts-expect-error runtime method exists; typing lags in convex 1.51
  user.setAdminAuth(adminKey, identity);

  const results: string[] = [];
  const check = (name: string, ok: boolean, detail?: string) => {
    results.push(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // 1. user bootstrap (users.getOrCreateMe creates user + default workspace)
  const me = await user.mutation(api.users.getOrCreateMe, {
    displayName: 'Integration Test',
    email: 'integration@test.local',
  });
  check('users.getOrCreateMe', !!me?.userId && !!me?.workspaceId);

  const workspaceId = me.workspaceId as string;

  // 2. problem creation
  const problemId = (await user.mutation(api.problems.create, {
    workspaceId,
    title: 'Integration: urban heat island mitigation',
    description: 'Dense districts are 5°C hotter; need interventions deployable within one budget cycle.',
    desiredOutcome: 'Reduce peak ambient temperature by 2°C at district scale within 18 months.',
    constraints: ['no new towers', 'existing budget cycle'],
    domain: 'policy',
  })) as string;
  check('problems.create', !!problemId);

  // 3. exploration start (quick preset; fake model configured on deployment)
  const ex = await user.mutation(api.explorations.start, {
    problemId,
    budgetPreset: 'quick',
  });
  check('explorations.start (queued)', !!ex?.explorationId && ex.status === 'queued');

  // 4. poll durable action to completion
  let exploration: any = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    exploration = await user.query(api.explorations.get, { explorationId: ex.explorationId });
    if (['completed', 'failed', 'cancelled'].includes(exploration?.exploration?.status ?? '')) break;
  }
  const status = exploration?.exploration?.status;
  const ideaCount = exploration?.ideas?.length ?? 0;
  check('exploration completes', status === 'completed', `status=${status}`);
  check('ideas generated', ideaCount > 0, `${ideaCount} ideas`);
  if (exploration?.exploration?.errors?.length) {
    console.log('  exploration errors:', exploration.exploration.errors);
  }

  // 5. idea detail + lineage
  if (ideaCount > 0) {
    const first = exploration.ideas[0];
    const detail = await user.query(api.ideas.getWithLineage, { ideaId: first.id });
    check('ideas.getWithLineage', !!detail?.idea && Array.isArray(detail?.ancestors));
  }

  // 6. feedback → learning recompute
  if (ideaCount > 0) {
    const fb = await user.mutation(api.feedback.submit, {
      ideaId: exploration.ideas[0].id,
      action: 'shortlisted',
      reason: 'integration test',
    });
    check('feedback.submit', fb !== undefined, JSON.stringify(fb).slice(0, 60));
  }
  const learn = await admin.action(api.internal.learning.recomputeOperatorStats, {
    workspaceId,
  });
  check('learning.recomputeOperatorStats', (learn?.rowsWritten ?? 0) > 0, `${learn?.rowsWritten ?? 0} rows`);

  // 7. MCP token create + revoke round-trip
  const token = await user.mutation(api.mcpTokens.create, { workspaceId, label: 'integration' });
  check('mcpTokens.create', typeof token?.token === 'string' && token.token.startsWith('agt_'));
  const revoked = await user.mutation(api.mcpTokens.revoke, { tokenId: token.id });
  check('mcpTokens.revoke', revoked !== undefined);

  // 8. authorization negative test: foreign identity must be rejected
  const intruder = new ConvexHttpClient(url);
  // @ts-expect-error runtime method exists; typing lags in convex 1.51
  intruder.setAdminAuth(adminKey, {
    tokenIdentifier: 'https://auth.workos.com|intruder',
    subject: 'intruder',
    issuer: 'https://auth.workos.com',
  } as UserIdentityAttributes);
  let denied = false;
  try {
    await intruder.query(api.explorations.get, { explorationId: ex.explorationId });
  } catch {
    denied = true;
  }
  check('workspace isolation (intruder denied)', denied);

  // 9. learning loop: feedback → recompute → subsequent exploration carries
  //    learned allocation weights (the within-workspace self-improvement path)
  if (ideaCount > 0) {
    // submit outcome feedback on several ideas to move the counters
    const actions = ['succeeded', 'succeeded', 'failed', 'shortlisted'] as const;
    for (let i = 0; i < Math.min(actions.length, exploration.ideas.length); i++) {
      await user.mutation(api.feedback.submit, {
        ideaId: exploration.ideas[i].id,
        action: actions[i],
        reason: 'integration learning-loop probe',
      });
    }
    await admin.action(api.internal.learning.recomputeOperatorStats, { workspaceId });
    const problem2 = (await user.mutation(api.problems.create, {
      workspaceId,
      title: 'Integration: allocation feedback probe',
      description: 'Second problem used to observe learned operator weights influencing a new run.',
      desiredOutcome: 'Observe allocation propagation.',
      constraints: [],
      domain: 'other',
    })) as string;
    const ex2 = await user.mutation(api.explorations.start, { problemId: problem2, budgetPreset: 'quick' });
    let ex2doc: any = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      ex2doc = await user.query(api.explorations.get, { explorationId: ex2.explorationId });
      if (['completed', 'failed', 'cancelled'].includes(ex2doc?.exploration?.status ?? '')) break;
    }
    const applied = ex2doc?.exploration?.appliedAllocationWeights;
    check(
      'learned allocation weights applied to subsequent exploration',
      !!applied && Object.keys(applied).length === 4,
      applied ? JSON.stringify(applied) : 'none'
    );
    const effective = ex2doc?.exploration?.effectiveStrategy;
    check('effective strategy snapshotted on exploration', !!effective?.operatorWeights);
  }

  console.log('\nConvex integration results:');
  for (const r of results) console.log('  ' + r);
  const failed = results.filter((r) => r.startsWith('✖')).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('integration test crashed:', err);
  process.exit(1);
});
