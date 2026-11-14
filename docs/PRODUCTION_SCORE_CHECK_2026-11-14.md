# 배포 사이트 실제 기사 검사 · 2026-11-14

대상: https://naeinfo-clear-code2026.mseohyeon190.chatgpt.site

사용자는 배포 사이트에서 실제 기사로 점수 산출과 화면 조작을 요청했다. in-app Browser는 `Browser is not available: iab`, 연결 목록 `[]`여서 화면 클릭·입력 검사는 수행하지 못했다. 아래는 공개 배포 서버 API 검사이며 브라우저 검사로 보고하지 않는다.

## 수정 및 배포

- 실제 [데일리안 기사](https://www.dailian.co.kr/news/view/1667349/) 입력은 기존 배포에서 HTTP 422 `ARTICLE_BODY_UNAVAILABLE`였다. 같은 origin의 제목 포함 주소로 이동하는 처리가 배포본에 없었다.
- 검증한 로컬 기사 이동 처리, 문장 SVM 연결 경로, 기사 집계 진단 및 불확실성 범위를 배포 소스에 동기화했다. 기존 공개 audience를 유지했다.
- AI 연결과 SVM 준비 여부를 혼동하지 않도록 `/api/capabilities`에 `biasModel`을 추가했다. 키·본문·가중치는 노출하지 않는다.
- 활성 SVM이 없거나 지원 주제가 아니면 분석을 `partial`로 표시하고 편향 미완료 사유를 반환한다. 이 계약 변경을 반영해 캐시 버전을 갱신했다.
- 타입 검사 통과, 테스트 990개 통과·13개 건너뜀, Sites helper 빌드·소스 push·archive 생성 성공.
- Sites 버전 44, 소스 `948965aa680caa175b8528e6c2b5c39a1da47da1`, 배포 `appgdep_6af7f390c2d48191a16a75956f54255d` 성공.

## 실제 배포 결과

동일 기사 URL로 캐시 miss HTTP 200, 10.918초. 본문 839자 전체, 주장 5개, 표현 분석 18개를 반환했다. 최종 URL과 발행일을 보존했다. 공급자는 기존 NVIDIA Nemotron이며 별도 유료 제공자나 키 복사는 추가하지 않았다.

`biasModel.ready=false`, `method=null`, `version=null`, `topics=[]`다. 분석에는 `VOICE_MODEL_UNAVAILABLE` 경고가 붙는다. 이 배포는 본문 취득 오류와 잘못된 완료 표시를 고친 것이며 최종 편향점수 산출을 완성하지 못했다.

## 남은 작업

운영 아티팩트는 여전히 null이다. 연구 후보의 기사별 산출 안정성, 데이터 이용 근거 검토, 같은 사건·쟁점 비교 집합 확보, 운영 모델 활성화 및 실제 Browser 화면 검증이 필요하다. 임의 점수, 유보 문장의 중립 치환, 비교 기사 수 조건 완화, 미검토 데이터의 승인 상태 조작으로 해결하지 않는다. 원전 일부 쟁점 연구 후보를 일반 기사 전체 모델이라고 표시하지 않는다.

실제 응답·상세 점수·본문은 ignored `.sites-runtime/deploy-score-fix-20261114/`에만 보존한다.
