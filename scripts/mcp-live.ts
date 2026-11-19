/**
 * LIVE MCP integration test: real stdio MCP server ↔ real Convex HTTP bridge
 * ↔ real durable exploration (fake model provider on the deployment).
 *
 * Unlike apps/mcp/test (mock bridge), this exercises the full production path
 * a desktop MCP client would use:
 *   1. mint a personal token on the deployment (mcpTokens.create)
 *   2. spawn apps/mcp/src/index.ts as a subprocess with real env
 *   3. MCP client handshake over stdio
 *   4. explore_problem → poll get_exploration → submit_idea_feedback → get_learning_summary
 *   5. negative check: a bad token must be refused by the bridge
 *   6. revoke token; bridge must then refuse
 *
 * Usage: npx tsx scripts/mcp-live.ts
 * Requires: CONVEX_DEPLOYMENT + ~/.convex/config.json (same as test:convex)
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import type { UserIdentityAttributes } from 'convex/server';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const api = anyApi;

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
  const res = await fetch('https://api.convex.dev/api/deployment/authorize_within_current_project', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      selectedDeploymentName: deploymentName,
      projectSelection: { kind: 'teamAndProjectSlugs', teamSlug: TEAM_SLUG, projectSlug: PROJECT_SLUG },
    }),
  });
  if (!res.ok) throw new Error(`authorize failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as { adminKey: string; url: string; siteUrl?: string };
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
}

function parseToolResult(r: unknown): any {
  const res = r as ToolCallResult;
  const text = res.content?.[0]?.text;
  if (!text) throw new Error('tool returned no text content');
  return JSON.parse(text);
}

async function main() {
  const { adminKey, url } = await getDeploymentCredentials();
  // site URL is derived from the cloud URL on convex.site domain
  const siteUrl = url.replace('.convex.cloud', '.convex.site');
  console.log(`MCP live target: ${url} (bridge ${siteUrl})`);

  // --- mint a personal token as the integration user -----------------------
  const admin = new ConvexHttpClient(url);
  admin.setAdminAuth(adminKey);
  const user = new ConvexHttpClient(url);
  const identity: UserIdentityAttributes = {
    tokenIdentifier: 'https://auth.workos.com|mcp-live-test-agent',
    subject: 'mcp-live-test-agent',
    issuer: 'https://auth.workos.com',
    name: 'MCP Live Test',
  };
  user.setAdminAuth(adminKey, identity);

  const me = await user.mutation(api.users.getOrCreateMe, {
    displayName: 'MCP Live Test',
    email: 'mcp-live@test.local',
  });
  const workspaceId = me.workspaceId as string;
  const tokenDoc = (await user.mutation(api.mcpTokens.create, {
    workspaceId,
    label: 'mcp-live-test',
  })) as { id: string; token: string };
  console.log(`minted token ${tokenDoc.token.slice(0, 12)}… for workspace ${workspaceId}`);

  // --- spawn the real MCP server and connect a real client -----------------
  const serverPath = new URL('../apps/mcp/src/index.ts', import.meta.url).pathname;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-strip-types', '--no-warnings', serverPath],
    env: {
      ...process.env,
      AGHARTA_CONVEX_HTTP_URL: siteUrl,
      AGHARTA_MCP_TOKEN: tokenDoc.token,
      AGHARTA_APP_URL: 'http://localhost:3000',
    } as Record<string, string>,
  });
  const client = new Client({ name: 'agharta-live-test', version: '0.1.0' });
  await client.connect(transport);
  console.log('MCP handshake ok');

  const results: string[] = [];
  const check = (name: string, ok: boolean, detail = '') =>
    results.push(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);

  try {
    // tools/list
    const listed = await client.listTools();
    const names = listed.tools.map((t: { name: string }) => t.name).sort();
    check(
      'tools/list has all four tools',
      ['explore_problem', 'get_exploration', 'get_learning_summary', 'submit_idea_feedback'].every((n) =>
        names.includes(n)
      ),
      names.join(', ')
    );

    // explore_problem
    const explore = parseToolResult(
      await client.callTool({
        name: 'explore_problem',
        arguments: {
          title: 'MCP live: incident review follow-up actions decay',
          description:
            'Post-incident action items are agreed but silently expire; recurrence rate unchanged year over year.',
          outcome: 'At least 70% of high-severity action items closed within 60 days.',
          constraints: ['no new tool purchases'],
          domain: 'engineering',
          budgetPreset: 'quick',
        },
      })
    );
    check('explore_problem', !!explore.explorationId && explore.status === 'queued', `status=${explore.status}`);
    const explorationId = explore.explorationId as string;

    // poll get_exploration until terminal
    let ex: any = null;
    for (let i = 0; i < 60; i++) {
      await sleep(1_000);
      ex = parseToolResult(await client.callTool({ name: 'get_exploration', arguments: { explorationId } }));
      if (['completed', 'failed', 'cancelled'].includes(ex?.status)) break;
    }
    check('get_exploration completes', ex?.status === 'completed', `status=${ex?.status}`);
    check('exploration has ideas with provenance', (ex?.ideas?.length ?? 0) > 0, `${ex?.ideas?.length ?? 0} ideas`);
    const first = ex?.ideas?.[0];
    check(
      'idea carries operator provenance + evidence label',
      !!first?.operator && !!first?.evaluation && typeof ex.note === 'string',
      `operator=${first?.operator}, eval=${JSON.stringify(first?.evaluation)}, note="${ex.note?.slice(0, 40)}…"`
    );

    // submit_idea_feedback
    if (first?.id) {
      const fb = parseToolResult(
        await client.callTool({
          name: 'submit_idea_feedback',
          arguments: { ideaId: first.id, action: 'shortlisted', reason: 'mcp live test' },
        })
      );
      check('submit_idea_feedback', fb?.ok === true && fb?.newStatus === 'shortlisted');
    }

    // get_learning_summary (scheduled recompute may lag; rows exist from earlier runs or this one)
    const learn = parseToolResult(await client.callTool({ name: 'get_learning_summary', arguments: {} }));
    check(
      'get_learning_summary returns rows with evidence label',
      Array.isArray(learn) && learn.length >= 0 && (!learn.length || !!learn[0].evidence),
      `${learn.length ?? 0} rows`
    );

    await client.close();
  } finally {
    try {
      await client.close();
    } catch {
      /* already closed */
    }
  }

  // --- negative: forged token must be refused by the bridge -----------------
  const badRes = await fetch(`${siteUrl}/mcp/get_learning_summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer agt_forged00000000' },
    body: '{}',
  });
  check('bridge refuses forged token', badRes.status === 401, `status=${badRes.status}`);

  // --- revoke; bridge must refuse afterwards --------------------------------
  await user.mutation(api.mcpTokens.revoke, { tokenId: tokenDoc.id });
  const revokedRes = await fetch(`${siteUrl}/mcp/get_learning_summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenDoc.token}` },
    body: '{}',
  });
  check('bridge refuses revoked token', revokedRes.status === 401, `status=${revokedRes.status}`);

  console.log('\nMCP live results:');
  for (const r of results) console.log('  ' + r);
  const failed = results.filter((r) => r.startsWith('✖')).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('MCP live test crashed:', err);
  process.exit(1);
});
