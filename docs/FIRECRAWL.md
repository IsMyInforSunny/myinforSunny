# Firecrawl 수집 어댑터 — 구현됨, 운영 연결 전

현재 공개 사이트의 뉴스 검색은 꺼져 있다. 이 문서는 연결 코드를 설명하며, 실제 기사 수집 성공·권리 확인·정확도 검증을 주장하지 않는다. 실제 키를 읽거나 외부 Firecrawl API를 호출하지 않고 모의 응답과 실제 로컬 D1로 시험했다.

## 역할과 경계

- `NEWS_PROVIDER=gdelt`가 기본값이다. `firecrawl`을 명시적으로 선택할 때만 Firecrawl을 사용한다. 오류나 한도 소진 시 다른 제공자로 자동 전환하지 않는다.
- `/v2/search`는 공개 웹·뉴스의 주소 후보만 찾는다. 검색 발췌를 사실 확인 근거로 쓰지 않는다.
- 후보 중 `ALLOWED_RETRIEVAL_HOSTS`의 정확한 HTTPS 호스트만 `/v2/scrape`로 가져온다. 이 목록은 접근·권리 검토 목록이며 언론사 신뢰 인증 목록이 아니다.
- 본문은 `onlyMainContent`, markdown, basic proxy, 파서 없음으로 요청한다. 유료 프록시 확장, 로그인, 페이월 우회, browser action, agent endpoint를 사용하지 않는다. 허용 출처의 robots 및 이용 조건을 별도로 확인해야 하며 Firecrawl 성공이 이용 허락을 뜻하지 않는다.
- 반환 URL 메타데이터가 요청한 주소와 다르거나 없으면 자료로 채택하지 않는다. 접근 오류·구독 장벽·명시적인 AI 이용 제한 문구도 채택하지 않는다. 이 검사는 모든 법적 조건이나 모든 차단 형태를 자동 검증하지 못한다.
- 검색 후보 → 본문 취득 → 서명된 발췌 → LLM 비교 → 인용 위치 일치 검증 흐름을 유지한다. 날짜·대상·통계 단위, 원자료와 전재 기사 중복, 사실과 의견의 구분은 별도 평가가 필요하다.
- Agent-Reach는 읽기용 CLI로, 현재 Cloudflare Worker에서 하위 프로세스로 실행할 수 없다. 이번 서버 통합은 HTTP 기반 Firecrawl 어댑터이다. Agent-Reach를 자동 호출한다고 표시하지 않는다.

## 무료 한도 보호와 운영 전 설정

서버 secret에 `FIRECRAWL_API_KEY`를 보관한다. `.env.example`에는 빈 값만 있다. 다음 조건이 모두 참이어야 호출한다.

1. `ENABLE_NEWS_SEARCH=true`, `NEWS_TERMS_APPROVED=true`, `NEWS_PROVIDER=firecrawl`.
2. `FIRECRAWL_TERMS_APPROVED=true`, `FIRECRAWL_SOURCE_TERMS_APPROVED=true`: 계정·청소년 앱 이용 조건과 대상 출처의 수집·LLM 전달·짧은 인용 표시 조건을 확인한다.
3. `FIRECRAWL_FREE_PLAN_CONFIRMED=true`: 실제 계정의 무료 플랜·추가 결제 방지 상태를 확인한다. 코드의 플래그만으로 공급자의 결제 상태를 보장할 수는 없다.
4. `FIRECRAWL_CONSOLE_LIMITS_CONFIRMED=true`, `FIRECRAWL_CONSOLE_CREDITS`, `FIRECRAWL_SEARCH_CREDIT_COST`, `FIRECRAWL_SCRAPE_CREDIT_COST`를 실제 계정 한도와 해당 요청 옵션의 보수적 최대 비용으로 설정한다. 검색은 최소 2, 본문 수집은 최소 1 크레딧 이상만 허용한다. 공식 정책이 달라지면 비용을 다시 확인한다.
5. `FIRECRAWL_CREDIT_BUDGET`은 별도 안전 상한이다. 실제 무료 크레딧의 80%, 설정 상한, 800 중 가장 작은 값만 허용한다.
6. 출처 호스트 허용 목록, D1 바인딩, `0003_firecrawl_credit_budget.sql` 마이그레이션을 준비한다.

D1에서 전송 전에 크레딧을 원자적으로 예약한다. 실패·타임아웃도 예약을 유지한다. 응답이 더 큰 `creditsUsed`를 보고하면 더 큰 값으로 기록해 다음 호출을 중단한다. 예상 비용보다 실제 청구가 높았던 그 호출 자체를 되돌릴 수는 없으므로 확인된 무료 계정과 보수적인 예약 비용이 필수다. 같은 키를 다른 앱에서 쓰는 비용은 이 저장소에 잡히지 않는다.

무료 크레딧은 일회성 지급일 수 있으므로 **월이 바뀌어도 자동 초기화하지 않는다.** `month`는 보고용이다. 크레딧 증액/이월이 확인되기 전 저장된 합계를 삭제하지 않는다. 검색에는 기존 IP별 분당 3회·시간당 20회·전체 일당 200회 제한도 적용된다.

저장 필드는 임의 예약 ID, 월, 작업명, 예약 크레딧, 시각뿐이다. 기사·검색어·원 IP·키는 저장하지 않는다. API 오류 응답 본문도 로그에 쓰지 않는다.

## 검증과 미확인

- 시험: 비활성/미승인 네트워크 차단, URL 정확 일치, 검색 중복 제거, 검색 발췌 비채택, 리다이렉트 메타데이터 거부, 페이월 거부, 응답 크기 제한, 유료 fallback 없음, 실제 D1의 동시 예약과 일회성 상한 유지.
- 미확인: 실제 계정 조건·무료 크레딧, 매체별 권리, 실제 수집률·본문 품질, 통계·날짜 대조 정확도. 키 연결 및 실수집 검증 전 공개 검색을 켜지 않는다.
- 원문: [Firecrawl REST 공식 명세](https://docs.firecrawl.dev/agent-source-of-truth/curl), [검색 문서](https://docs.firecrawl.dev/features/search). 명세 확인일 2026-11-01.
