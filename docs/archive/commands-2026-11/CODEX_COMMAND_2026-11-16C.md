# Codex 작업 지시 · 임의 기사 링크 분석(공개 가져오기) · 2026-11-16

배경: `docs/ANY_ARTICLE_LINK_PLAN_2026-11-16.md`. 진행 기록은 `docs/LINK_FETCH_STATUS.md` 한 파일에만 쓴다(편향 작업의 `BIAS_STATUS.md`와 분리). 공개 배포는 마지막에 사용자 확인을 받은 뒤에 한다.

## 사용자 결정 (2026-11-16)

- **C2까지 진행한다.** 운영자 허용 목록에 없는 주소도, 아래 안전 조건을 모두 통과하면 서버가 가져와 분석한다.
- 이 결정은 `lib/server/retrieval.ts` 주석의 "임의 사용자 URL은 네트워크 목적지가 되지 않는다" 규칙을 바꾼다. 루트 `AGENTS.md`에 날짜와 함께 한 줄 기록한다.
- 바뀌지 않는 것: robots.txt와 AI 수집 제한 존중, 로그인·유료 우회 금지, 서버에서 스크립트 실행 금지, 본문 비저장(기존 캐시 규칙), 가져온 기사를 학습·비교 집합에 넣지 않음.
- 북마클릿·확장(A 방식)은 아직 결정 전이다. 구현하지 않는다.

## 순서와 우선순위

편향 회차 3(`CODEX_COMMAND_2026-11-16B.md`)이 진행 중이면 그 작업을 먼저 끝낸다. 이 지시의 작업 1·2는 서로 다른 파일이라 병행해도 된다.

## 작업 1 · 실패 원인 구분과 화면 안내

1. `retrieve()`가 `null` 대신 실패 사유를 돌려주게 한다: `INVALID_URL`, `BLOCKED_DESTINATION`, `ROBOTS_DISALLOWED`, `ROBOTS_AI_RESTRICTED`, `ACCESS_RESTRICTED`(401·403·로그인·유료 표지), `NOT_HTML`, `TOO_LARGE`, `TIMEOUT`, `SCRIPT_RENDERED`(HTML은 받았으나 본문 없음·스크립트 데이터만 있음), `TOO_SHORT`(본문 100자 미만).
2. `analyze-url.ts`가 사유별 한국어 안내를 돌려준다. 예: `ROBOTS_AI_RESTRICTED` → "이 매체는 자동 수집을 제한하고 있어 링크로 가져오지 않습니다. 본문을 붙여 넣어 주세요."
3. 화면: 실패하면 "본문 직접 입력" 탭으로 자동 전환하고 입력란에 초점을 둔다. 입력한 링크는 `sourceUrl`로 보존해 결과에 원문 주소를 표시한다.
4. 로그에는 호스트와 사유 코드만 남긴다(전체 URL·본문 없음).

## 작업 2 · 서버 본문 추출 개선 (스크립트 실행 없음)

`lib/server/article-extraction.ts`에 아래 순서의 추출을 추가한다. 앞 단계가 300자 이상을 얻으면 멈춘다.

1. 기존 본문 선택자.
2. JSON-LD: `@graph`·배열·`NewsArticle`/`Article`/`ReportageNewsArticle`의 `articleBody`.
3. `<script id="__NEXT_DATA__" type="application/json">`를 JSON으로 파싱해 `articleBody|content|body|text` 키의 가장 긴 문자열(HTML이면 태그 제거).
4. `<link rel="amphtml">`이 **같은 등록 도메인**이면 AMP 주소로 한 번 더 가져온다(전체 요청 횟수 제한에 포함).
5. 일반 추출: `<article>`·`<main>` 안, 없으면 문서 전체에서 연속한 `<p>` 묶음 중 글자 수가 가장 많은 것. 메뉴·추천 기사·저작권·기자 구독 안내 문구 제거. 링크 글자 비율이 30%를 넘는 묶음은 제외.
6. `og:title`·`<title>`·`article:published_time`·JSON-LD `datePublished`로 제목·발행일 보완. 본문 날짜를 추정하지 않는다.

`<script>` 안의 임의 JS 객체(예: `Fusion.globalContent = {...}`)는 JSON으로 안전하게 잘라낼 수 있을 때만 파싱하고, `eval`·`Function`을 쓰지 않는다. 추출 방법을 `extractionMethod`로 결과에 남긴다.

## 작업 3 · 공개 가져오기 (C2)

새 모듈 `lib/server/open-retrieval.ts`. 기존 허용 목록 호스트는 지금 경로를 그대로 쓰고, 목록 밖 주소만 이 경로로 보낸다. 환경 변수 `ENABLE_OPEN_FETCH=true`일 때만 동작한다(기본 false).

### 3-1. 목적지 검사 (요청 전, 이동할 때마다 다시)
- `https:`만. 사용자 정보·포트 지정·끝점 `.` 거부.
- 호스트가 IP 리터럴(IPv4·IPv6·10진/16진 표기)이면 거부.
- `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.lan`, 점이 없는 호스트 거부.
- 공개 접미사 목록 기준으로 등록 도메인이 있어야 한다.
- **DNS 확인:** `https://cloudflare-dns.com/dns-query`(DoH, `accept: application/dns-json`)로 A·AAAA를 조회해 모든 주소가 공인 대역인지 확인한다. 사설(10/8, 172.16/12, 192.168/16), 루프백, 링크로컬(169.254/16, fe80::/10), CGNAT(100.64/10), 메타데이터(169.254.169.254), 고유 로컬(fc00::/7), 0.0.0.0/8, 멀티캐스트가 하나라도 있으면 `BLOCKED_DESTINATION`. 조회 실패도 거부. 결과는 호스트별 5분 캐시.
- 거부 목록(`lib/data/fetch-denylist.json`): AI 수집 제한이 확인된 매체(조선·중앙·한겨레·경향·매경·국민·한국일보·KBS·MBN·연합뉴스·노컷·뉴스타파·뉴스토마토 등 11-05 조사 결과)와 운영자가 추가한 호스트. 이 목록은 robots 확인보다 먼저 적용한다.

