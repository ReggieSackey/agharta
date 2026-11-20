'use node';
/**
 * BYOK setCredential action (node runtime for AES-GCM).
 * Auth + workspace resolution + storage happen in the internal mutation the
 * action calls, keeping the plaintext key in memory only for this action.
 * All credential operations are security-audit-logged (no key material).
 */
import { action } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { encryptCredential, keyFingerprint } from './internal/crypto';

export const setCredential = action({
  args: {
    provider: v.string(),
    /** plaintext API key — accepted once, encrypted, never stored raw */
    apiKey: v.string(),
    model: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ updated: boolean }> => {
    // 1. resolve caller's workspace inside an authorized mutation
    const ws = await ctx.runMutation(internal.internal.credentialsAuth.myWorkspace, {});
    // 2. build env bundle in memory
    const env: Record<string, string> = {
      AI_PROVIDER: args.provider,
      [`${args.provider.toUpperCase()}_API_KEY`]: args.apiKey,
    };
    if (args.model) env.AI_MODEL = args.model;
    if (args.baseUrl) env.OPENAI_COMPATIBLE_BASE_URL = args.baseUrl;
    // 3. encrypt with per-workspace derived key + store ciphertext
    const encrypted = encryptCredential(env, ws.workspaceId);
    const result: { updated: boolean } = await ctx.runMutation(
      internal.internal.credentialsStore.storeEncrypted,
      {
        workspaceId: ws.workspaceId,
        provider: args.provider,
        encrypted,
        keyFingerprint: keyFingerprint(),
        label: args.label,
      }
    );
    await ctx.runMutation(internal.internal.guard.audit, {
      workspaceId: ws.workspaceId,
      category: 'credential',
      action: result.updated ? 'credential_replaced' : 'credential_created',
      detail: JSON.stringify({ provider: args.provider, label: args.label ?? null }),
      at: Date.now(),
    });
    return result;
  },
});
