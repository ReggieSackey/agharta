/**
 * HTTP security guard internals: per-IP rate limiting, per-token-prefix
 * failure counting with automatic lockout, and a security audit log.
 *
 * Convex has no native rate limiting; this is the documented component-based
 * approach (counters in a table, checked/written inside a mutation so each
 * request is atomic). Bounded memory: counters expire and reset.
 *
 * Policy:
 *   - per-IP: 60 requests / 10 min sliding-ish window (fixed window reset)
 *   - per-token-prefix auth failure: 5 failures → 15 min lockout
 *   - every auth denial + credential/rollback op is audit-logged
 */
import { internalMutation, internalQuery, query, mutation } from '../_generated/server';
import { v } from 'convex/values';

export const IP_WINDOW_MS = 10 * 60 * 1000;
export const IP_MAX_REQUESTS = 60;
export const TOKEN_MAX_FAILURES = 5;
export const TOKEN_LOCKOUT_MS = 15 * 60 * 1000;

/** Called at the start of every HTTP request. Throws-free: returns state. */
export const checkAndConsumeIp = internalMutation({
  args: { ip: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const bucket = `ip:${args.ip}`;
    const row = await ctx.db.query('authAttempts').withIndex('by_bucket', (q) => q.eq('bucket', bucket)).unique();
    if (!row) {
      await ctx.db.insert('authAttempts', {
        bucket, failures: 0, firstFailureAt: args.now, lastFailureAt: args.now,
      });
      return { allowed: true, remaining: IP_MAX_REQUESTS - 1 };
    }
    // window expired → reset
    if (args.now - row.firstFailureAt > IP_WINDOW_MS) {
      await ctx.db.patch(row._id, { failures: 0, firstFailureAt: args.now, lastFailureAt: args.now });
      return { allowed: true, remaining: IP_MAX_REQUESTS - 1 };
    }
    if (row.failures >= IP_MAX_REQUESTS) {
      return { allowed: false, remaining: 0, retryAfterMs: IP_WINDOW_MS - (args.now - row.firstFailureAt) };
    }
    await ctx.db.patch(row._id, { failures: row.failures + 1, lastFailureAt: args.now });
    return { allowed: true, remaining: IP_MAX_REQUESTS - row.failures - 1 };
  },
});

/** Is this token prefix locked out? (called BEFORE hashing work) */
export const tokenLockStatus = internalQuery({
  args: { prefix: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const bucket = `tok:${args.prefix}`;
    const row = await ctx.db.query('authAttempts').withIndex('by_bucket', (q) => q.eq('bucket', bucket)).unique();
    if (!row || !row.lockedUntil || row.lockedUntil < args.now) {
      return { locked: false as const };
    }
    return { locked: true as const, until: row.lockedUntil };
  },
});

/** Record an auth failure for a token prefix; escalates to lockout. */
export const recordAuthFailure = internalMutation({
  args: { prefix: v.string(), now: v.number(), ip: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const bucket = `tok:${args.prefix}`;
    const row = await ctx.db.query('authAttempts').withIndex('by_bucket', (q) => q.eq('bucket', bucket)).unique();
    const failures = (row?.failures ?? 0) + 1;
    const lockedUntil = failures >= TOKEN_MAX_FAILURES ? args.now + TOKEN_LOCKOUT_MS : row?.lockedUntil;
    if (!row) {
      await ctx.db.insert('authAttempts', {
        bucket, failures, firstFailureAt: args.now, lastFailureAt: args.now,
        ...(lockedUntil ? { lockedUntil } : {}),
      });
    } else {
      await ctx.db.patch(row._id, { failures, lastFailureAt: args.now, ...(lockedUntil !== undefined ? { lockedUntil } : {}) });
    }
    await ctx.db.insert('securityAudit', {
      category: 'auth_denied',
      action: 'token_auth_failed',
      detail: JSON.stringify({ prefix: args.prefix, failures, ...(lockedUntil ? { lockedUntil } : {}) }),
      ...(args.ip ? { ip: args.ip } : {}),
      at: args.now,
    });
    return { failures, lockedUntil: lockedUntil ?? null };
  },
});

/** Clear failure state after a successful auth (token verified). */
export const clearAuthFailures = internalMutation({
  args: { prefix: v.string() },
  handler: async (ctx, args) => {
    const bucket = `tok:${args.prefix}`;
    const row = await ctx.db.query('authAttempts').withIndex('by_bucket', (q) => q.eq('bucket', bucket)).unique();
    if (row && (row.failures > 0 || row.lockedUntil)) {
      await ctx.db.patch(row._id, { failures: 0, lockedUntil: undefined });
    }
  },
});

/** Generic security-audit writer (credentials, rollbacks, rate limits). */
export const audit = internalMutation({
  args: {
    category: v.string(),
    action: v.string(),
    detail: v.optional(v.string()),
    workspaceId: v.optional(v.id('workspaces')),
    ip: v.optional(v.string()),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('securityAudit', {
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
      category: args.category,
      action: args.action,
      ...(args.detail ? { detail: args.detail } : {}),
      ...(args.ip ? { ip: args.ip } : {}),
      at: args.at,
    });
  },
});

// ---------------------------------------------------------------------------
// Admin/test access (require admin auth via setAdminAuth — used by live
// verification scripts and dashboards; no secret material is exposed).
// ---------------------------------------------------------------------------

/** Recent audit entries, newest first (admin only). */
export const listAuditAdmin = query({
  args: { limit: v.number() },
  handler: async (ctx, args): Promise<Array<{ category: string; action: string; detail?: string; ip?: string; at: number }>> => {
    const rows = await ctx.db
      .query('securityAudit')
      .withIndex('by_time')
      .order('desc')
      .take(Math.min(200, args.limit));
    return rows.map((r) => ({
      category: r.category,
      action: r.action,
      ...(r.detail !== undefined ? { detail: r.detail } : {}),
      ...(r.ip !== undefined ? { ip: r.ip } : {}),
      at: r.at,
    }));
  },
});

/** Clear a token-prefix lockout (admin only — live-test + support path). */
export const clearLockoutAdmin = mutation({
  args: { prefix: v.string() },
  handler: async (ctx, args) => {
    const bucket = `tok:${args.prefix}`;
    const row = await ctx.db.query('authAttempts').withIndex('by_bucket', (q) => q.eq('bucket', bucket)).unique();
    if (row && (row.failures > 0 || row.lockedUntil)) {
      await ctx.db.patch(row._id, { failures: 0, lockedUntil: undefined });
    }
    return { cleared: true };
  },
});
