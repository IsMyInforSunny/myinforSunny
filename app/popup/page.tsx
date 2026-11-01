import Workbench from '@/components/workbench';
import { Brand } from '@/components/site-shell';
import './popup.css';
export default function PopupPage() {
  return <div className="popup-page"><header className="popup-header"><Brand /><a href="/analyze" className="inline-link">전체 웹 화면 ↗</a></header>
    <main className="popup-main"><div className="analysis-heading"><p className="eyebrow">작은 창에서도, 웹에서도</p><h1>기사 한 편, 한 번 더.</h1><p>편향·자극·신뢰를 살펴보고, 근거 문장을 직접 확인하세요.</p></div><Workbench /></main>
  </div>;
}
