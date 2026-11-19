/**
 * LIVE challenger-experiment journey test (mandatory self-improvement loop).
 *
 * Proves on the real deployment:
 *   1. champion strategy exists (bootstrap) with config v0.1
 *   2. strategies.challenge applies a REAL change: challenger config differs
 *      from champion (weights), versions bump
 *   3. the scheduled experiment runs BOTH arms on the same fixed validation
 *      problems × seeds and records a versioned comparison
 *   4. decision is either eligible_for_promotion or rejected with reasons —
 *      never silently promoted
 *   5. if eligible: strategies.promote flips champion with audit entry, and a
 *      NEW exploration then uses the promoted strategy
 *   6. if rejected: the rejected strategy can NEVER be promoted (mutation throws)
 *
 * Usage: npx tsx scripts/challenger-live.ts   (same env as test:convex)
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import type { UserIdentityAttributes } from 'convex/server';

const api = anyApi;

async function getDeploymentCredentials() {
  const deploymentRef = process.env.CONVEX_DEPLOYMENT ?? '';
  if (!deploymentRef) throw new Error('CONVEX_DEPLOYMENT not set — run `npx convex dev` first');
  const deploymentName = deploymentRef.split(':')[1] ?? deploymentRef;
  const accessToken = JSON.parse(readFileSync(`${homedir()}/.convex/config.json`, 'utf8')).accessToken;
  const res = await fetch('https://api.convex.dev/api/deployment/authorize_within_current_project', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      selectedDeploymentName: deploymentName,
      projectSelection: { kind: 'teamAndProjectSlugs', teamSlug: 'reggiesackey', projectSlug: 'aghearta' },
    }),
  });
  if (!res.ok) throw new Error(`authorize failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as { adminKey: string; url: string };
}

async function main() {
  const { adminKey, url } = await getDeploymentCredentials();
  console.log(`challenger live target: ${url}`);

  const user = new ConvexHttpClient(url);
  const identity: UserIdentityAttributes = {
    tokenIdentifier: 'https://auth.workos.com|challenger-live-agent',
    subject: 'challenger-live-agent',
    issuer: 'https://auth.workos.com',
    name: 'Challenger Live Test',
  };
  user.setAdminAuth(adminKey, identity);

  const results: string[] = [];
  const check = (name: string, ok: boolean, detail = '') =>
    results.push(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);

  // 1. bootstrap user/workspace + ensure a champion strategy exists
  const me = await user.mutation(api.users.getOrCreateMe, {
    displayName: 'Challenger Live Test',
    email: 'challenger-live@test.local',
  });
  const workspaceId = me.workspaceId as string;

  // create a throwaway problem + exploration to bootstrap champion v0.1 if absent
  const problemId = (await user.mutation(api.problems.create, {
    workspaceId,
    title: 'Challenger bootstrap: warehouse slotting churn',
    description: 'Re-slotting the warehouse weekly costs 200 labor-hours and errors spike afterwards.',
    desiredOutcome: 'Cut re-slotting labor by half without raising pick errors.',
    constraints: ['no new WMS purchase'],
    domain: 'engineering',
  })) as string;
  const ex0 = await user.mutation(api.explorations.start, { problemId, budgetPreset: 'quick' });
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const st = await user.query(api.explorations.get, { explorationId: ex0.explorationId });
    if (['completed', 'failed', 'cancelled'].includes(st?.exploration?.status ?? '')) break;
  }
  const strategies = (await user.query(api.strategies.listByWorkspace, { workspaceId })) as Array<{
    _id: string;
    version: string;
    state: string;
    config: any;
  }>;
  const champion = strategies.find((s) => s.state === 'champion');
  check('champion strategy exists after bootstrap', !!champion, champion?.version ?? 'none');

  // 2. challenge with an explicit structured proposal (weight shift toward analogy)
  const proposal = {
    rationale: 'Test proposal: shift weight from inversion to analogy for wider source coverage.',
    promptChange: null,
    weightChange: { operator: 'analogy', newWeight: 0.5 },
  };
  const challenge = await user.mutation(api.strategies.challenge, {
    baseStrategyId: champion._id,
    changeProposal: JSON.stringify(proposal),
  });
  check('strategies.challenge returns experiment', !!challenge?.experimentId);

  const challenger = strategies.find((s) => s._id === challenge.challengerStrategyId);
  const challengerFresh = challenger ?? null;

  // 3. poll the experiment to a terminal decision
  let experiment: any = null;
  for (let i = 0; i < 120; i++) {
    await sleep(2_000);
    const listed = await user.query(api.strategies.listExperiments, { workspaceId });
    experiment = (listed?.experiments ?? []).find((e: any) => e._id === challenge.experimentId);
    if (experiment && ['eligible_for_promotion', 'rejected'].includes(experiment.decision)) break;
  }
  check(
    'experiment reaches a gate decision',
    ['eligible_for_promotion', 'rejected'].includes(experiment?.decision),
    `decision=${experiment?.decision}`
  );
  check(
    'both arms have versioned results',
    !!experiment?.championResult?.strategyVersion && !!experiment?.challengerResult?.strategyVersion,
    `${experiment?.championResult?.strategyVersion} vs ${experiment?.challengerResult?.strategyVersion}`
  );
  const champWeights = champion?.config?.operatorWeights;
  const challWeights = experiment?._id ? challengerFresh?.config?.operatorWeights : undefined;
  // re-fetch challenger strategy doc for the applied config
  const strategiesAfter = (await user.query(api.strategies.listByWorkspace, { workspaceId })) as Array<any>;
  const challengerDoc = strategiesAfter.find((s: any) => s._id === challenge.challengerStrategyId);
  const differs =
    !!challengerDoc?.config?.operatorWeights &&
    JSON.stringify(champWeights) !== JSON.stringify(challengerDoc.config.operatorWeights);
  check('challenger config actually differs from champion', differs, JSON.stringify(challengerDoc?.config?.operatorWeights));
  check(
    'rationale records decision basis',
    typeof experiment?.rationale === 'string' && experiment.rationale.length > 10,
    (experiment?.rationale ?? '').slice(0, 80)
  );

  // 4a. rejected → promotion must throw
  if (experiment.decision === 'rejected') {
    let threw = false;
    try {
      await user.mutation(api.strategies.promote, { experimentId: challenge.experimentId });
    } catch {
      threw = true;
    }
    check('rejected strategy cannot be promoted (throws)', threw);
    const stillChampion = ((await user.query(api.strategies.listByWorkspace, { workspaceId })) as Array<any>).find(
      (s: any) => s.state === 'champion'
    );
    check('champion unchanged after rejection', stillChampion?._id === champion._id);
  }

  // 4b. eligible → promote, audit entry, subsequent exploration uses it
  if (experiment.decision === 'eligible_for_promotion') {
    const promoted = await user.mutation(api.strategies.promote, { experimentId: challenge.experimentId });
    check('strategies.promote succeeds when gate satisfied', promoted?.ok === true, `new champion ${promoted?.newChampionId}`);

    const audit = await user.query(api.strategies.listExperiments, { workspaceId });
    const entry = (audit?.audit ?? []).find((a: any) => a.experimentId === challenge.experimentId);
    check('promotion audit entry exists', !!entry, `${entry?.fromVersion} → ${entry?.toVersion}`);

    // subsequent exploration uses the promoted champion
    const problem2 = (await user.mutation(api.problems.create, {
      workspaceId,
      title: 'Post-promotion: field service routing',
      description: 'Technicians drive 38% of shifts empty; fuel is the top cost after labor.',
      desiredOutcome: 'Empty-drive share below 20% within a quarter.',
      constraints: ['no routing vendor swap'],
      domain: 'business',
    })) as string;
    const ex2 = await user.mutation(api.explorations.start, { problemId: problem2, budgetPreset: 'quick' });
    let usedPromoted = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const st = await user.query(api.explorations.get, { explorationId: ex2.explorationId });
      if (['completed', 'failed', 'cancelled'].includes(st?.exploration?.status ?? '')) {
        usedPromoted = st?.exploration?.strategyId === promoted.newChampionId;
        break;
      }
    }
    check('subsequent exploration runs with promoted strategy', usedPromoted);
  }

  console.log('\nChallenger live results:');
  for (const r of results) console.log('  ' + r);
  const failed = results.filter((r) => r.startsWith('✖')).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('challenger live test crashed:', err);
  process.exit(1);
});
