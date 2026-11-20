export * from './contracts-reexport';
export { createFakeModel, withRetries, ModelBoundaryError } from './models';
export type { GenerateRequest, GenerateResult, ModelAdapter, CostTable } from './models';
export { OPERATORS, selectSources, runOperator } from './operators';
export type { ProblemContext, ParentIdeaRef, OperatorRunContext, OperatorResult, Operator, OperatorMeta } from './operators';
export { SOURCE_CONCEPTS, getConcept } from './concepts';
export { selectDiverse, dedupe, annotateMechanisms, DEFAULT_SELECT_OPTIONS } from './population';
export type { Candidate, SelectOutcome, SelectOptions } from './population';
export { runExploration } from './engine';
export type { EngineRuntime, EngineEvent, ExplorationResult, EngineConfig } from './engine';
export { defaultChampion, allocateOpportunities } from './strategies';

// V2 experimental search engine
export { runExperiment } from './search/engine2';
export type { ExperimentInput, ExperimentOutput } from './search/engine2';
export * from './search/boundary';
