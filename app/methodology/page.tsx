import {MIN_N_FOR_PERCENT} from '@/lib/display';
import {capabilities, runtimeConfig} from '@/lib/server/config';
import {ArrowRight, ChartNoAxesColumnIncreasing, MessageCircle, Search, ShieldCheck} from 'lucide-react';
import {Header, Footer} from '@/components/site-shell';

export default async function Methodology() {
  const cap = capabilities(await runtimeConfig());
  return <><Header active="methodology" /><main className="container methodology">
    <p className="eyebrow">읽는 방법</p>
    <h1>편향 · 자극 · 신뢰,<br />판단보다 근거를 먼저.</h1>
    <p className="method-intro">교육·과학·경제·사회·문화·건강·정치 등 본문에 논점이 있는 기사를 분석합니다. 각 결과에서 원문 인용과 계산 기준을 확인할 수 있습니다.</p>
    <div className="method-grid">
      <article>
        <span className="mini-icon green"><ChartNoAxesColumnIncreasing /></span>
        <h2>01. 편향과 관점</h2>
        <p>기본 논점 관점은 비교할 명제에 대한 본문의 찬성·반대·복합 관점을 보여 줍니다. 사용자가 비교 명제를 입력하면 그 명제를 사용하고, 없으면 AI가 본문에서 중심 명제를 추출합니다.</p>
        <p>막대 위치는 분류를 나타냅니다. 수치 강도와 확률은 아직 계산하지 않습니다. 취재원의 인용과 댓글은 기사 작성자의 입장과 구분합니다. 입장 표현이 없거나 근거가 부족하면 해당 상태를 표시합니다.</p>
        <p>정치 좌우는 별도 선택입니다. 검증된 SVM 모델과 같은 논점의 비교 표본이 준비된 경우에만 기사 좌표와 기준선 거리를 계산합니다. 현재 배포 모델과 검증된 좌표가 없어 계산을 보류합니다. 기존 정치 비교용 매체 구분은 이 선택에만 적용합니다.</p>
        <div className="formula">정치 좌표 − 적격 매체 중심의 동일가중 기준선 → 방향과 거리</div>
        <p>정치 비교에는 같은 주제에서 매체별 고유 기사 3개 이상과 적격 매체 2곳 이상, 분리된 평가 표본과 매체별 성능 기록이 필요합니다. 축 방향이 검증되지 않거나 평가 오차 안에 있으면 방향을 유보합니다.</p>
        <p>PCA는 연구 단계에 있습니다. 현재 관련 기사는 취득한 원문과 인용, 같은 명제에 대한 입장을 확인해 분류합니다. 좌표 거리 기반 추천은 아직 구현되지 않았습니다.</p>
      </article>
      <article>
        <span className="mini-icon peach"><MessageCircle /></span>
        <h2>02. 자극과 공격성</h2>
        <p>자극은 공포 유도와 과도한 단정을 집계합니다. 공격성은 인신공격·집단 일반화·조롱·위협을 별도로 집계합니다. 한 문장이 두 기준에 모두 해당할 수 있습니다.</p>
        <div className="formula">표현 비율 = 해당 기준이 검출된 자연 문장 수 / 분석 대상 자연 문장 수 × 100</div>
        <p>기본 분모는 본문입니다. 댓글도 함께 집계를 선택하면 본문과 댓글을 합칩니다. 미판정 문장이 있으면 가능한 비율 범위를 표시하며, 모든 문장이 미판정이면 분석 대기로 표시합니다. 긴 문장의 처리 조각은 자연 문장 한 개로 셉니다.</p>
        <p>근거 창의 FOMO 표현 탐색은 긴급함·희소성·뒤처짐을 유도하는 사전 정의 표현을 본문에서 찾는 보조 표시입니다. 본문 검출 문장 수와 분모를 표시하며 인용·반박·부정 맥락을 놓칠 수 있습니다.</p>
      </article>
      <article>
        <span className="mini-icon lavender"><Search /></span>
        <h2>03. 신뢰</h2>
        <p>메인 신뢰 칸에는 사실 주장의 근거 출처 명시 비율을 표시합니다. 이름 있는 출처가 연결된 사실 주장 수를 전체 사실 주장 수로 나누며, 미해결 귀속은 가능한 상한에 포함합니다. 사실 주장이 없으면 해당 없음으로 표시합니다.</p>
        <div className="formula">이름 있는 출처가 연결된 사실 주장 수 / 전체 사실 주장 수 × 100</div>
        <p>외부 자료 대조를 실행하면 출처 원문과 시점, 뒷받침·상충을 확인하고 출처 가중 근거 점수를 보조 결과로 제공합니다. 출처 명시 여부와 외부 자료의 뒷받침은 각각 확인합니다.</p>
        <p>보조 점수는 사실 주장별 뒷받침 가중 비중의 합을 전체 사실 주장 수로 나눕니다. 일부 주장만 대조했으면 미대조 주장의 가능한 기여도를 상한에 포함합니다. 두 주장 중 하나만 70점이면 35–85점 범위입니다. 주장별로 가중치가 확인된 매체 2곳과 원본 근거 집단 2개 이상이 필요합니다.</p>
        <p>현재 보조 가중치는 Reuters Institute의 매체별 이용자 신뢰 응답을 0–1로 옮깁니다. 이용자 신뢰 응답은 0–10점 중 6–10점 비율이며 해당 매체 인지자만 분모에 포함합니다. 한국 표본은 2,038명이고 온라인 할당표집과 가중을 사용했습니다. 매체별 분모가 다르고 주관적 인식과 표집 한계가 있습니다. 연합뉴스TV와 연합뉴스 통신사를 구분하며 표에 없는 매체는 가중치 계산을 보류합니다.</p>
        <p>가중치와 조사 방법의 출처를 확인할 수 있습니다.</p>
        <ul>
          <li><a className="inline-link" href="https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2025/south-korea" target="_blank" rel="noopener noreferrer">2025 한국 보고서</a></li>
          <li><a className="inline-link" href="https://datawrapper.dwcdn.net/3sOWE/2/" target="_blank" rel="noopener noreferrer">매체별 이용자 신뢰 표</a></li>
          <li><a className="inline-link" href="https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2025/methodology" target="_blank" rel="noopener noreferrer">조사 방법론</a></li>
        </ul>
        <p>완전히 같은 본문으로 확인된 전재만 한 원본 집단으로 셉니다. 문장을 바꾼 전재나 전체 본문이 없는 자료는 원본 관계를 확인하지 못할 수 있습니다. 원문 확인에는 현재 취득 자료의 출처 정체성과 인용 구절이 일치해야 하며, 한 주장의 확인을 다른 주장으로 확대하지 않습니다.</p>
        <p>{cap.live && cap.webSearch && cap.webFetch ? '공개 자료 사용과 전송 안내에 동의하면 자동 조사를 시작할 수 있습니다.' : '자동 조사와 관련 기사 검색은 준비 중입니다.'} 수동 대조에는 참고자료 본문을 직접 입력합니다. 입력 자료는 웹에서 취득한 자료와 구분합니다.</p>
      </article>
    </div>
    <section className="method-note"><ShieldCheck size={25} /><div>
      <h2>AI와 처리 시간</h2>
      <p>첫 AI 호출에서 논점·사실과 의견·본문 입장·표현 후보와 원문 인용을 추출합니다. 인용 위치를 원문과 확인한 뒤 화면 비율을 계산합니다. 실제 서비스와 실행 모델은 분석 화면의 처리 과정에서 확인할 수 있습니다.</p>
      <p>추가 조사는 별도 계획·검색·대조 호출을 순차 수행합니다. NVIDIA는 Groq 전용 61초 모델 대기를 적용하지 않으며 실제 제공자의 제한 응답을 따릅니다. 수집 기사 메타데이터 검색은 모델 호출 없이 먼저 수행합니다. 본문 분석과 추가 조사 진행 상태를 각각 표시합니다.</p>
      <h2>밑줄과 동작 로그</h2>
      <p>밑줄은 검토할 원문 위치를 알려 줍니다. 자료의 시간·대상·단위를 함께 살펴보세요. 인용 위치가 일치해도 해석 오류는 생길 수 있습니다.</p>
      <p>반복 분석을 줄이기 위해 같은 사용자의 입력과 결과를 서버 메모리에 최대 10분간 보관합니다. 댓글과 별도 논점이 없는 공개 기사 링크의 분석은 서버 캐시에서 최대 10분간 재사용합니다. 재사용 여부와 최초 분석 시각을 표시합니다. 실시간 분석에는 필요한 텍스트가 {cap.aiProvider==='nvidia'?'NVIDIA DeepSeek':'Groq'}로 전달되며 제공자의 정책이 적용됩니다. 공개·가상 자료를 입력해 주세요. 동작 로그는 원문·검색어·URL·키를 제외한 상태를 기록합니다. 모델 형식 오류 진단은 고정된 단계·오류 코드·스키마 필드명만 사용합니다.</p>
    </div></section>
    <section className="method-evaluation">
      <h2>현재 평가 상태</h2>
      <p>기본 분석 기준 rubric-4.0 · analysis-4.8, 화면 요약 article-overview-1.0, JSON 내보내기 2.5입니다. 학습용 예시 7종은 직접 만든 가상 자료입니다. 독립 평가자의 판단과 비교한 정확도는 아직 측정되지 않았습니다.</p>
      <p>일반 퍼센트 표는 분모 {MIN_N_FOR_PERCENT} 이상에서 표시합니다. 메인 화면의 자극·공격성·출처 명시 비율은 작은 표본에서도 건수와 분모를 함께 표시합니다. 미확인 값은 분석 대기·해당 없음으로 구분합니다.</p>
      <p>정치 좌우의 SVM 정확도와 거리 기반 추천 품질은 아직 검증되지 않았습니다. {cap.live ? '실시간 본문 분석은 무료 한도 내 실험 기능입니다.' : '실시간 분석은 준비 중입니다.'} 실제 기사 수집·검색 품질은 별도 검증 대상입니다.</p>
      <a className="button primary" href="/analyze?example=provocative">표현 예시 살펴보기 <ArrowRight size={17} /></a>
    </section>
  </main><Footer /></>;
}

