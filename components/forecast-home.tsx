import {Sun} from 'lucide-react';
import Workbench from './workbench';

export default function ForecastHome(){return <div className="forecast-app">
 <a className="forecast-skip" href="#main-content">분석 화면으로 건너뛰기</a>
 <header className="forecast-nav"><a href="/" className="forecast-logo" aria-label="내 정보 맑음 홈"><Sun size={55} strokeWidth={2.2} aria-hidden="true"/><h1>내 정보 맑음?</h1></a><a className="forecast-wordmark" href="/" aria-label="inforcast 홈">inforcast</a></header>
 <main className="forecast-main" id="main-content" tabIndex={-1}><Workbench/></main>
 <footer className="forecast-footer"><span>inforcast © 2026</span><a href="/methodology">분석 기준과 한계</a></footer>
 </div>;}
