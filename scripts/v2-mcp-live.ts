/**
 * LIVE remote-MCP test: JSON-RPC conversation with the deployed /mcp
 * Streamable HTTP endpoint — initialize → tools/list → tools/call
 * (explore_problem → get_exploration poll → submit_idea_feedback →
 * get_learning_summary), using a real minted token.
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
  const siteUrl = process.env.CONVEX_SITE_URL ?? url.replace('convex.cloud', 'convex.site');
  const mcpUrl = `${siteUrl}/mcp`;
  console.log('remote MCP target:', mcpUrl);

  // --- mint a token via admin (same as dashboard flow) ---
  const user = new ConvexHttpClient(url);
  const identity: UserIdentityAttributes = {
    tokenIdentifier: 'https://auth.workos.com|mcpv2-live-agent',
    subject: 'mcpv2-live-agent',
    issuer: 'https://auth.workos.com',
    name: 'MCP V2 Live Test',
  };
  // @ts-expect-error runtime method exists; typing lags in convex 1.51
  user.setAdminAuth(adminKey, identity);
  const me = await user.mutation(api.users.getOrCreateMe, {
    displayName: 'MCP V2 Live Test',
    email: 'mcpv2@test.local',
  });
  const minted = await user.mutation(api.mcpTokens.create, { workspaceId: me.workspaceId, label: 'v2-mcp-live-test' });
  const token: string = minted.token;
  check('token minted', token.startsWith('agt_'));

  const rpc = async (method: string, params?: Record<string, unknown>, id: number | string = 1) => {
    const r = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    if (!r.ok) throw new Error(`${method} HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()) as { result?: any; error?: any };
  };

  // unauthorized must fail
  const anon: any = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize' }),
  });
  check('unauthenticated rejected', anon.status === 401 || (await anon.json())?.error?.code === -32001);

  // initialize
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'live-test', version: '0' } });
  check('initialize', init.result?.serverInfo?.name === 'agharta', init.result?.serverInfo?.name);

  // tools/list
  const tools = await rpc('tools/list');
  const toolNames = (tools.result?.tools ?? []).map((t: any) => t.name);
  check(
    'tools/list has 4 v2 tools',
    ['explore_problem', 'get_exploration', 'submit_idea_feedback', 'get_learning_summary'].every((n) => toolNames.includes(n)),
    toolNames.join(',')
  );

  // explore_problem
  const start = await rpc('tools/call', {
    name: 'explore_problem',
    arguments: {
      problem: 'A community bike-repair co-op has 40% no-show rate for volunteer shifts; morale is collapsing. Conventional reminders and scheduling apps failed. Need structurally different approaches.',
      domain: 'policy',
      budgetPreset: 'quick',
    },
  }, 2);
  const startPayload = JSON.parse(start.result?.content?.[0]?.text ?? '{}');
  const experimentId = startPayload.experimentId;
  check('explore_problem returns experimentId', !!experimentId);

  // poll get_exploration
  let finalPayload: any = null;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const poll = await rpc('tools/call', { name: 'get_exploration', arguments: { experimentId } }, 3);
    const payload = JSON.parse(poll.result?.content?.[0]?.text ?? '{}');
    if (payload.status === 'completed' || payload.status === 'failed') { finalPayload = payload; break; }
  }
  check('experiment completed via MCP', finalPayload?.status === 'completed', finalPayload?.status ?? 'timeout');
  check('result includes hypotheses (readable)', Array.isArray(finalPayload?.hypothesesConsidered) && finalPayload.hypothesesConsidered.length === 6);
  check('result includes final proposals', [2,3].includes(finalPayload?.finalProposals?.length), String(finalPayload?.finalProposals?.length));

  // submit feedback on the first final proposal
  const title = finalPayload?.finalProposals?.[0]?.title;
  if (title) {
    const fb = await rpc('tools/call', {
      name: 'submit_idea_feedback',
      arguments: { experimentId, ideaTitle: title, action: 'shortlisted', reason: 'live test' },
    }, 4);
    const fbPayload = JSON.parse(fb.result?.content?.[0]?.text ?? '{}');
    check('feedback accepted', fbPayload.ok === true, JSON.stringify(fbPayload).slice(0, 80));
  } else {
    check('feedback accepted', false, 'no final proposal title');
  }

  // learning summary
  const ls = await rpc('tools/call', { name: 'get_learning_summary', arguments: {} }, 5);
  const lsPayload = JSON.parse(ls.result?.content?.[0]?.text ?? '{}');
  check('learning summary readable', !!lsPayload?.activePolicy || lsPayload?.recentLearningRuns !== undefined);

  // manifest route
  const manifest: any = await fetch(`${siteUrl}/.well-known/mcp-manifest.json`);
  const manifestJson: any = await manifest.json();
  check('manifest served', manifestJson?.name === 'Agharta' && Array.isArray(manifestJson?.tools));

  void me;
  console.log('\\n=== REMOTE MCP LIVE RESULTS ===');
  for (const r of results) console.log(r);
  const failed = results.filter((r) => r.startsWith('✖')).length;
  console.log(`\\n${results.length - failed}/${results.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
