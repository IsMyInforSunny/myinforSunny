import definition from './data/voice-article-issue-rules.json';
import {VOICE_MARGIN_GAP, VOICE_TOPICS, VOICE_SCOPE, type VoiceTopic} from './sentence-voice';
import {articleTextPrefix} from './server/article-document';

export const VOICE_ARTICLE_ISSUE_POLICY = definition.version as 'voice-article-issue-1.0';
const normalize = (value: string) => value.normalize('NFC').replace(/[\s.?!。]+/g, '');

/** One target for the complete article. Ambiguous leading issues stay unresolved. */
export function selectArticleVoiceIssue(body: string, topic: VoiceTopic, proposition?: string, title = ''): string | null {
  const issues = VOICE_TOPICS[topic]?.issues;
  if (!issues) return null;
  if (proposition?.trim()) {
    const exact = Object.entries(issues).filter(([, text]) => normalize(text) === normalize(proposition));
    if (exact.length === 1) return exact[0][0];
  }
  const text = articleTextPrefix(body, VOICE_SCOPE);
  const rules = definition.rules[topic];
  const ranked = Object.entries(rules).map(([issue, patterns]) => {
    const count = (value: string) => patterns.reduce((sum, pattern) => sum + [...value.matchAll(new RegExp(pattern, 'g'))].length, 0);
    return {issue, score: count(text) + 2 * count(text.slice(0, 240)) + 3 * count(title)};
  }).sort((left, right) => right.score - left.score);
  return ranked[0]?.score > 0 && ranked[0].score !== ranked[1]?.score ? ranked[0].issue : null;
}

/** Collapse the fixed issue head into target-related versus other/none, keeping its abstention margin. */
export function relatedVoiceIssue(margins: Record<string, number> | undefined, articleIssue: string): string {
  if (!margins || !Object.hasOwn(margins, articleIssue)) return 'unknown';
  const selected = margins[articleIssue];
  const others = Object.entries(margins).filter(([issue]) => issue !== articleIssue).map(([, value]) => value);
  if (!others.length || !Number.isFinite(selected) || others.some(value => !Number.isFinite(value))) return 'unknown';
  const difference = selected - Math.max(...others);
  return difference >= VOICE_MARGIN_GAP ? articleIssue : difference <= -VOICE_MARGIN_GAP ? 'none' : 'unknown';
}
