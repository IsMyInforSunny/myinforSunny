# 2026-11-04 배포 기록

## 공개 버전 32

- URL: https://naeinfo-clear-code2026.mseohyeon190.chatgpt.site
- 사이트: `appgprj_6ae3429835008191a962b2cb5cea6b23`, 공개 범위 유지.
- 버전: 32, `appgprj_6ae3429835008191a962b2cb5cea6b23~appgver_a7ecb4268ef081919953212a7390e120`.
- 배포: `appgdep_6aeaa50b33648191b774ccb116e92155`, `succeeded`.
- Sites 소스: `76f85dd10a14b3c1587e536ab385355b710b7789`.
- GitHub 구현: `b5363eb81155aadf0db5443933ec981ffb1035f6`, `codex/reliability-bias-2026-11-02`.
- 환경 revision 6 유지. 키·검색 활성화·외부 제공자 설정은 변경하지 않았다.
- 배포 후 `/api/health`: `ok`. `/api/capabilities`: `live:true`, `webSearch:false`, `webFetch:false`, `directFetch:false`.

변경은 [공개 기사 URL 근거 대조](DIRECT_EVIDENCE_2026-11-04.md)에 정리했다. 직접 URL 연결은 코드·모의 검증까지 완료했으나 운영에서 활성화하거나 실제 기사와 모델을 함께 대조한 것은 아니다. 실제 편향 모델은 `null`이며 편향 게이지는 대기 상태다.

검증: 웹사이트 전용 Vitest 651개 통과/실제 API opt-in 13개 제외, 타입 검사·빌드 통과. 로컬 브라우저에서 모의 API를 통한 신규 직접 대조와 기존 자동 조사 흐름을 검사했다. 이번 외부 모델·검색 호출은 0회다.
