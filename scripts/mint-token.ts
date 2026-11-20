/**
 * Mint a personal MCP token for the repo owner (admin auth, same as the
 * dashboard flow) and print the ready-to-paste ChatGPT connector URLs.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import type { UserIdentityAttributes } from 'convex/server';

const api = anyApi as any;
const deploymentRef = process.env.CONVEX_DEPLOYMENT ?? '';
if (!deploymentRef) throw new Error('CONVEX_DEPLOYMENT not set');

async function main() {
  const deploymentName = deploymentRef.split(':')[1] ?? deploymentRef;
  const accessToken = JSON.parse(readFileSync(`${homedir()}/.convex/config.json`, 'utf8')).accessToken;
  const res = await fetch('https://api.convex.dev/api/deployment/authorize_within_current_project', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
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
  const { adminKey, url } = (await res.json()) as { adminKey: string; url: string };
  const siteUrl = url.replace('convex.cloud', 'convex.site');

  const user = new ConvexHttpClient(url);
  const identity: UserIdentityAttributes = {
    tokenIdentifier: 'https://auth.workos.com|reggie-owner',
    subject: 'reggie-owner',
    issuer: 'https://auth.workos.com',
    name: 'Reggie (owner)',
  };
  // @ts-expect-error runtime method exists; typing lags in convex 1.51
  user.setAdminAuth(adminKey, identity);
  const me = await user.mutation(api.users.getOrCreateMe, {
    displayName: 'Reggie (owner)',
    email: 'reggie@agharta.local',
  });
  const minted = await user.mutation(api.mcpTokens.create, {
    workspaceId: me.workspaceId,
    label: 'ChatGPT connector (reggie)',
  });
  const token: string = minted.token;

  console.log('WORKSPACE:', me.workspaceId);
  console.log('TOKEN (treat like a password):', token);
  console.log('');
  console.log('ChatGPT connector URL (paste as Server URL, auth = No authentication):');
  console.log(`  ${siteUrl}/mcp/k/${token}`);
  console.log('');
  console.log('Header-style clients (Cursor etc):');
  console.log(`  URL:  ${siteUrl}/mcp`);
  console.log('  Header: Authorization: Bearer ' + token);
  console.log('');
  console.log('Dashboard: sign in with the "reggie-owner" identity, workspace', me.workspaceId);
}
main().catch((e) => { console.error(e); process.exit(1); });
