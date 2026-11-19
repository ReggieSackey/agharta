/**
 * Rubric anchors for 1–5 scoring. These descriptions are versioned with the
 * judge; changing them changes JUDGE_VERSION.
 */
export const JUDGE_VERSION = 'rubric-v1.1';

export interface RubricDimension {
  name: 'originality' | 'usefulness' | 'feasibility' | 'structuralValidity';
  anchors: Record<1 | 2 | 3 | 4 | 5, string>;
}

export const RUBRICS: Record<RubricDimension['name'], RubricDimension> = {
  originality: {
    name: 'originality',
    anchors: {
      1: 'Recombines known approaches with no new mechanism; indistinguishable from common practice.',
      2: 'Mostly known; one element is slightly reframed.',
      3: 'A known mechanism is applied in a new context OR a genuinely new combination is proposed.',
      4: 'New causal route to the outcome; clearly outside the standard repertoire for this domain.',
      5: 'Opens a mechanism class not previously considered; paradigm-shifting relative to the problem statement.',
    },
  },
  usefulness: {
    name: 'usefulness',
    anchors: {
      1: 'Does not move the desired outcome even if executed perfectly.',
      2: 'Marginal or speculative effect on the outcome.',
      3: 'Plausibly moves the outcome for some segment/case.',
      4: 'Directly addresses the stated outcome with convincing causal chain.',
      5: 'Decisively addresses the outcome and creates second-order benefits.',
    },
  },
  feasibility: {
    name: 'feasibility',
    anchors: {
      1: 'Impossible or requires unavailable capabilities/resources.',
      2: 'Possible in principle but blocked by major practical barriers.',
      3: 'Executable with meaningful effort; main barriers are cost/coordination.',
      4: 'Executable with current resources; a week-scale test is designable.',
      5: 'Immediately executable; test possible within days.',
    },
  },
  structuralValidity: {
    name: 'structuralValidity',
    // only scored for analogy-derived ideas
    anchors: {
      1: 'Surface-level similarity only; causal structure does not transfer.',
      2: 'Partial mapping; key causal link breaks in target domain.',
      3: 'Core mechanism maps; several supporting links require evidence.',
      4: 'Mechanism maps well; constraints identified and respected.',
      5: 'Deep structural correspondence; mapping validated against constraints.',
    },
  },
};

export function rubricPrompt(): string {
  const dim = (d: RubricDimension) =>
    `${d.name.toUpperCase()}:\n${([1, 2, 3, 4, 5] as const).map((k) => ` ${k} = ${d.anchors[k]}`).join('\n')}`;
  return [
    'You are an independent evaluator of candidate ideas. Score strictly against these rubrics:',
    dim(RUBRICS.originality),
    dim(RUBRICS.usefulness),
    dim(RUBRICS.feasibility),
    'STRUCTURAL VALIDITY (only when the idea is analogy-derived):',
    dim(RUBRICS.structuralValidity),
    'Also return uncertainty (0..1, your honest self-assessed probability your scores are off by >=1 point) and a concise justification naming the dominant tradeoff.',
  ].join('\n\n');
}
