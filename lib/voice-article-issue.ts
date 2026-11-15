import definition from './data/voice-article-issue-rules.json';
import {VOICE_MARGIN_GAP, VOICE_TOPICS, VOICE_SCOPE, type VoiceTopic} from './sentence-voice';
import {articleTextPrefix} from './server/article-document';

export const VOICE_ARTICLE_ISSUE_POLICY = definition.version as 'voice-article-issue-1.0';
const normalize = (value: string) => value.normalize('NFC').replace(/[\s.?!。]+/g, '');

export type ArticleVoiceIssueSelection={issues:string[];source:'explicit'|'rules'|'llm_exact'|'two_primary'|'unassigned';scores:{issue:string;score:number}[]};
const exactIssue=(topic:VoiceTopic,proposition?:string)=>{
  if(!proposition?.trim())return null;
  const matches=Object.entries(VOICE_TOPICS[topic]?.issues??{}).filter(([, text])=>normalize(text)===normalize(proposition));
  return matches.length===1?matches[0][0]:null;
};

/** Exactly two equally leading issues are retained for offline articles. No
 * middle point or arbitrary two-of-three tie-break is introduced. */
export function selectArticleVoiceIssues(body:string,topic:VoiceTopic,proposition?:string,title='',llmProposition?:string):ArticleVoiceIssueSelection{
  const issues = VOICE_TOPICS[topic]?.issues;
  if(!issues)return {issues:[],source:'unassigned',scores:[]};
  const explicit=exactIssue(topic,proposition);
  if(explicit)return {issues:[explicit],source:'explicit',scores:[]};
  const text = articleTextPrefix(body, VOICE_SCOPE);
  const rules = definition.rules[topic];
  const ranked = Object.entries(rules).map(([issue, patterns]) => {
    const count = (value: string) => patterns.reduce((sum, pattern) => sum + [...value.matchAll(new RegExp(pattern, 'g'))].length, 0);
    return {issue, score: count(text) + 2 * count(text.slice(0, 240)) + 2 * count(title)};
  }).sort((left,right)=>right.score-left.score||left.issue.localeCompare(right.issue));
  const leading=ranked[0]?.score>0?ranked.filter(item=>item.score===ranked[0].score):[];
  if(leading.length===1)return {issues:[leading[0].issue],source:'rules',scores:ranked};
  // Only the already validated proposition from this same analysis may resolve a
  // tie. A noncanonical user proposition is retained by the body-position guard;
  // it cannot map to an unrelated issue unless the model states that exact issue.
  const fallback=!explicit?exactIssue(topic,llmProposition):null;
  if(fallback)return {issues:[fallback],source:'llm_exact',scores:ranked};
  return {issues:leading.length===2?leading.map(item=>item.issue):[],source:leading.length===2?'two_primary':'unassigned',scores:ranked};
}

/** Live callers request one target; offline callers explicitly use the plural
 * selector above and compute both retained issue documents. */
export function selectArticleVoiceIssue(body:string,topic:VoiceTopic,proposition?:string,title='',llmProposition?:string):string|null{
  const selected=selectArticleVoiceIssues(body,topic,proposition,title,llmProposition);
  return selected.issues.length===1?selected.issues[0]:null;
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
