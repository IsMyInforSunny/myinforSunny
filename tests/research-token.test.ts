import {describe,it,expect} from 'vitest';
import {digest,readResearchToken,signResearchToken} from '../lib/server/research-token';
const c={GROQ_API_KEY:'synthetic-key-not-a-real-secret'};
const req=(ip='192.0.2.1')=>new Request('https://site.test/api/research',{headers:{'cf-connecting-ip':ip}});
describe('브라우저 보유 조사 자료의 서버 서명',()=>{
 it('원문을 서버에 저장하지 않고 서명한 공개 자료를 다시 확인한다',async()=>{const data={planId:'p1',references:[{url:'https://news.example/a',text:'가상 공개 자료'}]};const t=await signResearchToken(req(),c,'evidence',data,60000,10000);expect(await readResearchToken(req(),c,t,'evidence',11000)).toEqual(data);});
 it('조사 자료 변경·다른 IP·만료·다른 용도는 거절한다',async()=>{const t=await signResearchToken(req(),c,'evidence',{planId:'p1'},1000,10000);for(const [r,token,kind,now] of [[req(),t.slice(0,-3)+'abc','evidence',10500],[req('192.0.2.2'),t,'evidence',10500],[req(),t,'plan',10500],[req(),t,'evidence',11000]] as const)await expect(readResearchToken(r,c,token,kind,now)).rejects.toMatchObject({code:'INVALID_RESEARCH_EVIDENCE'});});
 it('키 교체와 원문 차이를 식별한다',async()=>{const t=await signResearchToken(req(),c,'plan',{inputHash:await digest('원문')},1000,10000);await expect(readResearchToken(req(),{GROQ_API_KEY:'different-synthetic-key'},t,'plan',10001)).rejects.toMatchObject({code:'INVALID_RESEARCH_EVIDENCE'});expect(await digest('원문')).not.toBe(await digest('다른 원문'));});
});
