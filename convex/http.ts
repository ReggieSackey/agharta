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
  creatorSubject: string;
}

async function clientIp(request: Request): Promise<string> {
  // Convex sites sit behind a proxy; x-forwarded-for is set by the platform.
  const fwd = request.headers.get('x-forwarded-for') ?? '';
  return fwd.split(',')[0]?.trim() || 'unknown';
}

/** Per-IP request budget. Returns a 429 Response when exceeded. */
async function rateLimit(ctx: ActionCtx, request: Request): Promise<Response | null> {
  const ip = await clientIp(request);
  const state = await ctx.runMutation(internal.internal.guard.checkAndConsumeIp, { ip, now: Date.now() });
  if (!state.allowed) {
    await ctx.runMutation(internal.internal.guard.audit, {
      category: 'rate_limited',
      action: 'ip_limit_exceeded',
      detail: JSON.stringify({ ip, retryAfterMs: state.retryAfterMs ?? 0 }),
      ip,
      at: Date.now(),
    });
    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.set('Retry-After', String(Math.max(1, Math.ceil((state.retryAfterMs ?? 60000) / 1000))));
    return new Response(
      JSON.stringify({ error: 'rate limited', retryAfterMs: state.retryAfterMs ?? 0 }),
      { status: 429, headers }
    );
  }
  return null;
}

function mcpDashboardUrl(explorationId: string): string {
  const base = process.env.AGHARTA_APP_URL ?? 'http://localhost:3000';
  return `${base}/explorations/${explorationId}`;
}

async function authenticate(ctx: ActionCtx, request: Request): Promise<TokenAuth | null> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return authenticateToken(ctx, request, token);
}

/** Auth pipeline shared by the header and token-in-URL routes. */
async function authenticateToken(ctx: ActionCtx, request: Request, token: string): Promise<TokenAuth | null> {
  if (!token.startsWith('agt_')) {
    return null;
  }
  const prefix = token.slice(0, 12);
  const now = Date.now();
  // lockout check before doing any hash work
  const lock = await ctx.runQuery(internal.internal.guard.tokenLockStatus, { prefix, now });
  if (lock.locked) {
    return null;
  }
  const candidates = (await ctx.runQuery(internal.internal.mcp.lookupTokenByPrefix, { prefix })) as Array<{
    _id: Id<'mcpTokens'>;
    workspaceId: Id<'workspaces'>;
    tokenHash: string;
    revokedAt?: number;
    expiresAt?: number;
  } & { creatorSubject: string }>;
  const expected = await hashToken(token);
  for (const c of candidates) {
    if (c.revokedAt) continue;
    if (c.expiresAt && c.expiresAt < now) continue;
    if (timingSafeEqual(c.tokenHash, expected)) {
      // success clears failure state
      await ctx.runMutation(internal.internal.guard.clearAuthFailures, { prefix });
      return { workspaceId: c.workspaceId, tokenId: c._id, creatorSubject: c.creatorSubject };
    }
  }
  // failure: count it (may escalate to lockout) + audit
  const ip = await clientIp(request);
  await ctx.runMutation(internal.internal.guard.recordAuthFailure, { prefix, now, ip });
  return null;
}

const unauthorized = () => Response.json({ error: 'unauthorized' }, { status: 401 });

http.route({
  path: '/mcp/explore_problem',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const limited = await rateLimit(ctx, request);
    if (limited) return limited;
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
    const limited = await rateLimit(ctx, request);
    if (limited) return limited;
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
    const limited = await rateLimit(ctx, request);
    if (limited) return limited;
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
    const limited = await rateLimit(ctx, request);
    if (limited) return limited;
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


// ===========================================================================
// V2: Streamable HTTP MCP endpoint (JSON-RPC 2.0, stateless mode)
// for ChatGPT apps / remote MCP clients. Token-authenticated like the REST
// bridge; one POST /mcp route handles initialize / tools/list / tools/call.
// ===========================================================================

const V2_TOOLS = [
  {
    name: 'explore_problem',
    description:
      'Start an Agharta experimental creative search. Engine 1 interprets the problem structurally, forms competing hypotheses (guided/explored/wildcard), investigates cross-domain mechanisms, and returns the 2-3 most novel coherent proposals with the mechanism story. Learning runs asynchronously afterward.',
    inputSchema: {
      type: 'object',
      properties: {
        problem: { type: 'string', description: 'Full problem description, including what was already tried and what conventional approaches to move beyond' },
        domain: { type: 'string', enum: ['product', 'engineering', 'business', 'policy', 'personal', 'other'], description: 'Optional domain hint' },
        budgetPreset: { type: 'string', enum: ['quick', 'standard', 'deep'], description: 'Search budget (default standard)' },
      },
      required: ['problem'],
    },
  },
  {
    name: 'get_exploration',
    description:
      'Fetch an experiment result: status, problem interpretation, hypotheses considered (including rejected paths with reasons), and final proposals with novelty, why they differ, transfer story, and how to explore them.',
    inputSchema: {
      type: 'object',
      properties: { experimentId: { type: 'string' } },
      required: ['experimentId'],
    },
  },
  {
    name: 'submit_idea_feedback',
    description:
      'Submit feedback on a final proposal (shortlisted / rejected / attempted / succeeded / failed). Feeds the human evidence tier of Engine 2 learning. Missing feedback is never counted as failure.',
    inputSchema: {
      type: 'object',
      properties: {
        experimentId: { type: 'string' },
        ideaTitle: { type: 'string', description: 'Title of the final proposal' },
        action: { type: 'string', enum: ['shortlisted', 'rejected', 'attempted', 'succeeded', 'failed'] },
        reason: { type: 'string' },
        evidence: { type: 'string' },
      },
      required: ['experimentId', 'ideaTitle', 'action'],
    },
  },
  {
    name: 'get_learning_summary',
    description:
      'Summary of Engine 2 learning for the workspace: active map/policy versions, learned edge and feature-weight counts, recent learning runs with promotion-gate decisions, and honest caveats.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

function jsonRpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result });
}
function jsonRpcError(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } });
}

