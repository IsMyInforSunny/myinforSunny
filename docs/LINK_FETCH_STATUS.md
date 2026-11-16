# 링크 가져오기 작업 상태 · 2026-11-16 회차 D

| 목표 | 완료 | 막힌 것 | 다음 작업 |
| --- | --- | --- | --- |
| B 링크·추출 | AMP·Daum·Naver 로직 및 원 언론사 화면 연결, 회귀 테스트 완료 | 원격 Worker probe 인증 없음; 실제 15 URL 입력 세트 미제공 | 운영 인증·URL 세트 준비 뒤 `check:links` 실행 |

## 차단 항목 (세 줄)

- 막힘: 배포 Worker가 내부망 주소 연결을 막는지 확인하기 전 C2/C1 경로를 선택할 수 없다.
- 확인된 사실 (2026-11-16): `wrangler whoami`가 미인증; local Wrangler에서 127.0.0.1·169.254.169.254·::1은 Error, 10.0.0.1·192.168.0.1은 TimeoutError라 차단 증거가 아니다.
- 선택지: 인증된 비공개 remote probe(권장, 배포 설정 변경 없음) / 운영자가 이미 가진 remote probe 결과로 C1 또는 C2 지정.

## 완료한 독립 작업

- AMP 후보를 같은 등록 도메인으로 제한하고 robots 확인 뒤 전체 목적지 최대 3요청 안에서 추출을 재시도한다.
- `v.daum.net` robots 404 허용 처리·`div.article_view` 본문·언론사 원문 링크 추출을 연결했다. 네이버 robots 차단은 기사 페이지 요청 전에 거절한다.
- 2026-11-05 AI 수집 제한 매체의 등록 도메인 denylist와 조회 헬퍼를 추가했다.
- `scripts/check-open-fetch.mjs` opt-in 조건: `ENABLE_OPEN_FETCH_CHECK=true`, 줄바꿈 또는 세미콜론으로 구분한 15개 `OPEN_FETCH_CHECK_URLS`, `ALLOWED_RETRIEVAL_HOSTS`. 기사 본문·URL은 출력/산출물에 저장하지 않고 호스트·사유/추출법·길이·시간만 기록한다. 기본 실행은 skip.
- 원격 접속 검증 전 C2 통합은 비활성 상태다. 공개 설정·배포를 변경하지 않았다.

## 검증

- `npm run typecheck` 통과.
- URL·추출·포털·denylist·robots 관련 테스트 53건 통과.
- `check:links` 실URL 15건은 원격 경로 선택 이후 실행할 것; 응답 본문은 저장하지 않는다.

## 2026-11-16 D 회차 통합 메모

- `npm run check:links` 고정 명령을 추가했다. 이번 실행은 `ENABLE_OPEN_FETCH_CHECK=true`와 URL 15개가 설정되지 않아 명시적으로 skip; 실제 URL 결과 파일을 만들지 않았다.
- Daum 포털 URL은 `v.daum.net`만 고정 허용하고 분석 결과에 원 언론사 URL·호스트를 보존해 출처 패널에 표시한다. 사용자 입력/인증 정보와 기사 본문은 점검 산출물에 넣지 않는다.
- 원격 Worker 내부 주소 probe는 인증 부재로 아직 미확인이다. 로컬 timeout은 차단 증거로 보지 않는다. C2 공개 켜기/C1 범위 결정은 하지 않았고 공개 설정·배포도 변경하지 않았다.
