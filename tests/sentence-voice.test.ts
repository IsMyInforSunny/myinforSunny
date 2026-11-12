import {describe,it,expect} from 'vitest';
import {voiceAnnotationInput,validateVoiceDocument,summarizeVoices,parseVoiceModel,VOICE_VERSION,VOICE_TOPICS,type VoiceDocument} from '../lib/sentence-voice';
import {compareVoiceCoordinates,type VoiceCoordinate} from '../lib/voice-comparison';

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
 const item=(id:string,publisher:string,coordinate:number):VoiceCoordinate=>({id,url:`https://example.com/${id}`,publisher,bodyHash:id,eventId:'same-event',topic:'nuclear_energy',issue,method:'svm',modelVersion:'test',version:VOICE_VERSION,coordinate,directional:3,unresolved:0,trainingOriginal:false});
 it('매체마다 3건·매체 2곳과 학습 원본 제외를 유지한다',()=>{
  const article=item('input','input',1),population=[-1,-1,-1].map((n,i)=>item(`a${i}`,'a',n)).concat([0,0,0].map((n,i)=>item(`b${i}`,'b',n)));
  const result=compareVoiceCoordinates(article,population);
  expect(result).toMatchObject({status:'ready',baseline:-.5,score:75,count:6,publisherCount:2});
  expect(result.opposing).toHaveLength(3);
  expect(compareVoiceCoordinates(article,population,['b0']).status).toBe('insufficient');
  expect(compareVoiceCoordinates(article,[...population,population[0]]).count).toBe(6);
  expect(compareVoiceCoordinates({...article,unresolved:1},population).status).toBe('input_unresolved');
 });
});
