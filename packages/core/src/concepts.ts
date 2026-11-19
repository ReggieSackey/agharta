/**
 * Curated cross-domain source concept library for analogical transfer.
 * 32 concepts. Each is a publicly-known mechanism described in our own words
 * with `provenance: 'curated'` and `verified: true` (human-authored). We cite
 * no external URLs we have not actually consulted; concepts are common
 * knowledge in their fields. LLM-invented sources must instead use
 * `provenance: 'model_generated', verified: false`.
 */
import type { SourceConcept } from '@agharta/shared';

export const SOURCE_CONCEPTS: SourceConcept[] = [
  // --- natural systems ---
  { id: 'sc_immune', domain: 'immunology', name: 'Clonal selection', description: 'Immune system amplifies rare antibodies that match a pathogen', transferableMechanism: 'Maintain diversity of cheap partial responses; selectively amplify only what binds to the actual problem', provenance: 'curated', verified: true },
  { id: 'sc_ant_colony', domain: 'complexity science', name: 'Ant colony pheromone trails', description: 'Ants reinforce successful paths via deposited pheromones', transferableMechanism: 'Weak global signals that reinforce successful routes can coordinate without central control', provenance: 'curated', verified: true },
  { id: 'sc_slime_mold', domain: 'biology', name: 'Slime mold network adaptation', description: 'Physarum retracts from dead-end tubes and thickens useful ones', transferableMechanism: 'Grow many cheap connections, prune by usage: prototyping as physical gradient descent', provenance: 'curated', verified: true },
  { id: 'sc_pruiting', domain: 'biology', name: 'Programmed redundancy in seeds', description: 'Plants overproduce seeds because germination is uncertain', transferableMechanism: 'Overproduce cheap options when selection environment is noisy, cull late', provenance: 'curated', verified: true },
  { id: 'sc_keystone', domain: 'ecology', name: 'Keystone species leverage', description: 'A single species disproportionately shapes ecosystem structure', transferableMechanism: 'Small interventions at structural chokepoints cascade through the whole system', provenance: 'curated', verified: true },
  { id: 'sc_fire', domain: 'ecology', name: 'Controlled burns', description: 'Small deliberate fires prevent catastrophic ones', transferableMechanism: 'Deliberately triggering small failures to discharge accumulating risk', provenance: 'curated', verified: true },
  { id: 'sc_sucession', domain: 'ecology', name: 'Ecological succession', description: 'Disturbed ecosystems recover through staged pioneer→climax communities', transferableMechanism: 'Sequence interventions so early ones prepare conditions for later ones', provenance: 'curated', verified: true },
  { id: 'sc_hormesis', domain: 'toxicology', name: 'Hormesis', description: 'Low doses of a stressor trigger adaptive overcompensation', transferableMechanism: 'Administer small controlled stress to raise system capacity', provenance: 'curated', verified: true },
  // --- engineering & computing ---
  { id: 'sc_cache', domain: 'computing', name: 'Cache tiering', description: 'Fast small memory fronting slow large memory', transferableMechanism: 'Split a service by access frequency into layers with different cost/quality tradeoffs', provenance: 'curated', verified: true },
  { id: 'sc_backpressure', domain: 'distributed systems', name: 'Backpressure propagation', description: 'Downstream saturation travels upstream as explicit refusal', transferableMechanism: 'Make overload visible to the source so load self-regulates', provenance: 'curated', verified: true },
  { id: 'sc_circuit', domain: 'electrical engineering', name: 'Circuit breakers and fuses', description: 'Sacrificial elements fail fast to protect the system', transferableMechanism: 'Fail fast at component level to protect system-level function', provenance: 'curated', verified: true },
  { id: 'sc_control', domain: 'control theory', name: 'Feed-forward control', description: 'Act on predicted disturbance before it hits the process', transferableMechanism: 'Replace feedback (react after) with prediction (act before) where disturbances are forecastable', provenance: 'curated', verified: true },
  { id: 'sc_kanban', domain: 'manufacturing', name: 'WIP limits', description: 'Cap work in progress to expose bottlenecks', transferableMechanism: 'Artificial scarcity of slots forces problems to surface at the constraint', provenance: 'curated', verified: true },
  { id: 'sc_jidoka', domain: 'manufacturing', name: 'Jidoka (automation with a human touch)', description: 'Machines stop on defect; humans fix root cause', transferableMechanism: 'Halting on error converts defects into immediate learning signals', provenance: 'curated', verified: true },
  { id: 'sc_toc', domain: 'operations', name: 'Theory of constraints elevation', description: 'Throughput is set by the bottleneck; elevate only it', transferableMechanism: 'Find the single binding constraint and remove work elsewhere', provenance: 'curated', verified: true },
  { id: 'sc_redundancy', domain: 'aerospace', name: 'Triple modular redundancy', description: 'Three independent units vote; minority is outvoted', transferableMechanism: 'Independent redundancy plus voting converts unreliable parts into reliable wholes', provenance: 'curated', verified: true },
  { id: 'sc_stage', domain: 'aerospace', name: 'Staged combustion / staging', description: 'Rockets drop spent stages to stop carrying dead weight', transferableMechanism: 'Shed structure that served an earlier phase but now costs drag', provenance: 'curated', verified: true },
  { id: 'sc_refuel', domain: 'aerospace', name: 'Propellant crossfeed', description: 'Boosters feed each other so staging drops full tanks', transferableMechanism: 'Asymmetric resource sharing before separation increases total capability', provenance: 'curated', verified: true },
  // --- economics & business ---
  { id: 'sc_auction', domain: 'economics', name: 'Second-price auctions', description: 'Winner pays second price, incentivizing truthful bids', transferableMechanism: 'Payment rules can be designed so honest revelation is optimal', provenance: 'curated', verified: true },
  { id: 'sc_pigou', domain: 'economics', name: 'Pigouvian pricing', description: 'Tax externalities to internalize social cost', transferableMechanism: 'Price a hidden cost to shift decentralized decisions without mandates', provenance: 'curated', verified: true },
  { id: 'sc_versioning', domain: 'economics', name: 'Second-degree price discrimination', description: 'Offer a menu so buyers self-select by willingness to pay', transferableMechanism: 'Design choices as a menu that induces self-sorting', provenance: 'curated', verified: true },
  { id: 'sc_insur', domain: 'insurance', name: 'Reinsurance layering', description: 'Risk is sliced into layers with different appetites', transferableMechanism: 'Slice risk along severity bands and assign each band to the best holder', provenance: 'curated', verified: true },
  { id: 'sc_mmc', domain: 'industrial organization', name: 'Most-favored-customer clauses', description: 'Promise early buyers the best future price', transferableMechanism: 'Commitment devices that shape future competition using present promises', provenance: 'curated', verified: true },
  // --- social systems & cities ---
  { id: 'sc_traffic', domain: 'urban planning', name: 'Braess paradox', description: 'Adding a road can worsen traffic for everyone', transferableMechanism: 'Local optimization can destroy global throughput; removing options can help', provenance: 'curated', verified: true },
  { id: 'sc_brt', domain: 'urban planning', name: 'Bus rapid transit gantries', description: 'Boarding paid before boarding, at level', transferableMechanism: 'Move the slow step out of the critical path', provenance: 'curated', verified: true },
  { id: 'sc_proud', domain: 'urban planning', name: 'Proudly public queues (single line)', description: 'One serpentine queue serving multiple counters', transferableMechanism: 'Pool queues to remove variance penalty across servers', provenance: 'curated', verified: true },
  { id: 'sc_broken', domain: 'policing', name: 'Broken windows signal management', description: 'Small visible disorder invites larger disorder', transferableMechanism: 'Maintain visible baseline signals to anchor expectations', provenance: 'curated', verified: true },
  { id: 'sc_partic', domain: 'governance', name: 'Participatory budgeting', description: 'Residents allocate a real budget slice directly', transferableMechanism: 'Delegate a bounded real decision to those with local information', provenance: 'curated', verified: true },
  // --- science & method ---
  { id: 'sc_james', domain: 'clinical method', name: 'James Lind sequential trial', description: 'Compare treatments under like conditions at sea', transferableMechanism: 'Small controlled comparison beats plausible theory', provenance: 'curated', verified: true },
  { id: 'sc_bacon', domain: 'history of science', name: 'Baconian tables', description: 'Tabulate presence/absence/degree to induce causes', transferableMechanism: 'Systematic contrast tables reveal which factor matters', provenance: 'curated', verified: true },
  { id: 'sc_null', domain: 'statistics', name: 'Randomization inference', description: 'Compare observed effect to random assignment distribution', transferableMechanism: 'Use assignment mechanism itself as the benchmark for evidence', provenance: 'curated', verified: true },
  { id: 'sc_fold', domain: 'software method', name: 'Trunk-based tiny batches', description: 'Many small integrations beat rare large merges', transferableMechanism: 'Shrink batch size to shrink feedback delay and risk', provenance: 'curated', verified: true },
];

/** Lookup with existence check (engine validates model-referenced IDs). */
export function getConcept(id: string): SourceConcept | undefined {
  return SOURCE_CONCEPTS.find((c) => c.id === id);
}
