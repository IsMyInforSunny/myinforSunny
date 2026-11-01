import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearActivity, getActivity, getServerActivity, MAX_ACTIVITY_ENTRIES, recordActivity, subscribeActivity } from '../lib/activity-log';
import { auditEvent } from '../lib/server/audit';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
beforeEach(() => clearActivity());
describe('private in-memory activity history', () => {
  it('retains stable snapshots and notifies subscribers', () => {
    expect(getActivity()).toBe(getActivity()); expect(getServerActivity()).toHaveLength(0);
    const listener = vi.fn(), unsubscribe = subscribeActivity(listener);
    recordActivity('analysis', 'started'); expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe(); recordActivity('analysis', 'completed'); expect(listener).toHaveBeenCalledTimes(1);
  });
  it('drops arbitrary fields and invalid values at runtime', () => {
    recordActivity('analysis', 'failed', { durationMs: -1, count: NaN, text: 'PRIVATE ARTICLE', url: 'https://secret.test', key: 'SECRET' } as never);
    expect(getActivity()[0]).toEqual({ id: expect.any(Number), at: expect.any(Number), event: 'analysis', status: 'failed' });
    expect(JSON.stringify(getActivity())).not.toContain('PRIVATE');
    recordActivity('SECRET' as never, 'failed'); recordActivity('analysis', 'PRIVATE' as never);
    expect(getActivity()).toHaveLength(1);
  });
  it('caps history and numeric metadata and clears without persistence', () => {
    for (let i = 0; i < 60; i++) recordActivity('verification', 'completed', { count: 20_000, durationMs: Infinity });
    expect(getActivity()).toHaveLength(MAX_ACTIVITY_ENTRIES); expect(getActivity()[0].count).toBe(10_000);
    expect(Object.isFrozen(getActivity())).toBe(true); clearActivity(); expect(getActivity()).toHaveLength(0);
  });
});
describe('server operational audit', () => {
  it('emits only fixed event, status and validated operational metadata', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    auditEvent('research', 'failed', { durationMs: 1200, requestId: 'raw input secret', body: 'PRIVATE', error: 'SECRET' } as never);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ type: 'operation', event: 'research', status: 'failed', durationMs: 1200 });
    auditEvent('PRIVATE' as never, 'failed'); expect(log).toHaveBeenCalledTimes(1); log.mockRestore();
  });
});
describe('extension handoff', () => {
  async function extension(text: string) {
    const nodes: Record<string, {value:string;textContent:string;callbacks:Record<string,()=>Promise<void>|void>;addEventListener:(event:string,callback:()=>Promise<void>|void)=>void}> = {};
    for(const id of ['preview','status','count','open','popup']) nodes[id] = {value:'',textContent:'',callbacks:{},addEventListener(event,callback){this.callbacks[event]=callback;}};
    const createTab=vi.fn().mockResolvedValue({}),createWindow=vi.fn().mockResolvedValue({});
    const context={document:{getElementById:(id:string)=>nodes[id]},chrome:{tabs:{query:vi.fn().mockResolvedValue([{id:1}]),create:createTab},windows:{create:createWindow},scripting:{executeScript:vi.fn().mockResolvedValue([{result:{text,length:text.length}}])}},encodeURIComponent};
    runInNewContext(readFileSync(new URL('../extension/popup.js',import.meta.url),'utf8'),context);
    await new Promise(resolve=>setTimeout(resolve,0));
    return {nodes,createTab,createWindow};
  }
  it('does not send any selected content automatically and blocks overlong text', async()=>{
    const {nodes,createTab,createWindow}=await extension('가'.repeat(2001));
    expect(createTab).not.toHaveBeenCalled();expect(createWindow).not.toHaveBeenCalled();
    await nodes.open.callbacks.click();expect(createTab).not.toHaveBeenCalled();expect(nodes.status.textContent).toContain('2,000');
  });
  it('sends only the explicit selection in a fragment to the fixed public site',async()=>{
    const {nodes,createTab,createWindow}=await extension('선택한 공개 글');
    await nodes.popup.callbacks.click();expect(createWindow).toHaveBeenCalledWith({url:'https://naeinfo-clear-code2026.civilsquid9.chatgpt.site/popup#selection='+encodeURIComponent('선택한 공개 글'),type:'popup',width:580,height:840});
    expect(createTab).not.toHaveBeenCalled();await nodes.open.callbacks.click();expect(createTab.mock.calls[0][0].url).toContain('/analyze#selection=');
  });
});
