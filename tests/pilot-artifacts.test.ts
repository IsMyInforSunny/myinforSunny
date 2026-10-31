import {describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRun,redact,safeFailure} from './helpers/pilot-artifacts';
describe('시험 산출물 보관 도우미 (오프라인)',()=>{
 it('실행마다 별도 디렉터리에 보관하고 이전 기록을 덮어쓰지 않는다',()=>{
  const base=mkdtempSync(join(tmpdir(),'pilot-'));
  try{
   const a=createRun(base,new Date('2026-01-01T00:00:00Z'),'00000000-0000-4000-8000-000000000001'),b=createRun(base,new Date('2026-01-01T00:00:00Z'),'00000000-0000-4000-8000-000000000002');
   a.writeRaw(0,'first');a.writeResults([{caseId:'x'}]);b.writeResults([{caseId:'y'},{caseId:'z'}]);
   expect(readdirSync(join(base,'runs'))).toHaveLength(2);
   expect(JSON.parse(readFileSync(join(a.dir,'results.json'),'utf8')).results).toHaveLength(1);
   expect(JSON.parse(readFileSync(join(base,'latest.json'),'utf8'))).toMatchObject({runId:b.runId,resultCount:2});
   expect(()=>createRun(base,new Date('2026-01-01T00:00:00Z'),'00000000-0000-4000-8000-000000000001')).toThrow();
   expect(()=>a.writeRaw(0,'again')).toThrow();
  }finally{rmSync(base,{recursive:true,force:true});}
 });
 it('키 패턴을 가리고 실패는 원문 오류 없이 기록한다',()=>{
  const fakeKey='gsk_'+'A'.repeat(24);
  expect(redact(`k=${fakeKey} Bearer abc.def GROQ_API_KEY=${fakeKey}`)).not.toMatch(/gsk_|abc\.def/);
  const failure=safeFailure(Object.assign(new Error(`leak ${fakeKey}`),{code:'RATE_LIMITED',status:429}));
  expect(failure).toEqual({status:'failed',code:'RATE_LIMITED',httpStatus:429});expect(JSON.stringify(failure)).not.toContain('leak');
  expect(safeFailure(new Error('x'))).toEqual({status:'failed',code:'UNKNOWN'});
 });
 it('결과 파일에 들어간 키 패턴도 가린다',()=>{
  const base=mkdtempSync(join(tmpdir(),'pilot-'));
  try{const run=createRun(base);run.writeResults([{note:'gsk_'+'B'.repeat(30)}]);expect(readFileSync(join(run.dir,'results.json'),'utf8')).not.toContain('gsk_');}
  finally{rmSync(base,{recursive:true,force:true});}
 });
});
