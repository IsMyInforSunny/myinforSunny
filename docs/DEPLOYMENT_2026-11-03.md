# 공개 버전20 배포 및 실제 분석 검증

2026-11-03 14:12 KST, 기존 Sites 프로젝트의 공개 범위를 유지한 채 버전20 배포가 성공했다.

- 공개 주소: https://naeinfo-clear-code2026.mseohyeon190.chatgpt.site
- Sites 소스 커밋: `a918b00a1f7223258a0ecb082dcde51d72b5e918`
- 버전:20
- 배포 ID: `appgdep_6ae96d10d0e88191b4283e7a28178610`
- 배포 상태: `succeeded`, 설정 리비전6
- GitHub 구현 커밋: `173a114415e2fe7319c89e064de1b74a269bcb19`, 브랜치 `codex/reliability-bias-2026-11-02`

기존 배포 서버의 Groq 비밀 설정을 그대로 사용했다. 배포 키 값을 읽거나 복사·교체하지 않았다. 공개 범위나 계정 접근 설정도 변경하지 않았다. 로컬 key-file 참조는 배포 비밀 설정을 대신하지 않으며 빌드에 포함되지 않는다.

## 검증 결과

- 메인·health·capabilities HTTP200, `live:true`, `webSearch:false`, `webFetch:false`.
- 공개 화면에서 가상 문장2개 입력 및 전송 동의 후 실제 분석1회 성공: HTTP200, `mode:live`, `status:success`.
- 사실1개·의견1개·표현 분석2개. 자극0점(n=2), 편향 산출 대기, 신뢰 산출 대기(n=1). 응답·화면에 키 형식 문자열 없음.
- 공개 화면 내보내기 스키마2.5, 점수 버전2.0, 현재 입력 연결, 원문·상세 출처의 기본 제외를 확인했다.
- 공개 메인375/1280px 가로 넘침 없음. 실제 화면 캡처도 확인했다.
- 배포 소스 별도 체크아웃의 타입 검사·548개 검사·빌드 통과. 일반 검사에서 실제 API13개는 제외했으며 위 실제 화면 호출은 별도로 실행했다.
- GitHub 업로드 체크아웃 타입 검사·590개 검사 통과(기존 별도 검사42개 포함), 원격 구현 커밋 일치 및 clean 확인.
- 로컬 전체 검사548개·빌드, Python 편향 인프라15개 합성 검사 및 예시7종 화면/내보내기 검사 통과.

전체 기능의 실제 뉴스 운영 완료를 뜻하지 않는다. 외부 검색·원문 취득의 실제 무료 운영 경로, 실제 기사 비교 표본과 사람 평가를 거친 SVM 편향 모델, 분석 정확도의 독립 사람 평가가 남아 있다. 모델·기사·근거가 없는 편향·신뢰 점수는 생성하지 않는다.

# 공개 버전21 배포 — 2026-11-03 19:27 KST

오후 분석 경로 보완을 공개 사이트에 배포했다. 기존 공개 주소와 공개 범위, Groq 런타임 비밀 설정은 유지했다.

- 주소: https://naeinfo-clear-code2026.mseohyeon190.chatgpt.site
- Sites 소스 커밋: `e909077c97e8ab2018a5d3a3944bc8c1bfe415a9`
- 버전: 21
- 배포 ID: `appgdep_6ae9b71924f8819198b3cde5d8cb365b`
- 상태: `succeeded`, 설정 리비전 6
- 타입 검사 및 Vinext 제품 빌드: 통과
- Vitest: 611 통과, 13 건너뜀. Python 편향 자료 준비 테스트: 24 통과.

이 배포에서는 실제 Firecrawl 검색 요청을 수행하지 않았다. CLI가 미인증이고 실제 요금제/크레딧·자료 이용 조건도 확인되지 않아 뉴스 검색과 수집은 계속 꺼져 있다. 실제 편향 모델 `lib/data/bias-model.json`도 `null`을 유지한다. 기존 Groq 비밀 값은 읽거나 복사·교체하지 않았다.
# 공개 버전23 배포 — 2026-11-03 19:34 KST

- 주소: https://naeinfo-clear-code2026.mseohyeon190.chatgpt.site
- Sites 소스 커밋: `757f948e09e4ead91aa84b7f9c7c3e75725c8a86`
- 버전: 23
- 배포 ID: `appgdep_6ae9b8b32a388191b891a237f9f9adbb`
- 상태: `succeeded`, 설정 리비전 6
- 타입 검사·Vinext 빌드 통과. Claude의 시점·검색어·코퍼스 경계 검토 후 변경을 포함한다.
- 실제 기사 검색을 연결하지 않았다. Firecrawl 인증·실제 크레딧 및 원문 사용 조건 미확인이므로 검색은 꺼져 있고 편향 모델은 `null`이다.

버전24에는 한국 시간 날짜 범위, 정규 매체 별칭 집계, 조사 검색어 NFC 정규화, 선택 검색어 검증 방어가 포함됐다.
# 공개 버전24 배포 — 2026-11-03 19:38 KST

