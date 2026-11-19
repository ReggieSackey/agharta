'use client';

/** Small shared UI atoms with honest labels. */

export function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="panel p-4">
      <p className="data-label">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-[var(--color-muted)]">{sub}</p> : null}
    </div>
  );
}

export type EvidenceTier = 'automated_proxy' | 'human_rating' | 'external_test';

/** Status chip: never color-only — always carries a text label. */
export function EvidenceChip({ kind }: { kind: EvidenceTier | string }) {
  const map: Record<string, { text: string; className: string }> = {
    automated_proxy: { text: 'auto-scored', className: 'border-[var(--color-blue)] text-[var(--color-blue)]' },
    human_rating: { text: 'human-rated', className: 'border-[var(--color-terra)] text-[var(--color-terra)]' },
    external_test: { text: 'real outcome', className: 'border-[var(--color-moss)] text-[var(--color-moss)]' },
    succeeded: { text: 'succeeded (self-reported)', className: 'border-[var(--color-moss)] text-[var(--color-moss)]' },
    failed: { text: 'failed (self-reported)', className: 'border-[var(--color-terra)] text-[var(--color-terra)]' },
    attempted: { text: 'attempted', className: 'border-[var(--color-muted)] text-[var(--color-muted)]' },
    shortlisted: { text: 'shortlisted', className: 'border-[var(--color-muted)] text-[var(--color-muted)]' },
    selected: { text: 'recommended', className: 'border-[var(--color-blue)] text-[var(--color-blue)]' },
    unknown: { text: 'unknown outcome', className: 'border-dashed border-[var(--color-muted)] text-[var(--color-muted)]' },
  };
  const s = map[kind] ?? { text: kind, className: 'border-[var(--color-line)] text-[var(--color-muted)]' };
  return (
    <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-medium ${s.className}`}>
      {s.text}
    </span>
  );
}

export function UncertaintyBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="inline-flex items-center gap-1.5" title={`judge uncertainty ${pct}%`}>
      <span className="h-1 w-12 rounded-full bg-[var(--color-line)]">
        <span className="block h-1 rounded-full bg-[var(--color-terra)]" style={{ width: `${pct}%` }} />
      </span>
      <span className="data-label">±{pct}%</span>
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="data-label">empty</p>
      <h2 className="font-medium">{title}</h2>
      <p className="max-w-md text-sm text-[var(--color-muted)]">{body}</p>
      {action}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded bg-[var(--color-paper)]" />
      ))}
    </div>
  );
}

export const OPERATOR_LABELS: Record<string, string> = {
  divergent: 'Divergent',
  analogy: 'Analogy',
  inversion: 'Inversion',
  recombination: 'Recombination',
};
