import {PROVIDER_NAME,MIN_N_FOR_PERCENT} from '@/lib/display';
import {capabilities,runtimeConfig} from '@/lib/server/config';
import {ArrowRight,ChartNoAxesColumnIncreasing,MessageCircle,Search,ShieldCheck} from 'lucide-react';
import {Header,Footer} from '@/components/site-shell';
export default async function Methodology(){
 const cap=capabilities(await runtimeConfig());
 return <><Header active="methodology"/><main className="container methodology">
  <p className="eyebrow">읽는 방법</p><h1>편향 · 자극 · 신뢰,<br/>판단보다 근거를 먼저.</h1>
  <p className="method-intro">기사에서 확인한 문장과 자료만 표시합니다. ‘문제가 없는 기사’나 ‘거짓 기사’를 자동으로 확정하지 않습니다.</p>
  <div className="method-grid">
   <article><span className="mini-icon green"><ChartNoAxesColumnIncreasing/></span><h2>01. 편향</h2><p>현재는 편향을 관찰하기 위한 논점 구성과 자료 비교를 제공합니다. 본문과 댓글은 따로 분류합니다. 어떤 논점을 많이 다뤘다는 사실만으로 편향을 확정하지 않습니다.</p><div className="formula">논점별 본문 문장 수 / 전체 본문 문장 수</div><p>좌표의 가로축은 명시된 제안에 대한 다른 기사들의 입장, 세로축은 인용 자료의 관계입니다. 실제로 가져와 인용을 확인한 자료만 올립니다. 언론사 전체의 정치 성향, 도덕성, 진실 확률을 좌표로 정하지 않습니다. 비교 자료가 없으면 점을 만들지 않습니다.</p></article>
   <article><span className="mini-icon peach"><MessageCircle/></span><h2>02. 자극</h2><p>인신공격, 집단 일반화, 조롱, 공포 유도, 과도한 단정, 위협을 맥락과 함께 검토합니다. 공격성은 이 축 안에서 표현 기준으로 다룹니다.</p><div className="formula">검토할 표현이 있는 문장 수 / 전체 문장 수</div><p>FOMO 표현 게이지는 긴급함·희소성·뒤처짐을 유도하는 사전 정의 표현의 탐색 결과입니다. 심리검사나 보정된 지수가 아니며 의도·효과·불안 수준을 측정하지 않습니다. 인용·반박·부정 맥락은 놓칠 수 있습니다. 긴 문장의 처리 조각은 자연 문장 한 개로 셉니다.</p></article>
   <article><span className="mini-icon lavender"><Search/></span><h2>03. 신뢰</h2><p>사실 주장과 참고자료를 대조해 출처에서 확인됨·입력한 출처와 다름·자료 충돌·불충분·미대조·접근 실패로 구분합니다. 사실 주장이라는 분류가 그 주장이 참이라는 뜻은 아닙니다.</p><div className="formula">뒷받침 / 상충 / 불충분 / 미대조 — 각각의 주장 건수</div><p>{cap.webSearch&&cap.webFetch?'승인한 출처의 공개 자료로 자동 조사를 실행할 수 있습니다.':'외부 검색·본문 취득은 아직 설정 전입니다. Firecrawl 연결 코드를 제공하지만 실제 검색 결과는 만들지 않습니다.'} 수동 입력한 자료는 원 사이트에서 가져온 자료와 구분합니다. 같은 보도자료를 옮긴 여러 기사는 독립된 근거가 아닙니다.</p></article>
  </div>
  <section className="method-note"><ShieldCheck size={25}/><div><h2>밑줄의 의미</h2><p>밑줄은 확인할 위치를 알려 줍니다. ‘미대조’는 거짓이라는 뜻이 아니고, ‘입력한 출처와 다름’도 해당 자료 범위의 비교입니다. 시간·대상·단위가 다른 자료로 상충을 확정하지 않습니다. 인용 위치가 일치해도 AI의 해석까지 옳다고 보장하지 않습니다.</p><h2>입력과 동작 로그</h2><p>입력은 분석 기록으로 저장하지 않습니다. 실시간 분석에는 필요한 텍스트가 {PROVIDER_NAME}로 전달되며 제공자의 정책이 적용됩니다. 공개·가상 자료만 입력하고 개인정보와 비공개 대화를 넣지 마세요. 동작 로그는 시작·완료·실패 등의 상태만 기록하며 원문·검색어·URL·키를 남기지 않습니다. 화면 로그는 메모리에서만 유지됩니다.</p></div></section>
  <section className="method-evaluation"><h2>현재 평가 상태</h2><p>기본 분석 기준 rubric-4.0 · analysis-4.5 / 문장 표시·FOMO 탐색은 별도 모듈입니다. 학습용 예시 7종은 직접 만든 가상 자료로 실제 웹 조사 결과가 아닙니다. 독립 평가자와 대조한 정확도는 아직 없습니다.</p><p>작은 표본은 건수를 우선 표시하고 일반 퍼센트는 분모 {MIN_N_FOR_PERCENT} 이상에서만 표시합니다. FOMO 게이지도 검출 문장 수와 분모를 함께 보여 줍니다. 미대조·유보·자료 부재를 0점으로 환산하지 않습니다.</p><p>언론사별 고정 편향 좌표를 만들려면 주제·기간별 대표 기사, 독립적인 사람 라벨, 출처의 독립성, 재현 가능한 평가 기준이 추가로 필요합니다. 현재의 자료 비교 좌표를 검증된 언론사 편향 지도로 부르지 않습니다.</p><p>{cap.live?'실시간 본문 분석은 무료 한도 내 실험 기능입니다.':'실시간 분석은 설정 전입니다.'} Firecrawl 수집 성공·공개 검색 품질·확장 프로그램 배포는 별도 검증 대상입니다.</p><a className="button primary" href="/analyze?example=provocative">표현 예시 살펴보기 <ArrowRight size={17}/></a></section>
 </main><Footer/></>;
}
