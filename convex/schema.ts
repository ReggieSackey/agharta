import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * AGHARTA Convex schema.
 * Every hot query path has a matching index. Authorization is enforced in
 * every public function via convex/auth.ts helpers (Convex has no RLS).
 */
export default defineSchema({
  users: defineTable({
    /** Verified WorkOS subject (`sub` claim) — the only trusted identity key. */
    subject: v.string(),
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    /** Set only through a trusted dev bootstrap path, never client-writable. */
    isBootstrapAdmin: v.optional(v.boolean()),
  }).index('by_subject', ['subject']),

  workspaces: defineTable({
    name: v.string(),
    creatorSubject: v.string(),
  }).index('by_creator', ['creatorSubject']),

  workspaceMembers: defineTable({
    workspaceId: v.id('workspaces'),
    userSubject: v.string(),
    role: v.union(v.literal('owner'), v.literal('member')),
  })
    .index('by_user_workspace', ['userSubject', 'workspaceId'])
    .index('by_workspace_user', ['workspaceId', 'userSubject']),

  problems: defineTable({
    workspaceId: v.id('workspaces'),
    creatorSubject: v.string(),
    title: v.string(),
    description: v.string(),
    desiredOutcome: v.string(),
    domain: v.string(),
    constraints: v.optional(v.array(v.string())),
    previousAttempts: v.optional(v.array(v.string())),
  })
    .index('by_workspace', ['workspaceId']),

  strategies: defineTable({
    workspaceId: v.id('workspaces'),
    version: v.string(),
    state: v.union(
      v.literal('champion'),
      v.literal('challenger'),
      v.literal('rejected'),
      v.literal('archived')
    ),
    config: v.any(), // SearchStrategy JSON (validated at write boundary)
    promotedBy: v.optional(v.string()),
    promotedAt: v.optional(v.number()),
  })
    .index('by_workspace_state', ['workspaceId', 'state'])
    .index('by_workspace_version', ['workspaceId', 'version']),

  explorations: defineTable({
    workspaceId: v.id('workspaces'),
    problemId: v.id('problems'),
    strategyId: v.id('strategies'),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled')
    ),
    budget: v.any(), // Budget JSON
    usage: v.optional(v.any()),
    progress: v.optional(v.number()),
    stage: v.optional(v.string()),
    errors: v.optional(v.array(v.string())),
    summary: v.optional(v.any()), // recommendations
    seed: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    /** exact strategy config used for this run (champion × learned weights) */
    effectiveStrategy: v.optional(v.any()),
    /** operator weights applied from the latest allocationDecision, if any */
    appliedAllocationWeights: v.optional(v.any()),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_problem', ['problemId'])
    .index('by_workspace_status', ['workspaceId', 'status']),

  ideas: defineTable({
    workspaceId: v.id('workspaces'),
    explorationId: v.id('explorations'),
    title: v.string(),
    intervention: v.string(),
    causalMechanism: v.string(),
    assumptions: v.array(v.string()),
    failureModes: v.array(v.string()),
    proposedTest: v.string(),
    operatorId: v.string(),
    parentIds: v.array(v.string()),
    sourceConceptIds: v.array(v.string()),
    mechanismId: v.optional(v.string()),
    generation: v.number(),
    invertedConstraint: v.optional(v.string()),
    survivedRepair: v.optional(v.boolean()),
    modelMetadata: v.optional(v.any()),
    /** selected | rejected | shortlisted | attempted | succeeded | failed | unknown */
    selectionState: v.optional(v.string()),
  })
    .index('by_exploration', ['explorationId'])
    .index('by_workspace_exploration', ['workspaceId', 'explorationId'])
    .index('by_mechanism', ['mechanismId']),

  ideaEdges: defineTable({
    workspaceId: v.id('workspaces'),
    parentIdeaId: v.string(),
    childIdeaId: v.string(),
    relation: v.union(
      v.literal('mutation'),
      v.literal('recombination'),
      v.literal('refinement'),
      v.literal('analogy_transfer')
    ),
  })
    .index('by_child', ['childIdeaId'])
    .index('by_parent', ['parentIdeaId'])
    .index('by_exploration_edges', ['workspaceId', 'childIdeaId']),

  sourceConcepts: defineTable({
    /** stable slug matching packages/core curated library, e.g. sc_cache */
    slug: v.string(),
    domain: v.string(),
    name: v.string(),
    description: v.string(),
    transferableMechanism: v.string(),
    provenance: v.union(v.literal('curated'), v.literal('model_generated')),
    sourceUri: v.optional(v.string()),
    verified: v.boolean(),
  }).index('by_slug', ['slug']),

  ideaSources: defineTable({
    workspaceId: v.id('workspaces'),
    ideaId: v.id('ideas'),
    sourceConceptSlug: v.string(),
    distance: v.optional(v.number()),
    mappingNotes: v.optional(v.string()),
  })
    .index('by_idea', ['ideaId'])
    .index('by_workspace_idea', ['workspaceId', 'ideaId']),

  mechanisms: defineTable({
    workspaceId: v.id('workspaces'),
    name: v.string(),
    normalizedDescription: v.string(),
    status: v.optional(v.string()),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_workspace_name', ['workspaceId', 'name']),

  operatorInvocations: defineTable({
    workspaceId: v.id('workspaces'),
    explorationId: v.id('explorations'),
    operator: v.string(),
    contextHash: v.string(),
    modelId: v.string(),
    promptVersion: v.string(),
    assignedBudget: v.optional(v.number()),
    outputsGenerated: v.number(),
    usage: v.any(), // Usage JSON
    success: v.optional(v.boolean()),
    error: v.optional(v.string()),
  }).index('by_exploration', ['explorationId']),

  evaluations: defineTable({
    workspaceId: v.id('workspaces'),
    ideaId: v.id('ideas'),
    judgeType: v.string(),
    judgeModel: v.string(),
    judgeVersion: stringValidator(),
    originality: v.number(),
    usefulness: v.number(),
    feasibility: v.number(),
    structuralValidity: v.optional(v.number()),
    uncertainty: v.number(),
    rationale: v.string(),
    evidenceTier: v.string(),
    raw: v.optional(v.any()),
  })
    .index('by_idea', ['ideaId'])
    .index('by_workspace_idea', ['workspaceId', 'ideaId']),

  ideaFeedback: defineTable({
    workspaceId: v.id('workspaces'),
    ideaId: v.id('ideas'),
    actorSubject: v.string(),
    action: v.string(),
    reason: v.optional(v.string()),
    evidence: v.optional(v.string()),
    outcomeMetric: v.optional(v.string()),
    confidence: v.optional(v.string()),
    verificationStatus: v.string(),
  })
    .index('by_idea', ['ideaId'])
    .index('by_workspace_time', ['workspaceId']),

  operatorStats: defineTable({
    workspaceId: v.id('workspaces'),
    domain: v.string(),
    operatorId: v.string(),
    counters: v.any(), // OperatorCounters JSON
    updatedAt: v.number(),
  })
    .index('by_workspace_domain_operator', ['workspaceId', 'domain', 'operatorId'])
    .index('by_workspace_operator', ['workspaceId', 'operatorId']),

  optimizationExperiments: defineTable({
    workspaceId: v.id('workspaces'),
    incumbentStrategyId: v.id('strategies'),
    challengerStrategyId: v.id('strategies'),
    benchmarkVersion: v.string(),
    seeds: v.array(v.number()),
    championResult: v.any(),
    challengerResult: v.any(),
    decision: v.union(
      v.literal('pending_user_promotion'),
      v.literal('eligible_for_promotion'),
      v.literal('rejected')
    ),
    rationale: v.string(),
    createdAt: v.number(),
  })
    .index('by_workspace', ['workspaceId']),

  allocationDecisions: defineTable({
    workspaceId: v.id('workspaces'),
    weights: v.any(),
    reason: v.string(),
    seed: v.number(),
    createdAt: v.number(),
  }).index('by_workspace_time', ['workspaceId']),

  promotionAudit: defineTable({
    workspaceId: v.id('workspaces'),
    experimentId: v.id('optimizationExperiments'),
    fromVersion: v.string(),
    toVersion: v.string(),
    decision: v.string(),
    by: v.string(),
    at: v.number(),
    rationale: v.string(),
  }).index('by_workspace_time', ['workspaceId']),

  mcpTokens: defineTable({
    workspaceId: v.id('workspaces'),
    creatorSubject: v.string(),
    tokenPrefix: v.string(),
    /** keyed hash — plaintext NEVER stored */
    tokenHash: v.string(),
    label: v.string(),
    expiresAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_prefix', ['tokenPrefix'])
    .index('by_workspace', ['workspaceId']),


  // =========================================================================
  // V2 — experimental creative search + asynchronous learning
  // =========================================================================

  /** full experiment records (Engine 1 output, Engine 2 input) */
  experiments: defineTable({
    workspaceId: v.id('workspaces'),
    problemId: v.id('problems'),
    problemText: v.string(),
    /** ExperimentRecord JSON minus ids (validated at write boundary) */
    record: v.any(),
    status: v.string(),
    /** artifacts snapshot ids used for this run */
    mapVersionId: v.string(),
    policyVersionId: v.string(),
    /** engine-2 checkpoint: has a learning run consumed this experiment? */
    processedByLearning: v.optional(v.boolean()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_workspace_status', ['workspaceId', 'status'])
    .index('by_workspace_unprocessed', ['workspaceId', 'processedByLearning', 'status']),

  /** immutable versioned conceptual maps (private per workspace) */
  conceptualMapVersions: defineTable({
    workspaceId: v.id('workspaces'),
    versionId: v.string(),
    version: v.string(),
    artifact: v.any(), // ConceptualMap JSON
    isActive: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index('by_workspace_active', ['workspaceId', 'isActive'])
    .index('by_workspace_version', ['workspaceId', 'versionId']),

  /** immutable versioned search policies (private per workspace) */
  policyVersions: defineTable({
    workspaceId: v.id('workspaces'),
    versionId: v.string(),
    version: stringValidator(),
    artifact: v.any(), // SearchPolicy JSON
    isActive: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index('by_workspace_active', ['workspaceId', 'isActive'])
    .index('by_workspace_version', ['workspaceId', 'versionId']),

  /** engine-2 learning runs (audit trail) */
  learningRuns: defineTable({
    workspaceId: v.id('workspaces'),
    status: v.union(
      v.literal('pending'),
      v.literal('fitting'),
      v.literal('evaluating'),
      v.literal('promoted'),
      v.literal('retained'),
      v.literal('failed')
    ),
    /** observation experiment ids consumed */
    experimentIds: v.array(v.string()),
    candidateMapVersionId: v.optional(v.string()),
    candidatePolicyVersionId: v.optional(v.string()),
    championMapVersionId: v.optional(v.string()),
    championPolicyVersionId: v.optional(v.string()),
    evaluation: v.optional(v.any()), // ArtifactEvaluation JSON
    notes: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
    /** idempotency: hash of consumed experiment ids */
    inputHash: v.string(),
    createdAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
.index('by_workspace_status', ['workspaceId', 'status'])
    .index('by_workspace_created', ['workspaceId', 'createdAt'])
    .index('by_input_hash', ['inputHash']),

  /** champion/challenger bench evaluations */
  artifactEvaluations: defineTable({
    workspaceId: v.id('workspaces'),
    learningRunId: v.id('learningRuns'),
    evaluation: v.any(), // ArtifactEvaluation JSON
    seeds: v.array(v.number()),
    problemIds: v.array(v.string()),
    passed: v.boolean(),
    createdAt: v.number(),
  }).index('by_learning_run', ['learningRunId']),

  /** engine-2 scheduled heartbeat bookkeeping (idempotency) */
  learningHeartbeats: defineTable({
    workspaceId: v.id('workspaces'),
    kind: v.string(),
    lastRunAt: v.number(),
  }).index('by_workspace_kind', ['workspaceId', 'kind']),

  /** BYOK provider credentials — AES-256-GCM ciphertext ONLY */
  providerCredentials: defineTable({
    workspaceId: v.id('workspaces'),
    provider: v.string(),
    /** base64 ciphertext bundle {iv, tag, ct} — plaintext never stored */
    encrypted: v.string(),
    /** key fingerprint (non-secret) for key rotation awareness */
    keyFingerprint: v.string(),
    /** display-safe metadata only */
    label: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_workspace_provider', ['workspaceId', 'provider']),
  /** dev-only demo data marker (never shown as real performance) */
  demoData: defineTable({
    workspaceId: v.id('workspaces'),
    kind: v.string(),
    note: v.string(),
  }).index('by_workspace', ['workspaceId']),
});

function stringValidator() {
  return v.string();
}
