'use client';

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex-api';
import { DashboardShell } from '@/components/DashboardShell';

export default function SettingsPage() {
  const identity = useQuery(api.users.me);
  const workspaceId = identity?.workspaceId ?? null;
  const tokens = useQuery(api.mcpTokens.listForWorkspace, workspaceId ? { workspaceId } : 'skip');
  const createToken = useMutation(api.mcpTokens.create);
  const revokeToken = useMutation(api.mcpTokens.revoke);

  const [newToken, setNewToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <DashboardShell>
      <h1 className="mb-6 text-xl font-semibold">Settings</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-5">
          <p className="data-label mb-2">workspace</p>
          <p className="text-sm">Personal workspace — private by default.</p>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Ideas, feedback, and outcomes remain workspace-scoped. Nothing flows into shared
            benchmarks or global learning without explicit opt-in.
          </p>
        </section>

        <section className="panel p-5">
          <p className="data-label mb-2">model provider</p>
          <p className="text-sm">Server-managed. Secrets never appear in the browser.</p>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Provider selection (<code>AI_PROVIDER</code>) and model IDs live in the Convex backend
            environment. Unset credentials fall back to the deterministic local engine, clearly
            labeled in results. Spend is capped per exploration (<code>MAX_RUN_COST_USD</code>).
          </p>
        </section>

        <section className="panel p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <p className="data-label">MCP personal tokens</p>
            <button
              onClick={async () => {
                if (!workspaceId) return;
                setCreating(true);
                try {
                  const res = await createToken({ workspaceId, label: 'MCP token' });
                  setNewToken(res.token);
                  setCopied(false);
                } finally {
                  setCreating(false);
                }
              }}
              disabled={creating || !workspaceId}
              className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs hover:border-[var(--color-blue)] disabled:opacity-50"
            >
              {creating ? 'generating…' : 'generate token'}
            </button>
          </div>

          {newToken && (
            <div className="mb-4 rounded border border-[var(--color-terra)] bg-[#fbf4f1] p-3">
              <p className="data-label mb-1 text-[var(--color-terra)]">shown exactly once — copy now</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white px-2 py-1.5 text-xs">{newToken}</code>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(newToken);
                    setCopied(true);
                  }}
                  className="rounded border border-[var(--color-line)] bg-white px-2 py-1.5 text-xs"
                >
                  {copied ? 'copied ✓' : 'copy'}
                </button>
              </div>
            </div>
          )}

          {tokens === undefined ? (
            <p className="data-label">loading…</p>
          ) : tokens.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)]">
              No tokens. Generate one to use Agharta from an MCP client (Cursor, Claude Desktop, …).
            </p>
          ) : (
            <ul className="space-y-2">
              {tokens.map((t) => (
                <li key={t._id} className="flex items-center justify-between rounded border border-[var(--color-line)] px-3 py-2 text-xs">
                  <div>
                    <span className="font-mono">{t.tokenPrefix}…</span>
                    <span className="data-label ml-2">{t.label}</span>
                    {t.revokedAt && <span className="data-label ml-2 text-[var(--color-terra)]">revoked</span>}
                  </div>
                  {!t.revokedAt && (
                    <button
                      onClick={() => void revokeToken({ tokenId: t._id })}
                      className="text-[var(--color-terra)] hover:underline"
                    >
                      revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            Tokens are stored as keyed hashes; plaintext is displayed exactly once at creation.
            Use <code>AGHARTA_MCP_TOKEN</code> in your MCP client config.
          </p>
        </section>

        <section className="panel p-5 lg:col-span-2">
          <p className="data-label mb-2">export your data</p>
          <p className="text-xs text-[var(--color-muted)]">
            Workspace export (problems, explorations, ideas, feedback as JSON) is available via
            <code className="mx-1">pnpm test:convex</code> integration tooling — a scoped
            <code className="mx-1">exportWorkspace</code> action is on the roadmap (see
            docs/BUILD_STATUS.md).
          </p>
        </section>
      </div>
    </DashboardShell>
  );
}
