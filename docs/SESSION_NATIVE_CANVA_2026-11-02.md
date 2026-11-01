# Canva 원본 중심 메인 교체와 연결 검증

이 기록은 앞선 SESSION_2026-11-02_CANVA_WIRING.md의 기사 슬롯 배치를 대체한다. 기존 화면 틀 대신 Canva DAHZoL7I6ps 3페이지의 큰 반원 게이지, 겹쳐 놓인 편향·자극·신뢰, 하단 추천 카드와 분석근거 버튼을 메인으로 사용한다. 입력·근거·매체 좌표·작은 창 도구는 대화상자에서 동일한 분석 상태를 사용한다. 모바일은 지표를 게이지 아래에 배치한다.

## 역할과 모듈

- 열려 있는 Claude 세션에 배정한 canva-dashboard.tsx와 forecast.css의 새 구현이 저장되어 실제 화면에 반영된 것을 확인했다. 이번 후속 작업에서 새 Claude CLI 세션은 실행하지 않았다. 추가 세션 조회는 도구 승인 정책 오류로 차단되어 새 답변을 받았다고 주장하지 않는다.
- 통합 담당: forecast-home.tsx, workbench.tsx, review-dialog.tsx, layout.tsx, 회귀 검증과 기록.
- 좌표 감사 에이전트: 별도 감사와 경계 테스트. 상세는 COORDINATE_AUDIT_2026-11-02.md 및 NATIVE_CANVA_WIRING_AUDIT_2026-11-02.md.
- Sites·Playwright 스킬을 적용했다. 담당 파일 중복 수정을 피했다.

## 검증 결과

- npm run check:record: 타입 검사·272개 테스트·빌드 통과. 실제 API opt-in 13개 제외. 로그: test-runs/2026-11-01T15-14-54-329Z/.
- npm run check:local: /, /analyze, /popup, /methodology 200. live/webSearch/webFetch false, 실시간 요청503, 로컬 설정 접근403.
- 브라우저: 입력→출처에서 확인된 주장 예시→메인 신뢰1/1→근거 대화상자→주장 탭→원문 확인 시 해당 문장 강조 확인.
- Esc 후 분석근거 버튼으로 포커스 복귀. 한 번에 열린 대화상자1개 확인.
- 가상 기사6개·매체2곳, 직접 입력 입장+1, 기준선0.000, 차이1.000 확인. 실제 분석 자료와 가상 좌표 체험 분리.
- 본문 수정 시 이전 결과 경고 확인. 원문/대조 인용 내보내기 선택은 둘 다 기본 false. 파일 다운로드 자체는 이번 검증에서 실행하지 않았다.
- #selection=Public%20sample%20text 초기화 후 입력 대화상자1개와 선택 본문 반영 확인.
- 375px 모바일: 문서 폭360, 열린 대화상자 clientWidth/scrollWidth360. 가로 넘침 없음. 메인과 근거 화면 캡처 직접 확인.
- 브라우저 콘솔 오류 없음. 개발 서버 빌드 중 첫 캡처 타임아웃은 재시도로 해결.
- 로컬 캡처: output/playwright/native-main-final.png, native-main-desktop.png, native-main-mobile.png, native-evidence-mobile.png. 캡처는 Git 제외.

## 남은 범위

실시간 기사 수집·자동 입장 분류·실제 모델 정확도/사람 평가·BAZE 사용량 감시 및 자동 전환은 완료하지 않았다. 입력 입장은 현재 수동 지정한다. 같은 명제의 적격 매체별 고유 기사3개와 매체2곳이라는 조건을 유지한다. 게이지는 사실 주장 대조 진행이며 진실 확률이 아니다. 팝업 HTTP 접근은 확인했으나 별도 창 전체 조작 및 JSON 다운로드까지 완료했다고 주장하지 않는다. 공개 배포는 하지 않았다.

## GitHub 반영 원칙

사용자 요청에 따라 작업 종료 시 IsMyInforSunny/myinforSunny 저장소에 반영한다. 원격 main의 별도 Tavily 작업을 덮어쓰지 않도록 이번 로컬 스냅샷은 전용 브랜치에 기록한다. 키와 로컬 실행 환경, 브라우저 기록은 제외한다.
