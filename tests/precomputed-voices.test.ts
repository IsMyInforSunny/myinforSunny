import {describe,expect,it} from 'vitest';
import {voiceAnnotationInput,voiceArticleHash,VOICE_ARTICLE_ISSUE,VOICE_INDEPENDENT_NEUTRAL,VOICE_SCOPE,VOICE_VERSION,type VoiceDocument} from '../lib/sentence-voice';
import {readPrecomputedVoiceDocument} from '../lib/server/precomputed-voices';

async function fixture(){
  const body='First quoted policy opinion. Second quoted policy opinion. Third quoted policy opinion.';
  const input=voiceAnnotationInput(body,'nuclear_energy');
  const document:VoiceDocument={...input,method:'svm',modelVersion:'released-test-model',decisionPolicy:VOICE_INDEPENDENT_NEUTRAL,
    articleIssue:'expansion',issuePolicy:VOICE_ARTICLE_ISSUE,labels:input.sentences.map(unit=>({sentenceId:unit.sentenceId,issue:'expansion',direction:'support',speaker:'source'}))};
  const expected={modelVersion:document.modelVersion,decisionPolicy:VOICE_INDEPENDENT_NEUTRAL,topic:'nuclear_energy' as const,articleIssue:'expansion'};
  const artifact={schemaVersion:'precomputed-voices-1.0',researchOnly:false,usageReviewed:true,modelVersion:document.modelVersion,
    decisionPolicy:VOICE_INDEPENDENT_NEUTRAL,issuePolicy:VOICE_ARTICLE_ISSUE,definitionVersion:VOICE_VERSION,
    segmenter:input.segmenter,scopeCharacters:VOICE_SCOPE,documents:{[await voiceArticleHash(body)]:document}};
  return {body,document,expected,artifact};
}

describe('reviewed precomputed voice documents',()=>{
  it('reuses an exact document while isolating mutations of returned labels',async()=>{
    const {body,expected,artifact,document}=await fixture();
    const first=await readPrecomputedVoiceDocument(body,expected,artifact);
    expect(first).toEqual(document);
    first!.labels[0].direction='oppose';
    expect((await readPrecomputedVoiceDocument(body,expected,artifact))!.labels[0].direction).toBe('support');
  });
  it('keeps research artifacts and the empty deployment placeholder inactive',async()=>{
    const {body,expected,artifact}=await fixture();
    expect(await readPrecomputedVoiceDocument(body,expected)).toBeNull();
    expect(await readPrecomputedVoiceDocument(body,expected,{...artifact,researchOnly:true})).toBeNull();
    expect(await readPrecomputedVoiceDocument(body,expected,{...artifact,usageReviewed:false})).toBeNull();
  });
  it('rejects body, model, target, definition and policy changes',async()=>{
    const {body,expected,artifact}=await fixture();
    expect(await readPrecomputedVoiceDocument(body+' New fact.',expected,artifact)).toBeNull();
    for(const change of [{modelVersion:'another'},{decisionPolicy:'legacy'},{articleIssue:'lifetime'},{topic:'minimum_wage' as const}])
      expect(await readPrecomputedVoiceDocument(body,{...expected,...change},artifact)).toBeNull();
    expect(await readPrecomputedVoiceDocument(body,expected,{...artifact,scopeCharacters:8000})).toBeNull();
  });
  it('does not turn damaged stored labels into a successful cache hit',async()=>{
    const {body,expected,artifact,document}=await fixture();
    document.labels[0].issue='unknown';
    expect(await readPrecomputedVoiceDocument(body,expected,artifact)).toBeNull();
    document.labels[0].sentenceId='off-body';
    expect(await readPrecomputedVoiceDocument(body,expected,artifact)).toBeNull();
    document.labels[0]=null as unknown as typeof document.labels[number];
    expect(await readPrecomputedVoiceDocument(body,expected,artifact)).toBeNull();
  });
});
