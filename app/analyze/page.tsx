import { Header, Footer } from '@/components/site-shell';
import Workbench from '@/components/workbench';
export default function AnalyzePage(){return <><Header active="analyze"/><main className="container analysis-main"><div className="analysis-heading"><p className="eyebrow"><span className="status-dot"/> 더 또렷하게 읽기</p><h1>오늘의 정보 성분표</h1><p>글을 붙여 넣고, 생각의 재료를 하나씩 살펴보세요.</p></div><Workbench/></main><Footer/></>;}