http.route({
  path: '/mcp',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const limited = await rateLimit(ctx, request);
    if (limited) return limited;
    const auth = await authenticate(ctx, request);
    if (!auth) return jsonRpcError(null, -32001, 'unauthorized: valid agt_ token required');
    return handleMcpJsonRpc(ctx, request, auth);
  }),
});

// ChatGPT-friendly variant: token embedded in the URL path.
// ChatGPT's custom-connector UI cannot send an Authorization header (only
// OAuth or "No authentication"), so this route accepts the personal token
// as /mcp/k/<token>. Same auth pipeline (lockout, audit, workspace binding);
// the URL is the credential — treat it like the token itself.
http.route({
  pathPrefix: '/mcp/k/',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const limited = await rateLimit(ctx, request);
    if (limited) return limited;
    const token = decodeURIComponent(new URL(request.url).pathname.slice('/mcp/k/'.length).replace(/\/+$/, ''));
    const auth = await authenticateToken(ctx, request, token);
    if (!auth) return jsonRpcError(null, -32001, 'unauthorized: valid agt_ token required');
    return handleMcpJsonRpc(ctx, request, auth);
  }),
});

async function handleMcpJsonRpc(ctx: ActionCtx, request: Request, auth: TokenAuth): Promise<Response> {
    const msg = (await request.json().catch(() => null)) as {
      jsonrpc?: string;
      id?: unknown;
      method?: string;
      params?: Record<string, unknown>;
    } | null;
    if (!msg || typeof msg.method !== 'string') {
      return jsonRpcError(null, -32600, 'invalid request');
    }
    const { method, id, params } = msg;

    if (method === 'initialize') {
      return jsonRpcResult(id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'agharta', version: '2.0.0' },
        instructions:
          'Agharta runs experimental creative searches. Call explore_problem with the full problem (include what was tried); poll get_exploration until completed; results include rejected hypotheses and final proposals with mechanism stories.',
      });
    }
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
      return new Response(null, { status: 202 });
    }
    if (method === 'ping') return jsonRpcResult(id, {});
    if (method === 'tools/list') {
      return jsonRpcResult(id, { tools: V2_TOOLS });
    }
    if (method === 'tools/call') {
      const name = String(params?.name ?? '');
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      if (name === 'explore_problem') {
        const problem = String(args.problem ?? '');
        if (!problem.trim()) return jsonRpcError(id, -32602, 'problem required');
        const started = await ctx.runMutation(internal.internal.mcpV2.startExperiment, {
          workspaceId: auth.workspaceId,
          problemText: problem.slice(0, 8000),
          domain: String(args.domain ?? 'other'),
          budgetPreset: String(args.budgetPreset ?? 'standard'),
          creatorSubject: auth.creatorSubject,
        });
        return jsonRpcResult(id, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              experimentId: started.experimentId,
              status: 'queued',
              message: 'Experiment queued. Poll get_exploration with this experimentId; typical fake/dev runs complete in seconds, real model runs in ~1-3 minutes.',
            }),
          }],
        });
      }
      if (name === 'get_exploration') {
        const experimentId = String(args.experimentId ?? '');
        const result = await ctx.runMutation(internal.internal.mcpV2.getExperiment, {
          workspaceId: auth.workspaceId,
          experimentId: experimentId as Id<'experiments'>,
        });
        if (!result) return jsonRpcError(id, -32002, 'experiment not found in this workspace');
        return jsonRpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
      }
      if (name === 'submit_idea_feedback') {
        const res = await ctx.runMutation(internal.internal.mcpV2.submitFeedbackV2, {
          workspaceId: auth.workspaceId,
          experimentId: String(args.experimentId ?? '') as Id<'experiments'>,
          ideaTitle: String(args.ideaTitle ?? ''),
          action: String(args.action ?? ''),
          reason: args.reason ? String(args.reason) : undefined,
          evidence: args.evidence ? String(args.evidence) : undefined,
        });
        return jsonRpcResult(id, { content: [{ type: 'text', text: JSON.stringify(res) }] });
      }
      if (name === 'get_learning_summary') {
        const result = await ctx.runMutation(internal.internal.mcpV2.learningSummaryV2, {
          workspaceId: auth.workspaceId,
        });
        return jsonRpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
      }
      return jsonRpcError(id, -32601, `unknown tool: ${name}`);
    }
    return jsonRpcError(id, -32601, `method not found: ${method}`);
}

// Lightweight discovery manifest for ChatGPT app registration
// (OpenAI developer dashboard consumes this shape when configuring an MCP app)
http.route({
  path: '/.well-known/mcp-manifest.json',
  method: 'GET',
  handler: httpAction(async (_ctx, _request) => {
    return Response.json({
      name: 'Agharta',
      description: 'Experimental creative search engine: makes AI assistants better at discovering novel approaches to problems.',
      mcp_endpoint: `${process.env.CONVEX_SITE_URL ?? ''}/mcp`,
      auth: { type: 'bearer', docs: 'Personal tokens (agt_...) issued in the Agharta dashboard under Settings → MCP' },
      tools: V2_TOOLS.map((t) => ({ name: t.name, description: t.description })),
    });
  }),
});

export default http;
