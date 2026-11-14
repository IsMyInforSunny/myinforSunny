import {describe,it,expect} from 'vitest';
import {voiceAnnotationInput,validateVoiceDocument,summarizeVoices,parseVoiceModel,voiceModelText,isVoiceBoilerplate,VOICE_VERSION,VOICE_TOPICS,VOICE_INDEPENDENT_NEUTRAL,type VoiceDocument} from '../lib/sentence-voice';
import {compareVoiceCoordinates,mainVoiceIssue,type VoiceCoordinate} from '../lib/voice-comparison';

describe('문장 목소리 연구 모델의 집계 경계',()=>{
 const body='원전 확대에 찬성한다. 원전을 더 지어야 한다. 원전 건설은 필요하다.';
 const input=voiceAnnotationInput(body,'nuclear_energy');
 const issue=Object.keys(VOICE_TOPICS.nuclear_energy.issues)[0];
 const document:VoiceDocument={...input,method:'ai',modelVersion:'test',labels:input.sentences.map(unit=>({sentenceId:unit.sentenceId,issue,direction:'support',speaker:'source'}))};
 it('취재원 방향을 집계하되 기자에게 넘기지 않는다',()=>{
  const result=summarizeVoices(body,document)!.issues[0];
  expect(result.coordinate).toBe(1);expect(result.source.coordinate).toBe(1);
  expect(result.journalist.coordinate).toBeNull();expect(result.journalist.directional).toBe(0);
 });
 it('누락·중복·알 수 없는 쟁점을 중립으로 채우지 않는다',()=>{
  const missing=validateVoiceDocument(body,{...document,labels:document.labels.slice(1)})!;
  expect(missing.labels[0].direction).toBe('uncertain');
  const duplicate=validateVoiceDocument(body,{...document,labels:[...document.labels,document.labels[0]]})!;
  expect(duplicate.labels[0].direction).toBe('uncertain');
  const invalid=validateVoiceDocument(body,{...document,labels:document.labels.map(label=>({...label,issue:'invented'}))})!;
  expect(invalid.labels.every(label=>label.direction==='uncertain')).toBe(true);
 });
 it('방향 문장 3개 미만과 화자 불명확은 좌표를 유보한다',()=>{
  const result=summarizeVoices(body,{...document,labels:document.labels.map((label,i)=>i===0?{...label,speaker:'unknown'}:label)})!;
  expect(result.issues[0].directional).toBe(2);expect(result.issues[0].coordinate).toBeNull();
 });
 it('미등록·미검토 모델을 활성화하지 않는다',()=>{
  expect(parseVoiceModel(null)).toBeNull();expect(parseVoiceModel({status:'ready',topics:{}})).toBeNull();
 });
 it('keeps old semantics and separates a neutral decision from unknown speaker/issue only with explicit policy',()=>{
  const labels=document.labels.map(label=>({...label,direction:'neutral' as const,issue:'unknown',speaker:'unknown' as const}));
  const old=summarizeVoices(body,{...document,labels})!;
  expect(old.unresolved).toBe(3);
  const proposed={...document,labels,decisionPolicy:VOICE_INDEPENDENT_NEUTRAL};
  const valid=validateVoiceDocument(body,proposed)!;
  expect(valid.labels.every(label=>label.direction==='neutral'&&label.issue==='unknown'&&label.speaker==='unknown')).toBe(true);
  const summary=summarizeVoices(body,valid)!;
  expect(summary.unresolved).toBe(0);
  expect(summary.uncertainty).toEqual({direction:0,issue:3,speaker:3});
  expect(summary.issues.every(issue=>issue.coordinate===null&&issue.evidence.unresolved===0)).toBe(true);
  expect(validateVoiceDocument(body,valid)).toEqual(valid);
 });
 it('new policy never accepts unresolved directional claims, missing labels or invented issues as neutral',()=>{
  for(const change of [{speaker:'unknown' as const},{speaker:'mixed' as const},{issue:'unknown'},{issue:'none'}]){
   const summary=summarizeVoices(body,{...document,decisionPolicy:VOICE_INDEPENDENT_NEUTRAL,
    labels:document.labels.map(label=>({...label,...change}))})!;
   expect(summary.unresolved).toBe(3);
   expect(summary.issues.every(issue=>issue.coordinate===null)).toBe(true);
  }
  const neutral={...document,decisionPolicy:VOICE_INDEPENDENT_NEUTRAL,
   labels:document.labels.map(label=>({...label,direction:'neutral' as const,issue:'invented'}))};
  expect(summarizeVoices(body,neutral)!.unresolved).toBe(3);
  expect(summarizeVoices(body,{...neutral,labels:[]})!.unresolved).toBe(3);
  expect(validateVoiceDocument(body,{...document,decisionPolicy:'invented' as typeof VOICE_INDEPENDENT_NEUTRAL})).toBeNull();
 });
 it('only retains a coordinate when the remaining unknown heads belong to confidently neutral sentences',()=>{
  const extended=body+' 관련 자료가 발표되었다.';
  const units=voiceAnnotationInput(extended,'nuclear_energy').sentences;
  const labels=[...document.labels,{sentenceId:units[3].sentenceId,issue:'unknown',direction:'neutral' as const,speaker:'unknown' as const}];
  const proposed={...document,labels,decisionPolicy:VOICE_INDEPENDENT_NEUTRAL};
  expect(mainVoiceIssue(extended,{...document,labels})?.coordinate).toBeNull();
  expect(mainVoiceIssue(extended,proposed)).toMatchObject({coordinate:1,directional:3,unresolved:0});
  expect(mainVoiceIssue(extended,{...proposed,labels:labels.map((label,i)=>i===3?{...label,direction:'uncertain'}:label)})?.coordinate).toBeNull();
 });
 it('metadata is explicitly excluded without turning real unresolved content into neutral',()=>{
  const metadataBody=body+'\nAD\n#원전\nⓒ취재원';
  const scope=voiceAnnotationInput(metadataBody,'nuclear_energy');
  const labels=scope.sentences.map(unit=>({sentenceId:unit.sentenceId,issue,direction:'support' as const,speaker:'source' as const}));
  const result=validateVoiceDocument(metadataBody,{...document,labels})!;
  const summary=summarizeVoices(metadataBody,result)!;
  expect(summary.excluded).toBe(3);expect(summary.unresolved).toBe(0);
  expect(summary.issues[0].coordinate).toBe(1);
  const spoof=validateVoiceDocument(body,{...document,labels:document.labels.map(label=>({...label,excluded:true}))})!;
  expect(summarizeVoices(body,spoof)!.excluded).toBe(0);
  expect(spoof.labels.every(label=>label.direction==='uncertain')).toBe(true);
 });
 it('shared feature rules unify synonyms and numbers without rewriting evidence',()=>{
  expect(voiceModelText('핵 발전소 12기')).toBe('원전 0기');
  expect(voiceModelText('원자력발전소 99기')).toBe('원전 0기');
  expect(isVoiceBoilerplate('무단 전재 및 재배포 금지')).toBe(true);
  expect(isVoiceBoilerplate('원전 확대에 반대한다.')).toBe(false);
  expect(isVoiceBoilerplate('Copyright law reform needs public discussion.')).toBe(false);
  expect(isVoiceBoilerplate('무단 전재를 막기 위한 법 개정이 논의된다.')).toBe(false);
 });
 const item=(id:string,publisher:string,coordinate:number):VoiceCoordinate=>({id,url:`https://example.com/${id}`,publisher,bodyHash:id,eventId:'same-event',topic:'nuclear_energy',issue,method:'svm',modelVersion:'test',version:VOICE_VERSION,coordinate,directional:3,unresolved:0,trainingOriginal:false});
 it('매체마다 3건·매체 2곳과 학습 원본 제외를 유지한다',()=>{
  const article=item('input','input',1),population=[-1,-1,-1].map((n,i)=>item(`a${i}`,'a',n)).concat([0,0,0].map((n,i)=>item(`b${i}`,'b',n)));
  const result=compareVoiceCoordinates(article,population);
  expect(result).toMatchObject({status:'ready',baseline:-.5,score:75,count:6,publisherCount:2});
  expect(result.opposing).toHaveLength(3);
  expect(compareVoiceCoordinates(article,population,['b0']).status).toBe('insufficient');
  expect(compareVoiceCoordinates(article,[...population,population[0]]).count).toBe(6);
  expect(compareVoiceCoordinates({...article,unresolved:1},population).status).toBe('input_unresolved');
  expect(compareVoiceCoordinates({...article,decisionPolicy:VOICE_INDEPENDENT_NEUTRAL},population).status).toBe('insufficient');
  expect(compareVoiceCoordinates({...article,decisionPolicy:VOICE_INDEPENDENT_NEUTRAL},population.map(row=>({...row,decisionPolicy:VOICE_INDEPENDENT_NEUTRAL}))).status).toBe('ready');
  const centered=compareVoiceCoordinates({...article,coordinate:-.5},population);
  expect(centered.score).toBe(0);expect(centered.opposing).toHaveLength(0);
  expect(centered.similar).toHaveLength(6);
  const live={...article,eventId:'live:'+ 'a'.repeat(64),publishedAt:'2026-11-04T00:00:00Z'};
  const livePopulation=population.map((row,i)=>({...row,eventId:live.eventId,publishedAt:i<3?'2026-11-01T00:00:00Z':'2026-11-07T00:00:00Z'}));
  expect(compareVoiceCoordinates(live,livePopulation).status).toBe('inconsistent_period');
  expect(compareVoiceCoordinates(live,livePopulation.map(row=>({...row,publishedAt:'2026-11-04T00:00:00Z'}))).status).toBe('ready');
 });
});