- 주소: https://naeinfo-clear-code2026.mseohyeon190.chatgpt.site
- Sites 소스 커밋: `80541845708c83a5439f6c809e52c4e982d49bb9`
- 버전: 24
- 배포 ID: `appgdep_6ae9b9b39bc88191a01f7e9bef12bcd6`
- 상태: `succeeded`, 설정 리비전 6
- 타입 검사·Vinext 빌드 통과. Vitest 616 통과/13 건너뜀, Python 34 통과.
- 실제 Firecrawl 인증이 없어 공개 검색·수집은 계속 비활성화되어 있고 편향 모델은 `null`이다. 기존 Groq 설정과 공개 범위는 변경하지 않았다.
# 공개 버전25 문서 동기화 — 2026-11-03 19:41 KST

버전25는 버전24의 동일한 웹사이트 코드와 런타임을 사용한다. 배포 기록 갱신 뒤 빌드 자산을 다시 패키징해 게시했으며 기능 코드나 환경 설정을 바꾸지 않았다.

- Sites 소스 커밋: `ebf4730275781952ca3e745e06e3e08d6fddf4b3`
- 버전: 25
- 배포 ID: `appgdep_6ae9ba3db4788191b193d21d72f470fd`
- 상태: `succeeded`, 설정 리비전 6
- GitHub 게시 브랜치 체크아웃에서는 Vitest 658 통과/13 건너뜀, Python 34 통과를 확인했다. 추가 42개 검사는 해당 작업 브랜치에 있던 검사를 포함한다.
## 버전25 라이브 경로 점검

버전25 공개 API에서 `GET /api/health`는 `ok`, capabilities는 `live:true`, `webSearch:false`, `webFetch:false`를 반환했다. 검색 경로는 의도대로 비활성이다.

합성 문장으로 실제 Groq 분석을 한 번 요청했을 때 `mode: live` 응답은 왔지만 `status: partial`, 추출 주장 0건이었다. 두 번째 합성 요청은 `/api/analyze`에서 HTTP503을 반환했고, 재시도하지 않았다. Cloudflare 요청 ID `a91d95b26decd9a0225d7ee3be08b91b`, trace ID `9b819ea4b37305c2d1f59eccf5a14912`로 로그에서 응답 상태를 확인했다. 이는 v26의 선택 검색어 스키마 방어를 배포하기 전 확인한 결과이며, 전체 AI 분석 성공으로 확대 해석하지 않는다.
# 공개 버전26 배포 — 2026-11-03 19:51 KST

- 주소: https://naeinfo-clear-code2026.mseohyeon190.chatgpt.site
- Sites 소스 커밋: `de7468ca91a133418c82bc8fe6a188d822afcb70`
- 버전: 26
- 배포 ID: `appgdep_6ae9bca508c4819186dcb4cbbd26beaa`
- 상태: `succeeded`, 설정 리비전 6
- 타입 검사·Vinext 빌드 통과. 전체 회귀 검사: Vitest 616 통과/13 건너뜀, Python 34 통과.
- 배포 후 health `ok`, `live:true`, 검색·원문 취득 `false`를 확인했다.
- 실제 Firecrawl 인증·원문 사용 조건 및 기사 코퍼스는 아직 확보되지 않았다. 편향 모델은 `null`을 유지한다.
# 공개 버전27 문서 동기화 — 2026-11-03 19:55 KST

버전27은 버전26의 동일한 웹사이트 코드와 설정을 유지한 문서 기록 동기화 배포다.

- Sites 소스 커밋: `1b302565efc7906c0ccbf33a967aebd47d294982`
- 버전: 27
- 배포 ID: `appgdep_6ae9bd84ca6c8191bac83c157bba6858`
- 상태: `succeeded`, 설정 리비전 6

# 공개 버전28 배포 — 2026-11-03 20:48 KST

- 주소: https://naeinfo-clear-code2026.mseohyeon190.chatgpt.site
- Sites 소스 커밋: `12fb2585fdb1d44895e48cff340fb94089b2f10d`
- 버전: 28
- 배포 ID: `appgdep_6ae9ca036ed48191b4f4ac4aae72ce45`
- 상태: `succeeded`, 설정 리비전 6
- 본문·댓글·명제·참고자료 수정 시 즉시 전송 동의를 해제한다. 초기 선택 글·예시 로딩의 작업 취소와 422 검증 필드 안내도 포함한다.
- 타입 검사·변경 파일 ESLint·Vitest 616개·제품 빌드 통과. 실제 API 선택 검사 13개는 건너뛰었다. 로컬 상태 전환과 동의·검증 안내 브라우저 검사가 통과했다.
- 배포 후 공개 브라우저에서도 본문 수정·복원, 댓글 추가·수정, 명제·참고자료 수정의 재동의, 미동의 요청 차단, 가로챈 HTTP422 안내를 확인했다. 실제 text 분석 요청은 브라우저에서 가로챘고 외부 모델 요청은 0회다. 실제 예시 API 응답은 사용했다.
- 공개 health HTTP200 `ok`, capabilities HTTP200 `live:true`, `webSearch:false`, `webFetch:false` 확인. 검색·수집 설정과 편향 모델 `null`을 유지한다.
- 최근 90분의 운영 Worker 로그를 오류 전용 및 일반 조회했으나 이벤트가 반환되지 않았다. 이전 503·422 원인은 확인되지 않았다. 로컬에서는 동의 누락이 HTTP422(`transmissionConsent`), 유효한 입력이 입력 검증을 통과한 뒤 비활성 런타임에서 HTTP503으로 돌아오는 것을 확인했다. 과거 요청의 원인을 이 결과로 단정하지 않는다.
