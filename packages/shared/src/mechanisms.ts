/**
 * Seed mechanism library — the curated cross-domain library (V1's 32 concepts,
 * restructured as V2 Mechanisms) plus appliesWhen applicability notes.
 * All entries: provenance 'curated', verified true, described in our own words.
 */
import type { Mechanism } from '@agharta/shared';

export const SEED_MECHANISMS: Mechanism[] = [
  // --- natural systems ---
  { id: 'sc_immune', field: 'immunology', name: 'Clonal selection', mechanism: 'Maintain diversity of cheap partial responses; selectively amplify only what binds to the actual problem', appliesWhen: 'the search space is huge and feedback about fit is cheap and rapid', provenance: 'curated', verified: true },
  { id: 'sc_ant_colony', field: 'complexity science', name: 'Ant colony pheromone trails', mechanism: 'Weak global signals that reinforce successful routes can coordinate without central control', appliesWhen: 'many independent actors generate local traces of what worked', provenance: 'curated', verified: true },
  { id: 'sc_slime_mold', field: 'biology', name: 'Slime mold network adaptation', mechanism: 'Grow many cheap connections, prune by usage: prototyping as physical gradient descent', appliesWhen: 'the best structure is unknown but usage signals are informative', provenance: 'curated', verified: true },
  { id: 'sc_seed_redundancy', field: 'biology', name: 'Programmed redundancy in seeds', mechanism: 'Overproduce cheap options when selection environment is noisy, cull late', appliesWhen: 'outcomes are highly uncertain and options are cheap relative to payoff', provenance: 'curated', verified: true },
  { id: 'sc_keystone', field: 'ecology', name: 'Keystone species leverage', mechanism: 'Small interventions at structural chokepoints cascade through the whole system', appliesWhen: 'the system has asymmetric hubs or dependencies', provenance: 'curated', verified: true },
  { id: 'sc_controlled_burn', field: 'ecology', name: 'Controlled burns', mechanism: 'Deliberately triggering small failures to discharge accumulating risk', appliesWhen: 'pressure accumulates and catastrophic release is worse than controlled release', provenance: 'curated', verified: true },
  { id: 'sc_succession', field: 'ecology', name: 'Ecological succession', mechanism: 'Sequence interventions so early ones prepare conditions for later ones', appliesWhen: 'the end state requires intermediate states that cannot be skipped', provenance: 'curated', verified: true },
  { id: 'sc_hormesis', field: 'toxicology', name: 'Hormesis', mechanism: 'Administer small controlled stress to raise system capacity', appliesWhen: 'the system adapts to stressors and capacity, not comfort, is binding', provenance: 'curated', verified: true },
  // --- engineering & computing ---
  { id: 'sc_cache_tiering', field: 'computing', name: 'Cache tiering', mechanism: 'Split a service by access frequency into layers with different cost/quality tradeoffs', appliesWhen: 'demand is skewed and a small subset dominates outcomes', provenance: 'curated', verified: true },
  { id: 'sc_backpressure', field: 'distributed systems', name: 'Backpressure propagation', mechanism: 'Make overload visible to the source so load self-regulates', appliesWhen: 'downstream saturation is invisible upstream and causes collapse', provenance: 'curated', verified: true },
  { id: 'sc_circuit_breaker', field: 'electrical engineering', name: 'Circuit breakers and fuses', mechanism: 'Fail fast at component level to protect system-level function', appliesWhen: 'one slow failure can drag down the whole system', provenance: 'curated', verified: true },
  { id: 'sc_feedforward', field: 'control theory', name: 'Feed-forward control', mechanism: 'Replace feedback (react after) with prediction (act before) where disturbances are forecastable', appliesWhen: 'disturbances have leading indicators', provenance: 'curated', verified: true },
  { id: 'sc_wip_limits', field: 'manufacturing', name: 'WIP limits', mechanism: 'Artificial scarcity of slots forces problems to surface at the constraint', appliesWhen: 'hidden queues mask the true bottleneck', provenance: 'curated', verified: true },
  { id: 'sc_jidoka', field: 'manufacturing', name: 'Jidoka', mechanism: 'Halting on error converts defects into immediate learning signals', appliesWhen: 'defects flow downstream and get expensive', provenance: 'curated', verified: true },
  { id: 'sc_toc_elevation', field: 'operations', name: 'Theory of constraints elevation', mechanism: 'Find the single binding constraint and remove work elsewhere', appliesWhen: 'throughput is set by one bottleneck', provenance: 'curated', verified: true },
  { id: 'sc_tmr', field: 'aerospace', name: 'Triple modular redundancy', mechanism: 'Independent redundancy plus voting converts unreliable parts into reliable wholes', appliesWhen: 'independent attempts are cheap and failures are decorrelated', provenance: 'curated', verified: true },
  { id: 'sc_staging', field: 'aerospace', name: 'Rocket staging', mechanism: 'Shed structure that served an earlier phase but now costs drag', appliesWhen: 'assets from earlier phases burden later ones', provenance: 'curated', verified: true },
  { id: 'sc_crossfeed', field: 'aerospace', name: 'Propellant crossfeed', mechanism: 'Asymmetric resource sharing before separation increases total capability', appliesWhen: 'paired efforts can lend capacity before diverging', provenance: 'curated', verified: true },
  // --- economics & business ---
  { id: 'sc_second_price', field: 'economics', name: 'Second-price auctions', mechanism: 'Payment rules can be designed so honest revelation is optimal', appliesWhen: 'participants hide private information from a coordinator', provenance: 'curated', verified: true },
  { id: 'sc_pigouvian', field: 'economics', name: 'Pigouvian pricing', mechanism: 'Price a hidden cost to shift decentralized decisions without mandates', appliesWhen: 'behavior externalizes costs invisibly', provenance: 'curated', verified: true },
  { id: 'sc_versioning', field: 'economics', name: 'Second-degree price discrimination', mechanism: 'Design choices as a menu that induces self-sorting', appliesWhen: 'users have private preferences they will reveal through choices', provenance: 'curated', verified: true },
  { id: 'sc_reinsurance', field: 'insurance', name: 'Reinsurance layering', mechanism: 'Slice risk along severity bands and assign each band to the best holder', appliesWhen: 'risk concentration differs by severity band', provenance: 'curated', verified: true },
  { id: 'sc_mfc', field: 'industrial organization', name: 'Most-favored-customer clauses', mechanism: 'Commitment devices that shape future competition using present promises', appliesWhen: 'early adopters hesitate fearing later better deals', provenance: 'curated', verified: true },
  // --- social systems & cities ---
  { id: 'sc_braess', field: 'urban planning', name: 'Braess paradox', mechanism: 'Local optimization can destroy global throughput; removing options can help', appliesWhen: 'independent local choices interact on shared capacity', provenance: 'curated', verified: true },
  { id: 'sc_brt', field: 'urban planning', name: 'BRT level boarding', mechanism: 'Move the slow step out of the critical path', appliesWhen: 'one serial step dominates cycle time', provenance: 'curated', verified: true },
  { id: 'sc_single_queue', field: 'urban planning', name: 'Single serpentine queue', mechanism: 'Pool queues to remove variance penalty across servers', appliesWhen: 'multiple servers with variable service times', provenance: 'curated', verified: true },
  { id: 'sc_broken_windows', field: 'policing', name: 'Broken windows signal management', mechanism: 'Maintain visible baseline signals to anchor expectations', appliesWhen: 'visible decay invites escalating disengagement', provenance: 'curated', verified: true },
  { id: 'sc_participatory', field: 'governance', name: 'Participatory budgeting', mechanism: 'Delegate a bounded real decision to those with local information', appliesWhen: 'distributed actors hold information the center lacks', provenance: 'curated', verified: true },
  // --- science & method ---
  { id: 'sc_lind', field: 'clinical method', name: 'James Lind sequential trial', mechanism: 'Small controlled comparison beats plausible theory', appliesWhen: 'plausible-sounding approaches are untested against each other', provenance: 'curated', verified: true },
  { id: 'sc_bacon', field: 'history of science', name: 'Baconian tables', mechanism: 'Systematic contrast tables reveal which factor matters', appliesWhen: 'many candidate causes and no controlled data', provenance: 'curated', verified: true },
  { id: 'sc_randomization', field: 'statistics', name: 'Randomization inference', mechanism: 'Use the assignment mechanism itself as the benchmark for evidence', appliesWhen: 'cause and effect are contested', provenance: 'curated', verified: true },
  { id: 'sc_tiny_batches', field: 'software method', name: 'Trunk-based tiny batches', mechanism: 'Shrink batch size to shrink feedback delay and risk', appliesWhen: 'long cycles delay learning and compound risk', provenance: 'curated', verified: true },
  // --- additional fields for V2 breadth ---
  { id: 'sc_quorum', field: 'microbiology', name: 'Quorum sensing', mechanism: 'Behavior switches when a density signal crosses a threshold', appliesWhen: 'individual actions only matter above collective scale', provenance: 'curated', verified: true },
  { id: 'sc_gravity_assist', field: 'spaceflight', name: 'Gravity assist', mechanism: 'Borrow momentum from a moving system instead of carrying fuel', appliesWhen: 'large moving systems pass nearby and their energy is harvestable', provenance: 'curated', verified: true },
  { id: 'sc_distributed_ledger', field: 'cryptography', name: 'Append-only shared ledger', mechanism: 'Shared append-only records remove the need for a trusted middleman', appliesWhen: 'mutual distrust and no neutral party', provenance: 'curated', verified: true },
  { id: 'sc_predator_prey', field: 'population ecology', name: 'Predator-prey cycles', mechanism: 'Two coupled populations oscillate; lags drive booms and busts', appliesWhen: 'response delays between interacting forces cause instability', provenance: 'curated', verified: true },
  { id: 'sc_stigmergy', field: 'entomology', name: 'Stigmergy', mechanism: 'Artifacts left in the environment coordinate future work without communication', appliesWhen: 'actors cannot communicate directly but share a medium', provenance: 'curated', verified: true },
];

export function getMechanism(id: string): Mechanism | undefined {
  return SEED_MECHANISMS.find((m) => m.id === id);
}
