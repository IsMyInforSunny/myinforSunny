import {describe,expect,it} from 'vitest';
import {demoAnalysis} from '../lib/fixtures';
import {makeSources} from '../lib/domain';
import {VOICE_ARTICLE_ISSUE,VOICE_INDEPENDENT_NEUTRAL,VOICE_VERSION,voiceAnnotationInput} from '../lib/sentence-voice';
import {buildIssueQuarterBaselines,type IssueQuarterArticle} from '../lib/issue-quarter-baseline';
import {articleVoiceCoordinates} from '../lib/server/voice-analysis';
import {attachIssueQuarterComparison} from '../lib/server/issue-quarter-comparison';
import {buildAnalysisScores} from '../lib/analysis-scores';

async function fixture(){
  const body='첫 번째 취재원 의견이다. 두 번째 취재원 의견이다. 세 번째 취재원 의견이다. 네 번째 취재원 의견이다.';
  const input=voiceAnnotationInput(body,'nuclear_energy');
  const analysis=structuredClone(demoAnalysis('supported'));
  analysis.mode='live';analysis.sources=makeSources({kind:'text',body,comments:[]});
  analysis.article={url:'https://example.org/input',publishedAt:'2026-08-01T00:00:00+09:00',fetchedAt:'2026-11-14T00:00:00Z',fullTextLength:body.length,analyzedCharacters:body.length,truncated:false};
  analysis.sentenceVoices={...input,method:'svm',modelVersion:'runtime-test',articleIssue:'expansion',issuePolicy:VOICE_ARTICLE_ISSUE,
    decisionPolicy:VOICE_INDEPENDENT_NEUTRAL,labels:input.sentences.map((unit,i)=>({sentenceId:unit.sentenceId,issue:'expansion',speaker:'source',direction:i===3?'uncertain':'support'}))};
  analysis.voiceCoordinates=await articleVoiceCoordinates(body,analysis.sentenceVoices,analysis.article!,[]);
  const reference=analysis.voiceCoordinates[0];
  const rows:IssueQuarterArticle[]=Array.from({length:6},(_,i)=>({...reference,id:`reference-${i}`,bodyHash:String(i).padStart(64,'0'),url:`https://example.org/${i}`,
    publisher:i<3?'dailian.co.kr':'pressian.com',coordinate:i<3?-1:1,bounds:undefined,unresolved:0}));
  return {analysis,rows,bundle:buildIssueQuarterBaselines(rows),provenance:{corpusArticleHashes:rows.map(row=>row.bodyHash)}};
}

describe('server-only quarter baseline attachment',()=>{
  it('keeps released placeholders inactive and clears stale comparisons',async()=>{
    const {analysis,bundle,provenance}=await fixture();
    attachIssueQuarterComparison(analysis,bundle,provenance);
    expect(analysis.issueQuarterComparison?.status).toBe('ready');
    attachIssueQuarterComparison(analysis);
    expect(analysis.issueQuarterComparison).toBeUndefined();
  });
  it('preserves interval scores without exposing a scalar and rejects stale identity',async()=>{
    const {analysis,bundle,provenance}=await fixture();
    attachIssueQuarterComparison(analysis,bundle,provenance);
    expect(analysis.issueQuarterComparison).toMatchObject({status:'ready',score:null,scoreRange:{lower:25,upper:50}});
    expect(buildAnalysisScores(analysis).bias).toMatchObject({status:'partial',value:null,lowerBound:25,upperBound:50});
    analysis.issueQuarterComparison!.parentAnalysisId='another-analysis';
    expect(buildAnalysisScores(analysis).bias.status).toBe('pending');
  });
  it('refuses self-membership, absent provenance, demo mode and mismatched models',async()=>{
    const {analysis,bundle,provenance}=await fixture();
    attachIssueQuarterComparison(analysis,bundle,{corpusArticleHashes:[analysis.voiceCoordinates![0].bodyHash]});
    expect(analysis.issueQuarterComparison?.status).toBe('input_in_population');
    attachIssueQuarterComparison(analysis,bundle,null);expect(analysis.issueQuarterComparison).toBeUndefined();
    analysis.mode='demo';attachIssueQuarterComparison(analysis,bundle,provenance);expect(analysis.issueQuarterComparison).toBeUndefined();
    analysis.mode='live';analysis.voiceCoordinates![0].modelVersion='other';
    attachIssueQuarterComparison(analysis,bundle,provenance);expect(analysis.issueQuarterComparison).toBeUndefined();
  });
});
