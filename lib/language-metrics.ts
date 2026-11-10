import type {Analysis, Expression} from './contracts';
import {naturalSentences} from './segmentation';

const stimulating = new Set<Expression['criteria'][number]>(['fear_appeal', 'overstatement']);
const aggressive = new Set<Expression['criteria'][number]>(['personal_attack', 'group_generalization', 'mockery', 'threat']);

/** Independent expression criteria, counted once per natural sentence. */
export function languageMetrics(analysis: Pick<Analysis, 'sources' | 'expressions'>, scope: 'body' | 'all' = 'body') {
  const expressions = new Map(analysis.expressions.map(expression => [expression.sentenceId, expression]));
  let total = 0;
  let stimulation = 0;
  let aggression = 0;
  let unresolved = 0;
  let possibleStimulation = 0;
  let possibleAggression = 0;
  for (const source of analysis.sources.filter(item => scope === 'all' || item.kind === 'body')) {
    for (const sentence of naturalSentences(source.sentences)) {
      total++;
      const entries = sentence.units.map(unit => expressions.get(unit.id));
      const unknown = entries.some(entry => !entry || entry.status === 'undetermined');
      const stimulated = entries.some(entry => entry?.status === 'flagged' && entry.criteria.some(criterion => stimulating.has(criterion)));
      const attacked = entries.some(entry => entry?.status === 'flagged' && entry.criteria.some(criterion => aggressive.has(criterion)));
      if (unknown) unresolved++;
      if (stimulated) stimulation++;
      if (attacked) aggression++;
      if (stimulated || unknown) possibleStimulation++;
      if (attacked || unknown) possibleAggression++;
    }
  }
  const metric = (flagged: number, possible: number) => ({flagged,
    value: total && (unresolved < total || flagged > 0) ? Math.round(flagged / total * 100) : null,
    upperBound: total ? Math.round(possible / total * 100) : null, total});
  return {total, unresolved, scope, stimulation: metric(stimulation, possibleStimulation), aggression: metric(aggression, possibleAggression)};
}
