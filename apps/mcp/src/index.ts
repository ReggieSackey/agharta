#!/usr/bin/env node
/**
 * AGHARTA MCP server (stdio transport, MCP TypeScript SDK v2).
 * Auth: AGHARTA_MCP_TOKEN (personal token from /settings) — never a Convex
 * admin key. Every tool call goes through the trusted Convex HTTP bridge.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { callBridge } from './tools.ts';
import { ExploreProblemSchema, GetExplorationSchema, SubmitFeedbackSchema } from './tools.ts';

const config = {
  httpUrl: process.env.AGHARTA_CONVEX_HTTP_URL ?? '',
  token: process.env.AGHARTA_MCP_TOKEN ?? '',
  appUrl: process.env.AGHARTA_APP_URL ?? 'http://localhost:3000',
};

async function main() {
  if (!config.httpUrl || !config.token) {
    console.error(
      'AGHARTA MCP requires AGHARTA_CONVEX_HTTP_URL and AGHARTA_MCP_TOKEN environment variables.\n' +
        'Generate a personal token at Settings → MCP personal tokens.'
    );
    process.exit(1);
  }

  const server = new McpServer({ name: 'agharta', version: '0.1.0' });

  server.registerTool(
    'explore_problem',
    {
      description:
        'Start an Agharta creative search for a difficult problem. Returns problem/exploration IDs and a dashboard URL. Poll get_exploration for results.',
      inputSchema: ExploreProblemSchema.shape,
    },
    async (input) => {
      const result = await callBridge(config, 'explore_problem', input);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'get_exploration',
    {
      description:
        'Fetch status, usage, and top diverse ideas (with operator provenance and automated proxy scores) for an exploration.',
      inputSchema: GetExplorationSchema.shape,
    },
    async (input) => {
      const result = await callBridge(config, 'get_exploration', input);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'submit_idea_feedback',
    {
      description:
        'Record a real-world outcome for an idea (shortlisted/rejected/attempted/succeeded/failed) with optional reason/evidence. Feeds the learning loop.',
      inputSchema: SubmitFeedbackSchema.shape,
    },
    async (input) => {
      const result = await callBridge(config, 'submit_idea_feedback', input);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    'get_learning_summary',
    {
      description:
        'Per-workspace operator performance with sample counts and evidence labels (proxy vs outcome).',
      inputSchema: {},
    },
    async () => {
      const result = await callBridge(config, 'get_learning_summary', {});
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AGHARTA MCP server running (stdio)');
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
