/**
 * Tool definitions shared by the stdio server and tests.
 * All tools call the trusted Convex HTTP bridge with the personal token.
 */
import { z } from 'zod';

export const ExploreProblemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(8000),
  outcome: z.string().min(1).max(2000),
  constraints: z.array(z.string().max(500)).max(20).optional(),
  domain: z.enum(['product', 'engineering', 'business', 'policy', 'personal', 'other']).optional(),
  budgetPreset: z.enum(['quick', 'standard', 'deep']).optional(),
});
export type ExploreProblemInput = z.infer<typeof ExploreProblemSchema>;

export const GetExplorationSchema = z.object({
  explorationId: z.string().min(1),
});
export type GetExplorationInput = z.infer<typeof GetExplorationSchema>;

export const SubmitFeedbackSchema = z.object({
  ideaId: z.string().min(1),
  action: z.enum(['shortlisted', 'rejected', 'attempted', 'succeeded', 'failed']),
  reason: z.string().max(2000).optional(),
  evidence: z.string().max(4000).optional(),
});
export type SubmitFeedbackInput = z.infer<typeof SubmitFeedbackSchema>;

export const GetLearningSummarySchema = z.object({});

export interface BridgeConfig {
  httpUrl: string; // e.g. https://<deployment>.convex.site
  token: string; // agt_...
  appUrl: string; // for dashboard links
}

/** Call a bridge op with token auth. */
export async function callBridge(config: BridgeConfig, op: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${config.httpUrl}/mcp/${op}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`bridge ${op} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

export const TOOL_DEFINITIONS = [
  {
    name: 'explore_problem',
    description:
      'Start an Agharta creative search for a difficult problem. Returns problem/exploration IDs and a dashboard URL. Poll get_exploration for results.',
    inputSchema: ExploreProblemSchema,
  },
  {
    name: 'get_exploration',
    description:
      'Fetch status, usage, and top diverse ideas (with operator provenance and automated proxy scores) for an exploration.',
    inputSchema: GetExplorationSchema,
  },
  {
    name: 'submit_idea_feedback',
    description:
      'Record a real-world outcome for an idea (shortlisted/rejected/attempted/succeeded/failed) with optional reason/evidence. Feeds the learning loop.',
    inputSchema: SubmitFeedbackSchema,
  },
  {
    name: 'get_learning_summary',
    description:
      'Per-workspace operator performance with sample counts and evidence labels (proxy vs outcome).',
    inputSchema: GetLearningSummarySchema,
  },
] as const;
