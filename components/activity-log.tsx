'use client';
import { useSyncExternalStore } from 'react';
import { clearActivity, getActivity, getServerActivity, subscribeActivity, type ActivityEvent, type ActivityStatus } from '@/lib/activity-log';
const EVENT_LABELS: Record<ActivityEvent, string> = { analysis: '본문 분석', verification: '자료 대조', research: '외부 조사', demo: '예시 분석', popup: '팝업 열기', export: '결과 내보내기', reset: '입력 초기화' };
const STATUS_LABELS: Record<ActivityStatus, string> = { started: '시작', completed: '완료', failed: '연결·처리 실패', cancelled: '취소' };
export default function ActivityLog() {
  const entries = useSyncExternalStore(subscribeActivity, getActivity, getServerActivity);
  return <details className="activity-log" style={{ marginTop: 24, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>동작 기록 <span className="badge">현재 창 · {entries.length}건</span></summary>
    <p className="topic-note">본문·검색어·기사 주소·개인정보를 담지 않는 현재 창의 임시 기록입니다. 서버로 전송하거나 저장하지 않으며 새로고침하면 지워집니다.</p>
    {entries.length ? <ol style={{ paddingLeft: 22, fontSize: 12 }}>{[...entries].reverse().map(entry => <li key={entry.id} style={{ marginBlock: 7 }}>
      <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>{' · '}{EVENT_LABELS[entry.event]}{' · '}{STATUS_LABELS[entry.status]}
      {entry.durationMs !== undefined && ` · ${(entry.durationMs / 1000).toFixed(1)}초`}{entry.count !== undefined && ` · ${entry.count}건`}
    </li>)}</ol> : <p className="topic-note">아직 동작 기록이 없습니다.</p>}
    <button className="small-button" type="button" disabled={!entries.length} onClick={clearActivity}>동작 기록 지우기</button>
  </details>;
}
