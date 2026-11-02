# 신뢰 판단 기준 · 2026-11-02

사용자가 말한 “MDC”는 **MBC**로 확인했다. 현재 결과는 사실 주장별로 산출한다.

1. 실제 웹에서 취득한 자료의 공개 URL, 인용 문구와 위치, 발행 시점이 검증된 관측만 사용한다. 가상 예시와 사용자가 붙여 넣은 자료는 출처 가중 집계에서 제외한다.
2. 자료가 주장을 뒷받침하는지, 상충하는지, 자료끼리 충돌하는지 구분한다. 동일 원본의 전재는 한 증거 집단으로 묶는다. 매체마다 기사 결과를 먼저 평균해 기사 수가 많은 매체의 영향이 자동으로 커지지 않게 한다.
3. 출처별 공개 신뢰 응답을 보조 가중치로 적용한다. Reuters Institute의 [Digital News Report 2025 한국 페이지](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2025/south-korea)는 MBC 61%, JTBC 59%, YTN 55%를 보고한다. [방법론](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2025/methodology)의 작은 차이에 대한 주의를 고려해 MBC와 JTBC에는 동일한 0.60, YTN에는 0.55를 적용한다. 이 응답은 이용자의 인식이며 보도 정확도 측정값이 아니다.
4. 모든 관측 출처에 비교 가능한 가중치가 있고, 적격 출처가 2곳 이상이며, 독립 증거 집단이 2개 이상일 때만 주장별 뒷받침·상충·충돌의 **가중 근거 구성**을 표시한다. 이는 주장이 참일 확률이나 매체의 종합 신뢰 등급이 아니다.

추가 공개 정보의 취급: 정정·반론 건수는 확정 결과와 전체 보도량 분모 없이 매체별 오류율로 바꾸지 않는다. 매체의 정정 정책이나 소유 정보 공개 여부는 확인 가능한 운영 정보로 기록할 수 있지만 사실 정확도 점수에 임의 비율로 합산하지 않는다. 독립 사실 평가 표본과 비교 가능한 분모가 확보되면 방법 버전을 올려 별도 지표로 평가한다.

현재 적용 모듈: `lib/public-trust-prior.ts`, `lib/source-reliability-adapter.ts`, `lib/source-reliability.ts`. 화면: `components/canva-dashboard.tsx`, `app/methodology/page.tsx`.
