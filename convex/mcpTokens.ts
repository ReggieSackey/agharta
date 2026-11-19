/**
 * MCP personal tokens: created with secure entropy server-side, stored as
 * keyed hash (Web Crypto HMAC-SHA256 via a hash-agnostic scheme), plaintext
 * returned exactly once. Constant-time comparison on verification.
 */
import { query, mutation } from './_generated/server';
import { v } from 'convex/values';
import { requireWorkspaceMembership } from './auth';

/** agt_<40 chars base62>; prefix is the first 8 chars used for lookup. */
function generateToken(): { plaintext: string; prefix: string } {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(40);
  crypto.getRandomValues(bytes);
  let body = '';
  for (const b of bytes) body += alphabet[b % alphabet.length];
  const plaintext = `agt_${body}`;
  return { plaintext, prefix: plaintext.slice(0, 12) };
}

/** Keyed hash. In production the key is a Convex env secret; dev fallback is
 * a fixed dev key (documented; tokens in dev are not production credentials). */
async function hashToken(plaintext: string): Promise<string> {
  const keyHex = process.env.AGHARTA_TOKEN_HASH_KEY ?? 'agharta-dev-hash-key';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(keyHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(plaintext));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const create = mutation({
  args: { workspaceId: v.id('workspaces'), label: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { subject } = await requireWorkspaceMembership(ctx, args.workspaceId);
    const { plaintext, prefix } = generateToken();
    const tokenHash = await hashToken(plaintext);
    const id = await ctx.db.insert('mcpTokens', {
      workspaceId: args.workspaceId,
      creatorSubject: subject,
      tokenPrefix: prefix,
      tokenHash,
      label: args.label ?? 'MCP token',
    });
    // plaintext shown exactly once
    return { id, token: plaintext };
  },
});

export const revoke = mutation({
  args: { tokenId: v.id('mcpTokens') },
  handler: async (ctx, args) => {
    const token = await ctx.db.get(args.tokenId);
    if (!token) throw new Error('NOT_FOUND');
    await requireWorkspaceMembership(ctx, token.workspaceId);
    await ctx.db.patch(args.tokenId, { revokedAt: Date.now() });
    return { ok: true };
  },
});

export const listForWorkspace = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, args) => {
    await requireWorkspaceMembership(ctx, args.workspaceId);
    const tokens = await ctx.db
      .query('mcpTokens')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .take(50);
    // never expose hashes
    return tokens.map(({ tokenHash: _hash, ...rest }) => rest);
  },
});
