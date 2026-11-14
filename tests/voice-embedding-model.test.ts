import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseEmbeddingVoiceModel} from '../lib/voice-embedding-model';

// Synthetic shape/security evidence only; these numbers measure no real model.
const hash='a'.repeat(64);
function fixture(){
  const head=(classes:string[])=>({classes,coefficients:classes.map((_,at)=>Array.from({length:2048},(__,i):number=>i===at?1:0)),intercepts:classes.map(()=>0)});
  const runtimeHead={acceptedCount:30,abstainedCount:0,coverage:1,macroF1:.8,jointMacroF1:.8};
  return {schemaVersion:'sentence-voice-embedding-svm-1.0',status:'ready',version:'synthetic-test',definitionVersion:'sentence-voice-1.0',
    segmenter:'sentence-3.1',scopeCharacters:2000,encoder:{version:'voice-semantic-1.0',provider:'nvidia',model:'nvidia/nemotron-3.5-embed-1b',dimensions:2048,inputType:'passage',normalization:'l2'},
    topics:{nuclear_energy:{heads:{directionality:head(['directional','neutral']),polarity:head(['oppose','support']),speaker:head(['journalist','source']),issue:head(['expansion','lifetime','none','public_support'])},
      evaluation:{schemaVersion:'voice-embedding-evaluation-1.0',inputDigest:hash,humanEvaluationCount:0,ready:true,measuredPerformanceGatesPassed:true,blockers:[],maskingAgreement:1,maskingCheckCount:30,
        configuration:{embeddingModel:'nvidia/nemotron-3.5-embed-1b',dimensions:2048,normalization:'l2',C:1,classWeight:'balanced',minimumMarginGap:.15,directionStrategy:'hierarchical',selection:'Fixed synthetic fixture'},
        trainingCount:30,heldoutCount:30,trainingDirectionCounts:{neutral:10,oppose:10,support:10},heldoutDirectionCounts:{neutral:10,oppose:10,support:10},groupOverlap:0,
        rawMacroF1:.8,majorityMacroF1:.3,rawRecall:{neutral:.8,oppose:.8,support:.8},rawConfusion:[[8,1,1],[1,8,1],[1,1,8]],speakerMacroF1:.8,issueMacroF1:.8,
        runtime:{minimumMarginGap:.15,count:30,jointUsableCount:30,jointCoverage:1,jointCorrectCount:24,jointAccuracy:.8,macroF1:.8,supportRecall:.8,opposeRecall:.8,heads:{direction:{...runtimeHead},speaker:{...runtimeHead},issue:{...runtimeHead}}},
        flipChallenge:{pairAccuracy:.8,pairCount:10,itemAccuracy:.9,abstainedCount:0},meaning:'Synthetic fixture, not human accuracy.'}}},trainingArticleHashes:[hash],
    release:{schemaVersion:'voice-embedding-release-1.0',corpusDigest:hash,labelsDigest:hash,reviewDigest:hash,modelDigest:hash,vectorsDigest:hash,inputDigest:hash,trainingAllowed:true,modelDistributionAllowed:true}};
}
describe('embedding voice release parser',()=>{
  it('requires versioned policy and matching measured decision evidence before accepting independent neutral releases',()=>{
    const f:any=fixture(),policy='voice-neutral-independent-1.0';
    f.schemaVersion='sentence-voice-embedding-svm-1.1';
    expect(parseEmbeddingVoiceModel(f)).toBeNull();
    f.decisionPolicy=policy;f.topics.nuclear_energy.evaluation.configuration.decisionPolicy=policy;
    expect(parseEmbeddingVoiceModel(f)).toBeNull();
    const decision={policy,acceptedCount:30,abstainedCount:0,coverage:1,macroF1:.8,supportRecall:.8,opposeRecall:.8};
    f.topics.nuclear_energy.evaluation.runtime.directionDecision=decision;
    expect(parseEmbeddingVoiceModel(f)?.decisionPolicy).toBe(policy);
    for(const change of [{acceptedCount:31},{abstainedCount:1},{coverage:.9},{macroF1:.59},{supportRecall:.49},{policy:'unknown'}]){
      const invalid=structuredClone(f);Object.assign(invalid.topics.nuclear_energy.evaluation.runtime.directionDecision,change);
      expect(parseEmbeddingVoiceModel(invalid)).toBeNull();
    }
    f.schemaVersion='sentence-voice-embedding-svm-1.0';expect(parseEmbeddingVoiceModel(f)).toBeNull();
  });
  it('accepts a structurally consistent release fixture',()=>{
    expect(parseEmbeddingVoiceModel(fixture())?.topics.nuclear_energy.heads.issue.classes).toHaveLength(4);
    const f=fixture();
    Object.assign(f.topics.nuclear_energy.evaluation,{maskingVariantCount:120,maskingMethod:'local recomputation'});
    expect(parseEmbeddingVoiceModel(f)).not.toBeNull();
  });
  it('keeps the actual artifact null and rejects research or absent releases',()=>{
    expect(JSON.parse(readFileSync(new URL('../lib/data/voice-embedding-model.json',import.meta.url),'utf8'))).toBeNull();
    expect(parseEmbeddingVoiceModel(null)).toBeNull();
    expect(parseEmbeddingVoiceModel({...fixture(),status:'research'})).toBeNull();
    expect(parseEmbeddingVoiceModel({...fixture(),release:undefined})).toBeNull();
  });
  it('rejects encoder, provenance, or authorization mismatches',()=>{
    for(const change of [{dimensions:1024},{inputType:'query'},{provider:'other'},{model:'other'},{normalization:'none'},{version:'old'}])
      expect(parseEmbeddingVoiceModel({...fixture(),encoder:{...fixture().encoder,...change}})).toBeNull();
    expect(parseEmbeddingVoiceModel({...fixture(),release:{...fixture().release,trainingAllowed:false}})).toBeNull();
    expect(parseEmbeddingVoiceModel({...fixture(),release:{...fixture().release,inputDigest:'b'.repeat(64)}})).toBeNull();
    for(const change of [{definitionVersion:'old'},{segmenter:'old'},{scopeCharacters:3000},{trainingArticleHashes:[]},
      {trainingArticleHashes:[hash,hash]},{version:''}])
      expect(parseEmbeddingVoiceModel({...fixture(),...change})).toBeNull();
  });
  it('requires finite, nonzero 2048-column weights and exact class sets',()=>{
    for(const edit of [(f:ReturnType<typeof fixture>)=>f.topics.nuclear_energy.heads.issue.classes.pop(),
      (f:ReturnType<typeof fixture>)=>f.topics.nuclear_energy.heads.polarity.classes.splice(0,1,'neutral'),
      (f:ReturnType<typeof fixture>)=>f.topics.nuclear_energy.heads.speaker.coefficients[0].pop(),
      (f:ReturnType<typeof fixture>)=>f.topics.nuclear_energy.heads.speaker.intercepts.pop(),
      (f:ReturnType<typeof fixture>)=>f.topics.nuclear_energy.heads.directionality.coefficients[0].splice(0,1,Infinity),
      (f:ReturnType<typeof fixture>)=>f.topics.nuclear_energy.heads.polarity.coefficients.forEach(row=>row.fill(0))]){
      const f=fixture();edit(f);expect(parseEmbeddingVoiceModel(f)).toBeNull();
    }
    expect(parseEmbeddingVoiceModel({...fixture(),topics:{}})).toBeNull();
    expect(parseEmbeddingVoiceModel({...fixture(),topics:{unknown:fixture().topics.nuclear_energy}})).toBeNull();
  });
  it('enforces measured gates and honest zero human evaluation',()=>{
    for(const change of [{ready:false},{humanEvaluationCount:1},{groupOverlap:1},{rawMacroF1:.59},{majorityMacroF1:.8},
      {speakerMacroF1:.59},{issueMacroF1:.59},{maskingAgreement:.94},{maskingCheckCount:0},{blockers:['pending']},
      {rawRecall:{neutral:.8,oppose:.49,support:.8}},{measuredPerformanceGatesPassed:false}]){
      const f=fixture();Object.assign(f.topics.nuclear_energy.evaluation,change);expect(parseEmbeddingVoiceModel(f)).toBeNull();
    }
  });
  it('rejects inconsistent runtime counts, coverage and low joint head scores',()=>{
    for(const change of [{count:31},{jointUsableCount:31},{jointCoverage:.5},{jointAccuracy:.5},{jointCorrectCount:31},
      {macroF1:.59},{supportRecall:.49},{opposeRecall:.49},{minimumMarginGap:0}]){
      const f=fixture();Object.assign(f.topics.nuclear_energy.evaluation.runtime,change);expect(parseEmbeddingVoiceModel(f)).toBeNull();
    }
    for(const name of ['direction','speaker','issue'] as const){
      for(const change of [{acceptedCount:29},{abstainedCount:1},{coverage:.9},{jointMacroF1:.59}]){
        const f=fixture();Object.assign(f.topics.nuclear_energy.evaluation.runtime.heads[name],change);expect(parseEmbeddingVoiceModel(f)).toBeNull();
      }
    }
  });
  it('requires enough independent flip evidence and valid masking counts',()=>{
    for(const change of [{pairCount:9},{pairAccuracy:.49},{itemAccuracy:.49},{abstainedCount:21}]){
      const f=fixture();Object.assign(f.topics.nuclear_energy.evaluation.flipChallenge,change);expect(parseEmbeddingVoiceModel(f)).toBeNull();
    }
    const f=fixture();f.topics.nuclear_energy.evaluation.rawConfusion[0][0]=9;expect(parseEmbeddingVoiceModel(f)).toBeNull();
  });
});