### 3-2. robots.txt
- 호스트별 `/robots.txt`를 가져와 1시간 캐시(2xx만 규칙으로 사용, 404는 허용, 401·403·5xx·시간 초과는 **거부**).
- 사용자 에이전트 그룹 선택: 우리 UA 토큰 → `*`.
- 다음 중 하나라도 해당하면 가져오지 않는다.
  - 선택된 그룹이 해당 경로를 `Disallow`.
  - `ClaudeBot`, `anthropic-ai`, `GPTBot`, `CCBot`, `Google-Extended`, `PerplexityBot`, `Applebot-Extended`, `Bytespider` 중 **어느 하나라도** 사이트 전체(`/`)를 막고 있음 → `ROBOTS_AI_RESTRICTED`. (우리 분석은 본문을 AI에 보내므로 AI 수집 제한 의사를 넓게 존중한다.)
- 응답의 `x-robots-tag`와 `<meta name="robots">`에 `noai`·`noimageai`·`nosnippet`·`noarchive`가 있으면 중단(기존 규칙 확장).

### 3-3. 요청 제한
- UA는 정직하게: 기존 `NaeinfoClear/0.1 (article analysis; user-requested fetch)`에 사이트 주소를 덧붙인다.
- 한 분석에서 목적지 요청 최대 3회(본문 1 + 이동/AMP 2). 이동은 같은 등록 도메인 안에서만.
- 5초 제한, 2MB 제한, `text/html`만.
- **호스트별 속도 제한:** 같은 호스트에 3초에 1회, 1분에 5회, 하루 200회(D1 테이블, 원자적). 초과는 `TIMEOUT`이 아닌 별도 `HOST_RATE_LIMITED`.
- 401·403·429를 받은 호스트는 1시간 동안 다시 요청하지 않는다(음성 캐시).
- 사용자별 기존 분당 3회·시간당 20회 한도는 그대로 적용된다.
- 쿠키·인증 헤더를 보내지 않는다. 응답의 `Set-Cookie`를 저장하지 않는다.

### 3-4. 접근 제한 표지
- JSON-LD `isAccessibleForFree:false`, 페이지의 로그인·구독 유도 표지(기존 규칙)가 있으면 `ACCESS_RESTRICTED`. 본문 일부만 있어도 분석하지 않는다.

### 3-5. 결과 표기
- 응답에 `retrieval: {mode:'open'|'allowlisted', host, robotsCheckedAt, extractionMethod}`.
- 화면: "허용 목록 밖 매체에서 가져온 본문입니다. 추출이 정확하지 않을 수 있어요."와 원문 링크.
- 목록 밖 매체 기사는 편향 상대 비교의 비교 집합에 넣지 않고, 사전 계산·캐시 공유(공개 edge 캐시)에도 넣지 않는다. 사용자별 캐시만 쓴다.
- Reuters 신뢰 가중치 표에 없는 매체는 기존대로 가중치 계산 보류.

## 작업 4 · 포털 링크

- `n.news.naver.com`, `news.naver.com`, `v.daum.net`의 robots.txt를 실제로 확인해 기록한다. 허용되면 전용 선택자(네이버 `#dic_area`, 다음 `div.article_view`)와 **원문 언론사 주소**(페이지의 "기사원문" 링크) 추출을 추가하고, 결과의 매체는 포털이 아닌 원 언론사로 표시한다. 막혀 있으면 `ROBOTS_DISALLOWED`로 두고 붙여넣기 안내만 한다.

## 작업 5 · 검증

1. 단위 테스트: 목적지 검사(IP 표기 변형, 사설 대역 DNS 응답, 이동으로 사설 주소 유도, 포트·사용자 정보), robots 해석(그룹 선택, AI 봇 차단, 실패 시 거부), 속도 제한, 추출 단계별 고정 HTML(직접 작성한 가상 페이지. 실제 기사 HTML을 테스트 파일에 넣지 않는다).
2. 실제 점검(opt-in 스크립트 `scripts/check-open-fetch.mjs`): 허용 목록 밖 매체 10곳의 기사 1건씩 + 거부 대상 3곳 + 포털 2곳. 기록: 호스트, 사유 코드 또는 추출 방법, 본문 길이, 소요 시간. 결과는 `docs/test-runs/open-fetch-2026-11-16.json`(URL·본문 제외).
3. 추출 품질: 성공한 기사에서 첫 문장과 마지막 문장이 본문에 해당하는지 Codex가 눈으로 확인해 건수만 기록한다.
4. `npm run typecheck`, `npm test`, `npm run build` 1회.

## 완료 기준

- 허용 목록 밖 매체 10곳 중 7곳 이상에서 300자 이상 본문 추출과 분석 완료.
- 거부 대상 3곳이 요청 없이(또는 robots 확인 뒤) 정확한 사유로 거절.
- 사설 주소·이동 유도 테스트 전부 통과.
- 실패 시 화면이 붙여넣기 탭으로 전환.

## 배포

로컬 검증이 끝나면 `ENABLE_OPEN_FETCH`를 켠 배포안과 점검 결과를 `LINK_FETCH_STATUS.md`에 정리하고 사용자 확인을 기다린다. 확인 전에는 공개 사이트의 설정을 바꾸지 않는다.
