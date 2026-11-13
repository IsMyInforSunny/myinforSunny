import {describe,it,expect} from 'vitest';
import {inferVoices,parseVoiceModel,VOICE_VERSION,VOICE_MARGIN_GAP} from '../lib/sentence-voice';

// Artificial weights exercise release parsing and numeric failure only.
// They are never written to product artifacts or used for accuracy claims.
function fixture(){
 const hash='a'.repeat(64),head=(classes:string[])=>({classes,coefficients:classes.map((_,i)=>[i+1,i+1]),intercepts:classes.map((_,i)=>i*2)});
 const metric={acceptedCount:10,abstainedCount:0,coverage:1,macroF1:.8,jointMacroF1:.8};
 return {schemaVersion:'sentence-voice-svm-1.0',version:'numeric-fixture-only',status:'ready',segmenter:'sentence-3.1',
  definitionVersion:VOICE_VERSION,scopeCharacters:2000,trainerVersion:'sentence-voice-trainer-1.2',trainingConfig:{minimumMarginGap:VOICE_MARGIN_GAP,encoderVersion:'voice-context-1.0',contextSentences:1,currentRepeats:2},
  trainingArticleHashes:[hash],release:{schemaVersion:'voice-release-1.0',corpusDigest:hash,labelsDigest:hash,reviewDigest:hash,modelDigest:hash,trainingAllowed:true,modelDistributionAllowed:true},
  topics:{nuclear_energy:{vectorizer:{vocabulary:{'원전':0,'확대':1},idf:[1,1]},
   direction:head(['neutral','oppose','support']),speaker:head(['journalist','source']),issue:head(['none','expansion']),
   evaluation:{ready:true,groupOverlap:0,heldoutArticleCount:3,macroF1:.8,majorityMacroF1:.3,supportRecall:.8,opposeRecall:.8,
    speakerMacroF1:.8,issueMacroF1:.8,maskingAgreement:1,flipAccuracy:.8,independentFlipPairCount:10,
    flipChallenge:{pairAccuracy:.8,pairCount:10,itemAccuracy:.9,abstainedCount:0},classCounts:{neutral:10,support:10,oppose:10},
    runtime:{minimumMarginGap:VOICE_MARGIN_GAP,count:10,jointUsableCount:10,jointCoverage:1,jointCorrectCount:8,jointAccuracy:.8,
     macroF1:.8,supportRecall:.8,opposeRecall:.8,heads:{direction:{...metric},speaker:{...metric},issue:{...metric}}}}}}};
}
describe('portable voice model runtime boundaries',()=>{
 it('requires actual-service abstention metrics and independent pair challenge fields',()=>{
  const value=fixture();expect(parseVoiceModel(value)).not.toBeNull();
  const {runtime,...old}=value.topics.nuclear_energy.evaluation;
  expect(parseVoiceModel({...value,topics:{nuclear_energy:{...value.topics.nuclear_energy,evaluation:old}}})).toBeNull();
  value.topics.nuclear_energy.evaluation.runtime.opposeRecall=.1;
  expect(parseVoiceModel(value)).toBeNull();
 });
 it('rejects inconsistent coverage and fake challenge pair counts',()=>{
  const value=fixture();value.topics.nuclear_energy.evaluation.runtime.jointCoverage=.4;
  expect(parseVoiceModel(value)).toBeNull();
  const other=fixture();other.topics.nuclear_energy.evaluation.flipChallenge.pairCount=11;
  expect(parseVoiceModel(other)).toBeNull();
 });
 it('withholds overflowed feature rows instead of classifying with intercepts alone',()=>{
  const value=fixture();value.topics.nuclear_energy.vectorizer.idf=[Number.MAX_VALUE,Number.MAX_VALUE];
  const model=parseVoiceModel(value)!;expect(model).not.toBeNull();
  const result=inferVoices(model,'원전 원전 확대 확대.','nuclear_energy')!;
  expect(result.labels[0]).toMatchObject({direction:'uncertain',speaker:'unknown',issue:'unknown'});
 });
});
