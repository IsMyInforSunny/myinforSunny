import {describe,it,expect,vi,afterEach} from 'vitest';
import {withAudit} from '../lib/server/with-audit';
import {AppError,errorResponse,json} from '../lib/server/errors';
afterEach(()=>vi.restoreAllMocks());
describe('운영 로그의 내용 배제',()=>{
 it.each([false,true])('성공·실패 응답의 ID와 감사 로그 ID가 일치한다 (실패=%s)',async failure=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{}),requestId=crypto.randomUUID();
  const response=await withAudit('analyze',async()=>failure?errorResponse(new AppError(422,'VALIDATION_ERROR','입력을 확인해 주세요.'),requestId):json({requestId,status:'success'}))(new Request('https://example.test/api/analyze'));
  expect(response.headers.get('X-Request-Id')).toBe(requestId);
  expect((await response.json() as {requestId:string}).requestId).toBe(requestId);
  expect(JSON.parse(String(log.mock.calls[0][0])).requestId).toBe(requestId);
 });
 it('본문 ID가 없거나 잘못된 헤더도 새 UUID로 추적하고 원래 헤더 내용은 기록하지 않는다',async()=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  const response=await withAudit('news',async()=>new Response('private body',{headers:{'X-Request-Id':'private-value'}}))(new Request('https://example.test/api/news'));
  const id=response.headers.get('X-Request-Id');expect(id).toMatch(/^[a-f0-9-]{36}$/);
  expect(JSON.parse(String(log.mock.calls[0][0])).requestId).toBe(id);expect(String(log.mock.calls[0][0])).not.toContain('private');
 });
 it('본문·주소·검색어 없이 고정 상태만 기록한다',async()=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  const handler=withAudit('analyze',async()=>new Response('private result',{status:200}));
  await handler(new Request('https://example.test/api/analyze?secret=private',{method:'POST',body:'private input'}));
  const text=String(log.mock.calls[0][0]);expect(text).not.toContain('private');expect(text).not.toContain('secret');
  const entry=JSON.parse(text);expect(entry).toMatchObject({event:'analyze',status:'completed'});expect(Object.keys(entry).sort()).toEqual(['durationMs','event','requestId','status','type']);
 });
 it('원시 오류 메시지는 출력하지 않는다',async()=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  const handler=withAudit('research',async()=>{throw new Error('private source text');});
  await expect(handler(new Request('https://example.test/api/research'))).rejects.toThrow();
  expect(String(log.mock.calls[0][0])).not.toContain('private');expect(JSON.parse(String(log.mock.calls[0][0])).status).toBe('failed');
 });
});
