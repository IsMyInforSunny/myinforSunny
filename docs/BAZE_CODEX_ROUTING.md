# BAZE → ChatGPT 실행 시 제공자 선택

2026-11-02 구현. 웹사이트의 Groq 설정과 별개인 코딩용 Codex CLI 기능이다.

## 적용한 동작

`CLI-시작.cmd`를 더블클릭하면 로컬 월간 크레딧 기록으로 제공자를 선택한다.

- 15분 이내에 확인한 월간 크레딧 사용량이 95% 미만이면 BAZE/factchat을 선택한다.
- 95% 이상, 기록 없음, 형식 오류, 15분 초과 또는 월간 갱신일 도래 시 ChatGPT 로그인 경로를 선택한다.
- ChatGPT 로그인 확인 실패 시 실행을 중지한다. API 키 과금으로 대체하지 않는다. 사용자 전역 설정이나 인증 파일을 변경·복사하지 않는다.
- 모델은 기존 gpt-6.1-sol을 유지한다. 같은 대화 ID를 명시적으로 재개하고 현재 프로젝트를 -C로 고정한다. 다른 창에서 같은 대화를 실행 중이면 정상 종료한 뒤 재개한다.
- API 키·커스텀 OpenAI URL 환경변수는 ChatGPT 자식 프로세스에서 제외한다. OpenAI 공급자/ChatGPT URL을 덮어쓰는 로컬 설정이 있으면 검토 전 실행하지 않는다.

## 사용량 확인과 등록

`BAZE-사용량-확인.cmd`를 열면 사용량 페이지가 열리고 **월간 크레딧 사용량·월간 한도·다음 갱신일**을 입력할 수 있다. 개인 보유 크레딧이나 모델 토큰을 입력하지 않는다. API 키는 입력할 필요가 없다.

직접 명령으로는 다음 형식이다. 숫자는 실제 화면에서 새로 확인해야 한다.

```text
node scripts/codex-routing.mjs record --used <월간사용량> --limit <월간한도> --renewal <YYYY-MM-DD>
node scripts/codex-routing.mjs status
node scripts/codex-routing.mjs auth-check
```

ChatGPT 경로를 직접 선택하거나 다른 대화를 재개할 때:

```text
node scripts/codex-routing.mjs start --provider chatgpt
node scripts/codex-routing.mjs start --session <대화 UUID>
```

기록은 Git에서 제외하는 `.sites-runtime/baze-monthly-usage.json`에만 저장한다. 키·쿠키·원문·계정 ID는 저장하지 않는다. 예전 확인값은 최신값으로 등록하지 않았다. 한국시간 매일 자정에 월간 사용량을 0으로 초기화하거나 5,000을 임의로 더하지 않는다.

## 자동화의 범위와 미완료 사항

**자동 제공자 선택은 시작 시점에만 적용된다. BAZE 사용량 자동 조회·상시 감시·실행 중 제공자 교체는 구현하지 않았다.** 사용량 기록은 사람이 확인한 값이며, 15분 유효기간도 실제 최신 잔여량을 보장하지 않는다. BAZE로 시작한 긴 작업이 실행 도중 95%를 넘는 것을 차단하지 못한다. 기록이 없으면 BAZE를 사용하지 않고 ChatGPT 경로를 선택한다.

현재 브라우저 접근 호스트가 연결되지 않아 로그인된 BAZE 대시보드의 새 사용량을 확인하지 못했다. 공개 자료에서 계정 크레딧 조회용으로 지원되는 인증 API를 확인하지 못했으므로 내부 웹 API·브라우저 쿠키 추출을 사용하지 않았다. 향후 BAZE가 제공/승인하는 읽기 전용 조회 수단이 확인되면 연결할 수 있다.

Codex CLI 0.166.0에서 `login status`, 공급자 override, `resume`, `--no-daemon` 지원과 실제 ChatGPT 로그인 상태를 확인했다. 실제 ChatGPT 모델 요청과 교차 공급자 세션 재개 성공은 이번 검증에서 실행하지 않았다. 로그인은 모델별 권한·잔여량·청구 내역 검증을 대신하지 않는다. 현재 열려 있는 이 대화의 제공자를 변경한 것도 아니다.

## 근거

- [OpenAI 인증 문서](https://learn.chatgpt.com/docs/auth): ChatGPT 구독 인증과 API 키 인증은 별도 경로이며 `codex login status`로 인증 방식을 확인한다.
- [Codex resume 문서](https://learn.chatgpt.com/docs/developer-commands?surface=cli): 기존 대화 재개에 모델/설정 override를 사용할 수 있다.
- [BAZE 이용약관](https://baze.co/legal/terms/): 공식 제공·승인 API와 자동 데이터 수집을 구분한다. 계정 조회 지원 여부는 별도로 확인해야 한다.

검증 로그와 커밋은 이번 세션 종료 기록을 따른다. 모의 정책 시험을 실제 계정 조회·실제 모델 사용 시험이라고 보고하지 않는다.
