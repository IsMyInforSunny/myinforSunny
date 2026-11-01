# 사용자 요청에 따른 작업 중단

후속 상태: 사용자의 약 10분 재개 요청으로 아래 UI 중간 작업을 통합했다. 최신 상태와 다음 작업은 `docs/SESSION_2026-11-02_CANVA_WIRING.md`를 확인한다. BAZE 자동 전환은 여전히 미구현이다.

배터리 부족으로 사용량 확인만 마치고 개발 작업을 중단하라는 사용자 지시를 받았다. 다음 명시적 재개 요청 전에는 작업하지 않는다.

## BAZE 확인 결과

- 로그인된 https://app.baze.co/dashboard/account/my-page?tab=usage 화면 확인.
- 월간 크레딧: 11,445 / 20,000 사용, 57.225%, 잔여 8,555.
- 월간 95% 기준: 19,000 사용. 확인 시점 기준 추가 7,555까지.
- 별도 내 크레딧: 0 / 5,050 사용.
- 월간 갱신일: 2026-12-01.
- 화면의 단위는 크레딧이다. 모델 토큰 집계를 BAZE 과금량으로 대신 사용하면 안 된다.
- 매일 00시 5,000 충전은 사용자 설명이며 아직 계정 조건을 확인하지 않았다.
- 자동 사용량 감시, 95% 전환, ChatGPT 인증/전환 경로는 미구현이다. 현재 설정은 factchat(BAZE)이며 자동 전환이 동작한다고 주장하지 않는다.
- 공식 Codex 문서에서 공급자 선택은 확인했지만 사용량 임계치 자동 전환은 확인하지 못했다: https://learn.chatgpt.com/docs/config-file/config-advanced

## UI 작업 중간 상태

사용자 목표는 Canva 시안을 메인 화면 자체로 만들고 기존 틀을 전면 교체하는 것이다.

- components/forecast-home.tsx: 큰 소개 문구를 제거하고 단일 inforcast/태양 헤더로 변경 저장.
- tests/forecast-home.test.ts: 해당 새 헤더 기대값 수정 저장.
- components/canva-dashboard.tsx: 연결된 Claude 쪽에서 article 슬롯, canva-reading-layout, canva-analysis-side 구조가 저장된 것을 확인. 중복 브랜드와 소개 문구 제거됨.
- Workbench에서 article 슬롯을 연결하는 통합 작업과 메인 CSS 교체는 아직 하지 않았다. 기존 Workbench 입력/상세 분석 로직은 그대로다. UI 개편은 완료가 아니다.
- Claude Code CLI 읽기 전용 검토는 완료, 파일 변경 없음. 검토 핵심은 앵커/결과 포커스/버튼 목적지 보존, stale 경고와 demo/live 표시 유지, 게이지가 진실 확률로 읽히지 않도록 설명 유지, 수치 분모/유보 유지다.
- 이번 변경 후 typecheck/test/build와 브라우저 QA는 아직 실행하지 않았다.
- 공개 배포는 하지 않았다.
- Canva 원본: https://www.canva.com/design/DAHZoL7I6ps/yLx37BVvuH9WGfcu0WKieQ/edit
- 읽기 전용 원본 확인용 스크린샷은 output/playwright/canva-reference.png. canva-page3.png는 쿠키 안내에 가려 유효한 참고 이미지가 아니다.
- 기존 로컬 서버에서 HMR 중 Invalid hook call로 / 500이 발생했다. 재개 시 서버를 새로 시작해 확인한다.

## 재개 시

사용자의 재개 요청을 받은 뒤 현재 파일 상태와 Claude 편집 종료 여부를 먼저 확인한다. UI 슬롯/스타일 통합과 검증을 완료하고, BAZE 실제 사용량 조회 및 ChatGPT 전환 지원 여부를 별도로 해결한다. 사용자에게 로그인 비밀번호나 키를 채팅으로 요청하지 않는다.
