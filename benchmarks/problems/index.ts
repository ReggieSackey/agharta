/**
 * Fixed benchmark problem briefs (bench-v1). 13 varied problems across six
 * domains. The last 3 are the holdout — used only for periodic verification,
 * never for optimization passes.
 */
import type { ProblemContext } from '@agharta/core';

interface Brief {
  id: string;
  domain: string;
  title: string;
  brief: string;
  desiredOutcome: string;
  constraints: string[];
  knownCommonApproaches: string[];
  holdout?: boolean;
}

const BRIEFS: Brief[] = [
  {
    id: 'bp_ci_flaky_tests',
    domain: 'engineering',
    title: 'Flaky integration tests block merges',
    brief: 'A 400-test integration suite flakes randomly; engineers rerun until green, and real regressions hide in the noise.',
    desiredOutcome: 'Flake rate under 1% without losing real regression coverage.',
    constraints: ['must not delete tests', 'no dedicated QA headcount'],
    knownCommonApproaches: ['quarantine flaky tests', 'add retries'],
  },
  {
    id: 'bp_onboarding_drop',
    domain: 'product',
    title: 'New users abandon setup at the integration step',
    brief: 'Time-to-first-value is 14 days because the product requires an integration users find confusing; 60% never complete it.',
    desiredOutcome: 'Median time-to-first-value under 3 days with the same integration capability.',
    constraints: ['must not remove the integration surface', 'small team'],
    knownCommonApproaches: ['in-app tour', 'documentation rewrite'],
  },
  {
    id: 'bp_support_scaling',
    domain: 'business',
    title: 'Support load grows linearly with customers',
    brief: 'Each new enterprise customer adds ~0.3 support FTEs; margin shrinks as the base grows.',
    desiredOutcome: 'Support cost per customer declining as the customer base doubles.',
    constraints: ['must not degrade SLA commitments', 'support team has no engineers'],
    knownCommonApproaches: ['chatbot deflection', 'help center articles'],
  },
  {
    id: 'bp_incident_mttm',
    domain: 'engineering',
    title: 'Mean time-to-mitigation stuck at 90 minutes',
    brief: 'Detection is fast, but mitigation requires a manual runbook chain executed by whoever is on call.',
    desiredOutcome: 'MTTM under 30 minutes for the top decile of incident classes.',
    constraints: ['no fully autonomous remediation', 'audit trail required'],
    knownCommonApproaches: ['better runbooks', 'alert routing'],
  },
  {
    id: 'bp_meeting_load',
    domain: 'personal',
    title: 'Calendar crushed by recurring meetings',
    brief: 'A 55-hour meeting week leaves no deep-work blocks; most recurring meetings persist past their usefulness.',
    desiredOutcome: 'At least 15 hours of protected deep work weekly.',
    constraints: ['cannot unilaterally cancel others\u2019 meetings', 'must keep client-facing commitments'],
    knownCommonApproaches: ['decline aggressively', 'batch meetings'],
  },
  {
    id: 'bp_pricing_packaging',
    domain: 'business',
    title: 'Mid-market deals stall on pricing confusion',
    brief: 'Win rate for mid-market is 18% versus 31% enterprise; prospects cite difficulty predicting their own cost.',
    desiredOutcome: 'Mid-market win rate above 25% at equal or better ACV.',
    constraints: ['must not discount', 'list price integrity'],
    knownCommonApproaches: ['interactive pricing calculator', 'sales-assist motion'],
  },
  {
    id: 'bp_data_quality',
    domain: 'engineering',
    title: 'Downstream models degrade from silent data drift',
    brief: 'Schema and distribution changes in upstream events quietly corrupt features; errors surface weeks later in model metrics.',
    desiredOutcome: 'Drift detected within 24 hours of introduction.',
    constraints: ['no new data engineering hires', 'must not slow ingestion'],
    knownCommonApproaches: ['data contracts', 'dashboard monitors'],
  },
  {
    id: 'bp_cross_team_sludge',
    domain: 'product',
    title: 'Cross-team dependencies add six weeks to every launch',
    brief: 'Every feature touching platform requires a review queue averaging six weeks of wall-clock, mostly waiting.',
    desiredOutcome: 'Median cross-team dependency wait under two weeks.',
    constraints: ['platform team cannot grow this year', 'compliance review cannot be skipped'],
    knownCommonApproaches: ['priority escalation path', 'office hours'],
  },
  {
    id: 'bp_skill_plateau',
    domain: 'personal',
    title: 'Skill plateau after five years in the same craft',
    brief: 'A senior practitioner stopped improving years ago; work is competent but interchangeable, and deliberate practice happens only under deadline pressure.',
    desiredOutcome: 'Visible, demonstrable growth in a distinct specialty within 12 months.',
    constraints: ['10 or fewer hours per week available', 'no career break or full-time study'],
    knownCommonApproaches: ['side projects', 'certification course'],
  },
  {
    id: 'bp_urban_delivery',
    domain: 'policy',
    title: 'Curbside delivery congestion in a mid-size city',
    brief: 'Delivery vans double-park in bike lanes during peak hours; complaints up 40% year over year.',
    desiredOutcome: 'Peak-hour double-parking incidents down 60% without delaying deliveries.',
    constraints: ['no new parking construction', 'must retain commercial access'],
    knownCommonApproaches: ['fines', 'loading zone permits'],
  },
  {
    id: 'bp_hiring_pipeline',
    domain: 'business',
    title: 'Senior engineering pipeline biased toward one background',
    brief: '80% of senior hires come from one former employer network; diversity of thought and candidate pool are narrowing.',
    desiredOutcome: 'Offers extended with at least three distinct source backgrounds per role.',
    constraints: ['no lowering of the technical bar', 'recruiting budget flat'],
    knownCommonApproaches: ['blind resume screens', 'referral bonus changes'],
  },
  {
    id: 'bp_holdout_energy',
    domain: 'policy',
    title: 'Retrofit uptake stalled in commercial buildings',
    brief: 'Owners skip retrofits despite payback under five years; program incentives are not converting.',
    desiredOutcome: 'Retrofit completion rate tripled in the target cohort.',
    constraints: ['incentive budget fixed', 'no new mandates'],
    knownCommonApproaches: ['rebate increase', 'contractor training'],
    holdout: true,
  },
  {
    id: 'bp_holdout_knowledge',
    domain: 'product',
    title: 'Internal documentation decays faster than it is written',
    brief: 'Docs are stale within months; engineers ask in chat anyway and get contradictory answers.',
    desiredOutcome: 'Doc-answer rate above 70% on sampled queries.',
    constraints: ['no mandatory documentation quotas', 'no new tool purchases'],
    knownCommonApproaches: ['doc days', 'search improvement'],
    holdout: true,
  },
  {
    id: 'bp_holdout_churn',
    domain: 'business',
    title: 'Post-trial churn concentrated in week two',
    brief: 'Users who complete trial convert at 40%; those who churn do so at day 12-16, before first value.',
    desiredOutcome: 'Week-4 retention above 55%.',
    constraints: ['cannot extend trial length', 'no paid acquisition increase'],
    knownCommonApproaches: ['lifecycle emails', 'in-app nudges'],
    holdout: true,
  },
];

export interface BenchmarkProblem {
  id: string;
  domain: string;
  title: string;
  brief: string;
  desiredOutcome: string;
  constraints: string[];
  knownCommonApproaches: string[];
  holdout: boolean;
  toProblemContext(): ProblemContext;
}

export const BENCHMARK_PROBLEMS: BenchmarkProblem[] = BRIEFS.map((b) => ({
  ...b,
  holdout: b.holdout ?? false,
  toProblemContext: () => ({
    title: b.title,
    description: b.brief,
    desiredOutcome: b.desiredOutcome,
    constraints: b.constraints,
    domain: b.domain,
    previouslyTried: b.knownCommonApproaches,
  }),
}));

/** First 4 non-holdout problems — fixed validation set for challenger runs. */
export const VALIDATION_PROBLEMS = BENCHMARK_PROBLEMS.filter((p) => !p.holdout).slice(0, 4);
export const HOLDOUT_PROBLEMS = BENCHMARK_PROBLEMS.filter((p) => p.holdout);
export const BENCHMARK_VERSION = 'bench-v1';
