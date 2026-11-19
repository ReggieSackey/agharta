// Re-export shared contracts so engine consumers need only @agharta/core.
export { budgetFor, BUDGET_PRESETS, proxyScore, addUsage, EMPTY_USAGE } from '@agharta/shared';
export { OPERATOR_IDS, DOMAINS } from '@agharta/shared';
export type { Budget, BudgetPreset, Domain, OperatorId, Usage } from '@agharta/shared';
