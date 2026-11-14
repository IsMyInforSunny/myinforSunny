import {describe,expect,it} from 'vitest';
import {demoAnalysis} from '../lib/fixtures';
import {issueVoiceArticleContext,readVoiceArticleContext} from '../lib/server/voice-article-context';
import {readResearchToken} from '../lib/server/research-token';
import {buildReviewExport} from '../lib/review-export';

// Authentication fixtures only; no classification/accuracy claims.
const config={AI_PROVIDER:'nvidia',IP_HASH_SECRET:'context-test-only'};
const request=(actor='192.0.2.1')=>new Request('https://site.test/api/analyze',{headers:{'CF-Connecting-IP':actor}});
function article(){const result=structuredClone(demoAnalysis('supported'));result.mode='live';
 result.article={url:'https://news.test/article',title:'metadata fixture',publishedAt:'2026-11-14T00:00:00Z',
  fetchedAt:'2026-11-14T00:01:00Z',fullTextLength:result.sources[0].text.length,analyzedCharacters:result.sources[0].text.length,truncated:false};return result;}
describe('server-signed article metadata',()=>{
 it('binds fetched URL/date to the exact body without mutating the public cache value',async()=>{
  const analysis=article(),token=await issueVoiceArticleContext(request(),config,analysis);
  expect(token).toBeTruthy();expect(analysis.articleContextToken).toBeUndefined();
  const decoded=await readVoiceArticleContext(request(),config,{sources:analysis.sources,articleContextToken:token});
  expect(decoded?.article.url).toBe(analysis.article!.url);expect(decoded?.article.publishedAt).toBe(analysis.article!.publishedAt);
  expect(JSON.stringify(decoded)).not.toContain(analysis.sources[0].text);
 });
 it('rejects changed bodies, different actors and reuse as an evidence token',async()=>{
  const analysis=article(),token=(await issueVoiceArticleContext(request(),config,analysis))!;
  const changed=structuredClone(analysis.sources);changed[0].text+=' changed';
  await expect(readVoiceArticleContext(request(),config,{sources:changed,articleContextToken:token})).rejects.toMatchObject({code:'RESEARCH_INPUT_CHANGED'});
  await expect(readVoiceArticleContext(request('192.0.2.2'),config,{sources:analysis.sources,articleContextToken:token})).rejects.toBeDefined();
  await expect(readResearchToken(request(),config,token,'evidence')).rejects.toBeDefined();
 });
 it('does not sign demo or pasted-text inputs',async()=>{
  expect(await issueVoiceArticleContext(request(),config,demoAnalysis('supported'))).toBeUndefined();
  const analysis=article();delete analysis.article;
  expect(await issueVoiceArticleContext(request(),config,analysis)).toBeUndefined();
 });
 it('never includes the short-lived token in a user-exported report',()=>{
  const analysis=article();analysis.articleContextToken='signed-test-capability';
  const exported=buildReviewExport({analysis,checks:[],feedback:'',includeRaw:true,includeRefs:false,
   verifications:[],researchResults:[],researchStage:'not_started'});
  expect(exported.analysis).not.toHaveProperty('articleContextToken');
 });
});
