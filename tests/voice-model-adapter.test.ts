import {describe,it,expect} from 'vitest';
import {demoAnalysis,demoVerification} from '../lib/fixtures';
import {voiceAnnotationInput,VOICE_VERSION,validateVoiceDocument,summarizeVoices} from '../lib/sentence-voice';
import {voiceAssessmentFromResearch} from '../lib/voice-model-adapter';
import {mainVoiceIssue,type VoiceCoordinate} from '../lib/voice-comparison';
import {buildAnalysisScores} from '../lib/analysis-scores';
import type {ResearchVerification} from '../lib/research-contract';

// Only wiring/security fixtures; actual model parity is checked separately on
// retained real articles by scripts/check-voice-runtime.mjs.
function fixture(){
 const analysis=structuredClone(demoAnalysis('supported'));analysis.mode='live';
 const body=analysis.sources[0].text,scope=voiceAnnotationInput(body,'nuclear_energy');
 analysis.sentenceVoices={...scope,method:'svm',modelVersion:'wiring-only',labels:scope.sentences.map(unit=>({sentenceId:unit.sentenceId,issue:'expansion',direction:'support',speaker:'source'}))};
 const coordinate=(id:string,publisher:string,value:number):VoiceCoordinate=>({id,url:`https://${publisher}/${id}`,
   publisher,bodyHash:id,eventId:'event-fixture',topic:'nuclear_energy',issue:'expansion',method:'svm',modelVersion:'wiring-only',version:VOICE_VERSION,
   coordinate:value,directional:3,unresolved:0,trainingOriginal:false});
 analysis.voiceCoordinates=[coordinate('input','input.test',1)];
 const result:ResearchVerification={...structuredClone(demoVerification('supported')),mode:'live',parentAnalysisId:analysis.analysisId,researchPlanId:'current'};
 result.references=Array.from({length:6},(_,i)=>{
  const item=coordinate(`ref${i}`,i<3?'a.test':'b.test',i<3?-1:0);
  return {id:item.id,url:item.url,provenance:'web_fetched',text:'wiring fixture',truncated:false,
   publishedAt:'2026-01-01T00:00:00Z',fetchedAt:'2026-01-02T00:00:00Z',retrievedTruncated:false,voiceCoordinates:[item]};
 });
 return {analysis,result};
}
describe('server-classified voice records to scores',()=>{
 it('connects equal publisher weight and centroid distance to the displayed score',()=>{
  const {analysis,result}=fixture();
  const assessed=voiceAssessmentFromResearch(analysis,[result]);
  expect(assessed).toMatchObject({status:'ready',score:75,magnitude:1.5,baseline:-.5,count:6,publisherCount:2});
  expect(buildAnalysisScores(analysis,null,undefined,assessed).bias).toMatchObject({status:'ready',value:75,numerator:1.5,denominator:2});
 });
 it('rejects old analyses, superseded plans, changed models and training originals',()=>{
  const {analysis,result}=fixture();
  expect(voiceAssessmentFromResearch(analysis,[{...result,parentAnalysisId:'old'}]).score).toBeNull();
  expect(voiceAssessmentFromResearch(analysis,[result,{...result,researchPlanId:'new',references:[]}]).score).toBeNull();
  result.references[0].voiceCoordinates![0].trainingOriginal=true;
  expect(voiceAssessmentFromResearch(analysis,[result]).score).toBeNull();
  result.references[0].voiceCoordinates![0].trainingOriginal=false;
  result.references[0].voiceCoordinates![0].modelVersion='old';
  expect(voiceAssessmentFromResearch(analysis,[result]).score).toBeNull();
 });
 it('requires real same-event identities and prevents spoofed reference URLs',()=>{
  const {analysis,result}=fixture();
  analysis.voiceCoordinates![0].eventId='';
  expect(voiceAssessmentFromResearch(analysis,[result]).status).toBe('event_missing');
  analysis.voiceCoordinates![0].eventId='event-fixture';
  result.references[0].url='https://other.test/ref0';
  expect(voiceAssessmentFromResearch(analysis,[result]).score).toBeNull();
 });
 it('unknown issues remain unresolved and cannot produce a confident headline coordinate',()=>{
  const {analysis}=fixture(),body=analysis.sources[0].text;
  const document=analysis.sentenceVoices!;
  const labels=document.labels.map((label,index)=>index===0?{...label,issue:'unknown',direction:'neutral' as const}:label);
  const normalized=validateVoiceDocument(body,{...document,labels})!;
  expect(normalized.labels[0].direction).toBe('uncertain');
  expect(summarizeVoices(body,normalized)!.unresolved).toBe(1);
  expect(mainVoiceIssue(body,normalized)?.coordinate??null).toBeNull();
 });
});
