# 기사 링크 분석 배포 · 공개 버전 36

- URL: https://naeinfo-clear-code2026.mseohyeon190.chatgpt.site
- 사이트: `appgprj_6ae3429835008191a962b2cb5cea6b23`, 기존 공개 범위 유지.
- 저장 버전: `appgprj_6ae3429835008191a962b2cb5cea6b23~appgver_d33cfa40846481918f51a122a0580a03`.
- Sites 소스: `ccb8978b9de56ba6c97d77bf42cba10ded634321`.
- 배포: `appgdep_6aec5f6c82808191b1318c2fb3a0c7e5`, `succeeded`.
- 환경 revision 8 유지. 운영 환경 변수·제공자·예산·공개 범위를 변경하지 않았다.

기본 입력을 기사 링크로 변경하고, 기존 허용된 HTTPS 원문 취득과 분석을 연결했다. 본문 직접 입력은 보조로 유지한다. 긴 기사는 처음 2,000자 이내만 분석하며 원문 주소와 부분 분석 여부를 결과에 표시한다. 상세는 [구현·검증 기록](ARTICLE_URL_INPUT_2026-11-05.md)에 있다.

타입 검사·Vitest 725개·Sites 빌드 통과, 실제 API opt-in 13개 제외. 로컬 빌드 서버와 모의 API로 링크 입력부터 결과 연결·동의 초기화·이전 입력 구분·초기화·모바일 화면을 검증했다. 실제 외부 모델·검색 호출은 하지 않았다. 모든 언론사 URL의 취득 성공이나 분석 품질을 보장하는 검증은 아니다.
