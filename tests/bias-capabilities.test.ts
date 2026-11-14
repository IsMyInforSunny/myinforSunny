import {describe,it,expect,vi} from 'vitest';
vi.mock('../lib/server/config',()=>({runtimeConfig:async()=>({}),capabilities:()=>({live:false})}));
vi.mock('../lib/server/voice-analysis',()=>({releasedVoiceModel:null,releasedEmbeddingVoiceModel:null}));
import {GET} from '../app/api/capabilities/route';
describe('production bias readiness',()=>{
 it('does not confuse connected language AI with an active scoring SVM',async()=>{
  const response=await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({biasModel:{ready:false,method:null,version:null,topics:[],comparisonMinimum:{articlesPerPublisher:3,publishers:2}}});
 });
});
