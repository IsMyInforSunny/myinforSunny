import {describe,expect,it} from 'vitest';
import {POST} from '../app/api/article-comparison/route';

function request(value:unknown){return new Request('https://local.test/api/article-comparison',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});}

describe('article comparison endpoint',()=>{
  it('returns an explicit missing-date state without searching or calling a model',async()=>{
    const response=await POST(request({body:'국민연금 보험료율 인상 관련 기사 본문. '.repeat(20),title:'연금 개혁 논의'}));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({status:'date_missing',event:null,
      fomo:{value:0,total:20},attribution:{value:0,total:20}});
  });

  it('rejects contact details and input outside the endpoint contract',async()=>{
    const contact=await POST(request({body:'연금보험료 기사 본문에서 기자 연락처 news@example.com을 공개한다.'.repeat(4),publishedAt:'2024-01-01'}));
    expect(contact.status).toBe(422);
    const oversized=await POST(request({body:'기사 '.repeat(2800),publishedAt:'2024-01-01'}));
    expect(oversized.status).toBe(422);
  });
});
