import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';

/**
 * HTTP bridge for the MCP server (and nothing else).
 * Auth model: the local MCP process presents a user-created personal token
 * (`Authorization: Bearer agt_...`). We validate the keyed hash, bind the
 * request to the token's workspace, and invoke internal functions — the MCP
 * client never supplies workspace IDs or admin keys.
 *
 * Fail-closed: dev-only benchmark endpoints require AGHARTA_BENCHMARK_TOKEN
 * and refuse when unset.
 */
const http = httpRouter();

async function hashToken(plaintext: string): Promise<string> {
  const keyHex = process.env.AGHARTA_TOKEN_HASH_KEY ?? 'agharta-dev-hash-key';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(plaintext));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time string compare. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface TokenAuth {
  workspaceId: Id<'workspaces'>;
  tokenId: Id<'mcpTokens'>;
}

async function authenticate(ctx: ActionCtx, request: Request): Promise<TokenAuth | null> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token.startsWith('agt_')) return null;
  const prefix = token.slice(0, 12);
  const candidates = (await ctx.runQuery(internal.internal.mcp.lookupTokenByPrefix, { prefix })) as Array<{
    _id: Id<'mcpTokens'>;
    workspaceId: Id<'workspaces'>;
    tokenHash: string;
    revokedAt?: number;
    expiresAt?: number;
  }>;
  const expected = await hashToken(token);
  const now = Date.now();
  for (const c of candidates) {
    if (c.revokedAt) continue;
    if (c.expiresAt && c.expiresAt < now) continue;
    if (timingSafeEqual(c.tokenHash, expected)) {
      return { workspaceId: c.workspaceId, tokenId: c._id };
    }
  }
  return null;
}

function mcpDashboardUrl(explorationId: string): string {
  const base = process.env.AGHARTA_APP_URL ?? 'http://localhost:3000';
  return `${base}/explorations/${explorationId}`;
}

const unauthorized = () => Response.json({ error: 'unauthorized' }, { status: 401 });

http.route({
  path: '/mcp/explore_problem',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if (!auth) return unauthorized();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const problemId = (await ctx.runMutation(internal.internal.mcp.createProblem, {
      workspaceId: auth.workspaceId,
      title: String(body.title ?? ''),
      description: String(body.description ?? ''),
      desiredOutcome: String(body.outcome ?? body.desiredOutcome ?? ''),
      constraints: Array.isArray(body.constraints) ? body.constraints.map(String) : [],
      domain: String(body.domain ?? 'other'),
    })) as Id<'problems'>;
    const { explorationId } = (await ctx.runMutation(internal.internal.mcp.startExploration, {
      problemId,
      budgetPreset: String(body.budgetPreset ?? 'standard'),
    })) as { explorationId: Id<'explorations'> };
    return Response.json({ problemId, explorationId, status: 'queued', dashboardUrl: mcpDashboardUrl(explorationId) });
  }),
});

http.route({
  path: '/mcp/get_exploration',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if (!auth) return unauthorized();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const explorationId = String(body.explorationId ?? '');
    const result = await ctx.runQuery(internal.internal.mcp.getExplorationForToken, {
      workspaceId: auth.workspaceId,
      explorationId: explorationId as Id<'explorations'>,
    });
    if (!result) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ ...result, dashboardUrl: mcpDashboardUrl(explorationId) });
  }),
});

http.route({
  path: '/mcp/submit_idea_feedback',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if (!auth) return unauthorized();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await ctx.runMutation(internal.internal.mcp.submitFeedback, {
      workspaceId: auth.workspaceId,
      ideaId: String(body.ideaId ?? '') as Id<'ideas'>,
      action: String(body.action ?? ''),
      reason: body.reason ? String(body.reason) : undefined,
      evidence: body.evidence ? String(body.evidence) : undefined,
    });
    return Response.json(result);
  }),
});

http.route({
  path: '/mcp/get_learning_summary',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if (!auth) return unauthorized();
    const result = await ctx.runQuery(internal.internal.mcp.learningSummary, { workspaceId: auth.workspaceId });
    return Response.json(result);
  }),
});

/** Dev-only benchmark bridge (fail-closed without token). */
http.route({
  path: '/dev/benchmark/authorized_check',
  method: 'POST',
  handler: httpAction(async (_ctx, request) => {
    const required = process.env.AGHARTA_BENCHMARK_TOKEN;
    if (!required) {
      return Response.json({ error: 'benchmark bridge disabled (AGHARTA_BENCHMARK_TOKEN unset)' }, { status: 404 });
    }
    const auth = request.headers.get('authorization') ?? '';
    if (!timingSafeEqual(auth, `Bearer ${required}`)) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    return Response.json({ ok: true });
  }),
});

export default http;
