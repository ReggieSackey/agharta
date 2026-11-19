/**
 * MCP server integration test.
 * Spawns the real stdio server binary and drives it through the MCP SDK
 * client (initialize → tools/list → tools/call) against a local mock bridge
 * that mimics the Convex HTTP endpoints.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// --- mock Convex HTTP bridge -------------------------------------------------
const calls: Array<{ op: string; auth: string | null; body: any }> = [];
let bridge: HttpServer;
let bridgePort = 0;

beforeAll(async () => {
  bridge = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const op = req.url?.replace(/^\/mcp\//, '') ?? '';
      calls.push({ op, auth: req.headers.authorization ?? null, body: JSON.parse(body || '{}') });
      res.setHeader('content-type', 'application/json');
      if (op === 'explore_problem') {
        res.end(JSON.stringify({
          problemId: 'prob_1',
          explorationId: 'expl_1',
          status: 'queued',
          dashboardUrl: 'http://localhost:3000/explorations/expl_1',
        }));
      } else if (op === 'get_exploration') {
        res.end(JSON.stringify({
          status: 'completed',
          ideas: [
            {
              id: 'idea_1',
              title: 'Swarm-scheduled microgrids',
              operatorId: 'analogy',
              scores: { originality: 4, usefulness: 3, feasibility: 4 },
              scoreKind: 'automated_proxy',
            },
          ],
        }));
      } else if (op === 'submit_idea_feedback') {
        res.end(JSON.stringify({ ok: true, recorded: true }));
      } else if (op === 'get_learning_summary') {
        res.end(JSON.stringify({
          operators: [
            { operatorId: 'analogy', posteriorMean: 0.62, samples: 40, evidence: 'proxy_only' },
          ],
        }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'unknown op' }));
      }
    });
  });
  await new Promise<void>((resolve) => bridge.listen(0, '127.0.0.1', resolve));
  bridgePort = (bridge.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => bridge.close(() => resolve()));
});

// --- MCP client over stdio ----------------------------------------------------
describe('AGHARTA MCP server (stdio)', () => {
  it('lists all four tools', async () => {
    const client = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['--experimental-strip-types', 'src/index.ts'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGHARTA_CONVEX_HTTP_URL: `http://127.0.0.1:${bridgePort}`,
        AGHARTA_MCP_TOKEN: 'agt_test_token_123456',
      } as Record<string, string>,
    });
    await client.connect(transport);
    try {
      const list = await client.listTools();
      const names = list.tools.map((t) => t.name).sort();
      expect(names).toEqual(['explore_problem', 'get_exploration', 'get_learning_summary', 'submit_idea_feedback']);

      const res = await client.callTool({ name: 'explore_problem', arguments: {
        title: 'Last-mile cold chain for rural vaccines',
        description: 'Vaccines spoil before reaching clinics in hot climates without grid power.',
        outcome: 'Deliver viable vaccines to 100% of clinics within 48h.',
        domain: 'policy',
        budgetPreset: 'quick',
      } });
      const text = (res.content as Array<{ type: string; text: string }>).find((c) => c.type === 'text')?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.explorationId).toBe('expl_1');
      expect(parsed.status).toBe('queued');

      // bridge saw token auth + body
      const exploreCall = calls.find((c) => c.op === 'explore_problem');
      expect(exploreCall?.auth).toBe('Bearer agt_test_token_123456');
      expect(exploreCall?.body.title).toContain('vaccines');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('returns exploration results with evidence labels', async () => {
    const client = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['--experimental-strip-types', 'src/index.ts'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGHARTA_CONVEX_HTTP_URL: `http://127.0.0.1:${bridgePort}`,
        AGHARTA_MCP_TOKEN: 'agt_test_token_123456',
      } as Record<string, string>,
    });
    await client.connect(transport);
    try {
      const res = await client.callTool({ name: 'get_exploration', arguments: { explorationId: 'expl_1' } });
      const text = (res.content as Array<{ type: string; text: string }>).find((c) => c.type === 'text')?.text ?? '';
      const parsed = JSON.parse(text);
      expect(parsed.ideas[0].scoreKind).toBe('automated_proxy');
      expect(parsed.ideas[0].operatorId).toBe('analogy');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('submits feedback through the bridge', async () => {
    const client = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['--experimental-strip-types', 'src/index.ts'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGHARTA_CONVEX_HTTP_URL: `http://127.0.0.1:${bridgePort}`,
        AGHARTA_MCP_TOKEN: 'agt_test_token_123456',
      } as Record<string, string>,
    });
    await client.connect(transport);
    try {
      const res = await client.callTool({ name: 'submit_idea_feedback', arguments: {
        ideaId: 'idea_1',
        action: 'attempted',
        reason: 'Pilot in region B',
        evidence: 'field notes 2026-11',
      } });
      const text = (res.content as Array<{ type: string; text: string }>).find((c) => c.type === 'text')?.text ?? '';
      expect(JSON.parse(text).recorded).toBe(true);
      const fb = calls.find((c) => c.op === 'submit_idea_feedback');
      expect(fb?.body.action).toBe('attempted');
    } finally {
      await client.close();
    }
  }, 30_000);
});
