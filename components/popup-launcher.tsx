'use client';
import { useState } from 'react';
import { recordActivity } from '@/lib/activity-log';
export default function PopupLauncher() {
  const [attempted, setAttempted] = useState(false);
  function openPopup() {
    // noopener intentionally returns no reliable handle. Offer a normal link, never open a second window automatically.
    recordActivity('popup', 'started');
    try { window.open('/popup', '_blank', 'popup,width=560,height=820,resizable=yes,scrollbars=yes,noopener,noreferrer'); setAttempted(true); }
    catch { setAttempted(true); recordActivity('popup', 'failed'); }
  }
  return <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
    <button type="button" className="small-button" onClick={openPopup}>작은 창으로 분석하기 ↗</button>
    <a className="inline-link" href="/popup">작은 화면을 웹페이지로 열기</a>
    {attempted && <p className="topic-note" role="status" style={{ flexBasis: '100%' }}>팝업이 나타나지 않으면 위의 웹페이지 링크로 열어 주세요. 현재 입력 내용은 새 창으로 자동 전달하지 않습니다.</p>}
  </div>;
}
