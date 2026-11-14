import {describe,it,expect} from 'vitest';
import {voiceEvidenceBounds,voiceAnnotationInput,summarizeVoices,type VoiceDocument} from '../lib/sentence-voice';

describe('article evidence bounds',()=>{
 it('encloses every possible neutral/support/oppose assignment of unresolved sentences',()=>{
  for(let support=0;support<=5;support++)for(let oppose=0;oppose<=5;oppose++)for(let unknown=0;unknown<=5;unknown++){
   const bounds=voiceEvidenceBounds(support,oppose,unknown);
   for(let addedSupport=0;addedSupport<=unknown;addedSupport++)for(let addedOppose=0;addedOppose<=unknown-addedSupport;addedOppose++){
    const count=support+oppose+addedSupport+addedOppose;if(!count)continue;
    const coordinate=(support-oppose+addedSupport-addedOppose)/count;
    expect(coordinate).toBeGreaterThanOrEqual(bounds.lower!-1e-12);
    expect(coordinate).toBeLessThanOrEqual(bounds.upper!+1e-12);
   }
  }
 });
 it('does not report a neutral score for missing directional evidence',()=>{
  expect(voiceEvidenceBounds(0,0,0)).toMatchObject({observedCoordinate:null,lower:null,upper:null,state:'insufficient'});
  expect(voiceEvidenceBounds(0,0,2)).toMatchObject({observedCoordinate:null,lower:-1,upper:1,state:'insufficient'});
  expect(voiceEvidenceBounds(3,1,2)).toMatchObject({observedCoordinate:.5,lower:0,upper:2/3,state:'partial'});
  expect(voiceEvidenceBounds(3,1,0)).toMatchObject({lower:.5,upper:.5,state:'resolved'});
  for(const invalid of [-1,.5,NaN,Infinity])expect(()=>voiceEvidenceBounds(3,1,invalid)).toThrow();
 });
 it('counts unknown-issue evidence for every issue without altering original labels',()=>{
  const body='첫 번째 문장이다. 두 번째 문장이다. 세 번째 문장이다. 네 번째 문장이다.';
  const input=voiceAnnotationInput(body,'nuclear_energy');
  const document:VoiceDocument={...input,method:'svm',modelVersion:'test',labels:input.sentences.map((unit,i)=>({sentenceId:unit.sentenceId,
   issue:i===3?'unknown':'expansion',direction:i===3?'uncertain':'support',speaker:'source'}))};
  const original=JSON.stringify(document),summary=summarizeVoices(body,document)!;
  expect(summary.issues.every(issue=>issue.evidence.unresolved===1)).toBe(true);
  expect(summary.issues.find(issue=>issue.issue==='expansion')?.evidence).toMatchObject({observedCoordinate:1,lower:.5,upper:1});
  expect(JSON.stringify(document)).toBe(original);
 });
});
