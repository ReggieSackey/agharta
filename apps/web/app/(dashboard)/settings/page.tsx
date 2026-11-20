'use client';

import { useState } from 'react';
import { useQuery, useMutation, useAction } from 'convex/react';
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
        <ByokPanel />

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


function ByokPanel() {
  const credentials = useQuery(api.credentialsManage.listCredentials, {});
  const setCredential = useAction(api.credentials.setCredential);
  const deleteCredential = useMutation(api.credentialsManage.deleteCredential);
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      await setCredential({ provider, apiKey, model: model || undefined });
      setApiKey(''); setModel(''); setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel p-5">
      <p className="data-label mb-2">provider API keys (bring your own)</p>
      <p className="text-xs text-[var(--color-muted)] mb-3">
        Keys are encrypted with AES-256-GCM under a per-workspace key before storage and are
        never shown again, logged, or exposed to MCP clients. Delete anytime; experiments fall
        back to the server provider or the local deterministic engine.
      </p>
      <div className="space-y-2">
        <div className="flex gap-2">
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded border border-[var(--color-line)] px-2 py-1.5 text-xs">
            {['openai', 'anthropic', 'deepseek', 'glm', 'openai-compatible'].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <input
            type="password"
            placeholder="API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="flex-1 rounded border border-[var(--color-line)] px-2 py-1.5 text-xs"
          />
        </div>
        <input
          placeholder="model id (optional)"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded border border-[var(--color-line)] px-2 py-1.5 text-xs"
        />
        <button
          onClick={save}
          disabled={busy || !apiKey.trim()}
          className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs hover:border-[var(--color-blue)] disabled:opacity-50"
        >
          {busy ? 'saving…' : 'save key'}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {saved && <p className="text-xs text-green-700">saved (encrypted)</p>}
      </div>

      <div className="mt-4">
        <p className="data-label mb-1">stored credentials</p>
        {(credentials ?? []).length === 0 ? (
          <p className="text-xs text-[var(--color-muted)]">none — server provider / local engine is used</p>
        ) : (
          <div className="divide-y border border-[var(--color-line)] rounded">
            {credentials!.map((c: { provider: string; label?: string; keyFingerprint: string; updatedAt: number }) => (
              <div key={c.provider} className="flex items-center justify-between px-3 py-2">
                <div>
                  <p className="text-xs font-medium">{c.provider}{c.label ? ` — ${c.label}` : ''}</p>
                  <p className="text-[11px] text-[var(--color-muted)]">
                    key {c.keyFingerprint.slice(0, 8)}… · updated {new Date(c.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  className="text-[11px] underline text-red-600"
                  onClick={() => void deleteCredential({ provider: c.provider })}
                >
                  delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
