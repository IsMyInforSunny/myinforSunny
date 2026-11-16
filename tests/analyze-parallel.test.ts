import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {analyze} from '../lib/server/analyze';
import {makeSources} from '../lib/domain';
import {voiceAnnotationInput,VOICE_ARTICLE_ISSUE,VOICE_INDEPENDENT_NEUTRAL,type VoiceDocument} from '../lib/sentence-voice';
import type {Analysis,TextRequest} from '../lib/contracts';

const calls=vi.hoisted(()=>({structured:vi.fn(),embedding:vi.fn(),stored:vi.fn(),attach:vi.fn()}));
vi.mock('../lib/server/language',()=>({structured:calls.structured}));
vi.mock('../lib/server/voice-embedding',()=>({
  inferEmbeddingVoices:calls.embedding,
  releasedEmbeddingVoiceModel:{version:'parallel-boundary-fixture',decisionPolicy:'voice-neutral-independent-1.0',topics:{nuclear_energy:{heads:{}}}},
}));
vi.mock('../lib/server/precomputed-voices',()=>({readPrecomputedVoiceDocument:calls.stored}));
vi.mock('../lib/server/voice-analysis',()=>({releasedVoiceModel:null,attachVoiceCoordinates:calls.attach}));

// These short fictional statements check scheduling and cancellation only.
// They do not train a model or measure article-analysis quality.
const request:TextRequest={kind:'text',body:'원전 확대가 논의됐다. 원전 건설에 관한 공개 가상 문장이다. 원전 정책을 살펴본다.',
  comments:[],proposition:'원자력 발전·신규 원전 건설을 확대해야 한다.'};
const config={AI_PROVIDER:'nvidia',NVIDIA_API_KEY:'synthetic-not-a-real-key'};
function deferred<T>(){
  let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function rawOutput(){
  const body=makeSources(request)[0],first=body.sentences[0];
  const citationBalanceSentences=voiceAnnotationInput(request.body,'nuclear_energy').sentences;
  return {clearSentenceIds:body.sentences.map(sentence=>sentence.id),
    citationBalanceLabels:citationBalanceSentences.map(unit=>[unit.sentenceId,'R','0','J'] as const),
    topics:[{id:'reactor',label:'원전 토론',description:'공개 가상 자료',evidence:[{sentenceId:first.id,quote:body.text.slice(first.start,first.end)}]}],
    topicAssignments:[],stances:[],bodyAssigned:body.sentences.map(sentence=>({sentenceId:sentence.id,topicIds:['reactor']})),
    bodyOtherIds:[],bodyUndeterminedIds:[],expressions:[],claims:[],perspectiveQuestions:[],counterArguments:[],searchSuggestions:[],claimsMayBeOmitted:false};
}
function voiceOutput():VoiceDocument{
  const input=voiceAnnotationInput(request.body,'nuclear_energy');
  return {...input,method:'svm',modelVersion:'parallel-boundary-fixture',decisionPolicy:VOICE_INDEPENDENT_NEUTRAL,
    articleIssue:'expansion',issuePolicy:VOICE_ARTICLE_ISSUE,
    labels:input.sentences.map(unit=>({sentenceId:unit.sentenceId,issue:'expansion',direction:'neutral',speaker:'journalist'}))};
}

beforeEach(()=>{
  calls.structured.mockReset();calls.embedding.mockReset();calls.stored.mockReset();calls.attach.mockReset();
  calls.stored.mockResolvedValue(null);calls.attach.mockImplementation(async(value:Analysis)=>value);
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unexpected network request in scheduling fixture');}));
});
afterEach(()=>vi.unstubAllGlobals());

describe('parallel analysis request boundaries',()=>{
  it('starts both providers before either resolves and waits for the embedding result',async()=>{
    const language=deferred<ReturnType<typeof rawOutput>>(),embedding=deferred<VoiceDocument>();
    calls.structured.mockReturnValue(language.promise);calls.embedding.mockReturnValue(embedding.promise);
    let completed=false;
    const result=analyze(request,config,'parallel-fixture',new AbortController().signal,{article:true}).then(value=>{completed=true;return value;});
    await vi.waitFor(()=>{expect(calls.structured).toHaveBeenCalledTimes(1);expect(calls.embedding).toHaveBeenCalledTimes(1);});
    expect(completed).toBe(false);
    expect(calls.embedding.mock.calls[0][6]).toBe('expansion');
    language.resolve(rawOutput());await Promise.resolve();await Promise.resolve();
    expect(completed).toBe(false);
    const voices=voiceOutput();embedding.resolve(voices);
    expect((await result).sentenceVoices).toEqual(voices);
    expect((await result).citationBalance).toMatchObject({method:'ai',modelVersion:'nvidia/nemotron-3.5-lightning-30b-a3b',proposition:request.proposition,
      labels:[{sentenceId:'body_s0',relevance:'related',direction:'neutral',speaker:'journalist'},
        {sentenceId:'body_s1',relevance:'related',direction:'neutral',speaker:'journalist'},
        {sentenceId:'body_s2',relevance:'related',direction:'neutral',speaker:'journalist'}]});
    expect(calls.attach).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('aborts and settles the embedding sibling before returning an LLM failure',async()=>{
    const language=deferred<ReturnType<typeof rawOutput>>(),embedding=deferred<VoiceDocument>();
    calls.structured.mockReturnValue(language.promise);calls.embedding.mockReturnValue(embedding.promise);
    let settled=false;
    const observed=analyze(request,config,'cancel-parallel-fixture',new AbortController().signal,{article:true})
      .then(value=>{settled=true;return {value,error:null};},error=>{settled=true;return {value:null,error};});
    await vi.waitFor(()=>{expect(calls.structured).toHaveBeenCalledTimes(1);expect(calls.embedding).toHaveBeenCalledTimes(1);});
    const embeddingSignal=calls.embedding.mock.calls[0][3] as AbortSignal;
    expect(embeddingSignal.aborted).toBe(false);
    const failure=new Error('Fictional LLM failure');language.reject(failure);
    await vi.waitFor(()=>expect(embeddingSignal.aborted).toBe(true));
    expect(settled).toBe(false);
    embedding.reject(new DOMException('Fictional embedding cleanup complete','AbortError'));
    expect((await observed).error).toBe(failure);
    expect(calls.attach).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
