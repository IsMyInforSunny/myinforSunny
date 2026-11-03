import type {PublisherWeightSet} from './source-reliability';

const CSV = 'https://datawrapper.dwcdn.net/3sOWE/2/data.csv';
const CAVEAT = '이 수치는 매체를 들어 본 응답자 중 0–10점에서 6–10점을 준 비율(5점은 중립, 0–4점은 불신)이며 이용자 신뢰 인식을 나타낸다. 기사 정확도나 사실 신뢰도가 아니다. 매체별 인지자만 분모에 들어가므로 분모가 서로 다르다. 두 매체 간 2%p 이하 차이는 유의한 순위 차이로 단정하지 않는다. Reuters Institute Digital News Report 2025 한국 브랜드 신뢰 표, 2025-06-17.';
const evidence = (brand: string, percent: number) =>
  `${brand} 이용자 신뢰 응답 ${percent}%. CSV 원자료: ${CSV}. ${CAVEAT} Yonhap News TV 응답은 yna.co.kr의 연합뉴스와 다른 방송 매체(yonhapnewstv.co.kr) 항목이다.`;

/**
 * Reuters DNR 2025 Korean brand-trust response shares used as a perception prior.
 * Each weight is the source CSV percentage divided by 100. This is not an accuracy
 * rating; brands without a clear matching publisher host are intentionally omitted.
 */
export const SOUTH_KOREA_PUBLIC_TRUST_PRIOR_2025: PublisherWeightSet = {
  version: 'reuters-dnr-2025-kr-brand-trust-v2',
  methodology: `Reuters Institute Digital News Report 2025 South Korea brand trust responses. Each weight is raw Trust% / 100 from the publisher's comparable named brand in the source CSV (${CSV}). Trust is the share rating 6–10 on a 0–10 scale; 5 is neither and 0–4 is don't trust. Respondents who had not heard of a brand are excluded, so each brand has a different awareness-conditioned denominator. The weighted share is reported audience perception, not factual accuracy. Differences of 2 percentage points or less are very unlikely to be statistically significant and should be interpreted with high caution. Partial host coverage: publishers without a clear comparable host are omitted, and a claim result remains pending if any observed publisher lacks a weight.`,
  weights: [
    {publisher: 'ichannela.com', value: 0.43, evidence: evidence('Channel A', 43)},
    {publisher: 'chosun.com', value: 0.40, evidence: evidence('Chosun', 40)},
    {publisher: 'donga.com', value: 0.41, evidence: evidence('Dong-A', 41)},
    {publisher: 'hani.co.kr', value: 0.45, evidence: evidence('Hankyoreh', 45)},
    {publisher: 'joongang.co.kr', value: 0.40, evidence: evidence('Joongang', 40)},
    {publisher: 'news.jtbc.co.kr', value: 0.59, evidence: evidence('JTBC', 59)},
    {publisher: 'news.kbs.co.kr', value: 0.48, evidence: evidence('KBS', 48)},
    {publisher: 'khan.co.kr', value: 0.43, evidence: evidence('Kyunghyang', 43)},
    {publisher: 'imnews.imbc.com', value: 0.61, evidence: evidence('MBC', 61)},
    {publisher: 'mbn.co.kr', value: 0.46, evidence: evidence('MBN', 46)},
    {publisher: 'news.sbs.co.kr', value: 0.54, evidence: evidence('SBS', 54)},
    {publisher: 'news.tvchosun.com', value: 0.42, evidence: evidence('TV Chosun', 42)},
    {publisher: 'yonhapnewstv.co.kr', value: 0.52, evidence: evidence('Yonhap News TV', 52)},
    {publisher: 'ytn.co.kr', value: 0.55, evidence: evidence('YTN', 55)},
  ],
};
