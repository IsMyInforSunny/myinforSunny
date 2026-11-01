import {describe,it,expect,vi,afterEach} from 'vitest';
import {withAudit} from '../lib/server/with-audit';
afterEach(()=>vi.restoreAllMocks());
describe('운영 로그의 내용 배제',()=>{
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
