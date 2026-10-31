import {describe,expect,it} from 'vitest';
import {headSchema,inferHead} from '../lib/model-head';
import parity from './fixtures/svm-parity.json';
const head=()=>headSchema.parse({schemaVersion:'svm-head-1.0',task:'expression_binary',labels:['clear','flagged'],releaseStatus:'synthetic-test-only',encoderVersion:'synthetic-v1',dimension:2,scaler:{mean:[1,2],scale:[2,4]},linear:{weights:[2,-1],bias:.5},calibration:{method:'held-out-logistic-sigmoid',weight:1,bias:0},abstain:{low:.35,high:.65},trainingDataHash:'0'.repeat(64)});
describe('직접 학습한 선형 SVM head의 브라우저 계산',()=>{
 it('실제 Python 학습 artifact와 margin·보정값이 일치한다',()=>{
  const exported=headSchema.parse(parity.head);
  parity.vectors.forEach((vector,i)=>{
   const result=inferHead(exported,vector,exported.encoderVersion);
   expect(result.margin).toBeCloseTo(parity.expectedMargins[i],10);
   expect(result.probability).toBeCloseTo(parity.expectedProbabilities[i],10);
  });
 });
 it('scaler·선형 margin·보정 순서를 적용한다',()=>{const result=inferHead(head(),[3,6],'synthetic-v1');expect(result.margin).toBe(1.5);expect(result.probability).toBeCloseTo(1/(1+Math.exp(-1.5)),10);expect(result.label).toBe('flagged');});
 it('경계 부근에서 유보한다',()=>{expect(inferHead(head(),[.5,2],'synthetic-v1').label).toBe('undetermined');});
 it('차원·NaN·encoder 버전·잘못된 scale을 거절한다',()=>{for(const input of [[1],[NaN,2]])expect(()=>inferHead(head(),input,'synthetic-v1')).toThrow();expect(()=>inferHead(head(),[1,2],'other')).toThrow();expect(()=>headSchema.parse({...head(),scaler:{mean:[1,2],scale:[0,1]}})).toThrow();});
 it('합성 artifact의 상태를 운영 모델로 바꾸지 않는다',()=>{expect(inferHead(head(),[1,2],'synthetic-v1').releaseStatus).toBe('synthetic-test-only');});
});
