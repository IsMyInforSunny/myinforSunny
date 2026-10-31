> 폐기된 설계 이력입니다. 아래 Cloudflare 가입·키 입력·연결 절차를 실행하지 마세요. 현재는 Sites 호스팅과 무료 Groq 전용 v4.1이며 implementation-status.md와 groq-pilot.md를 따릅니다. 이 문서의 미연결 상태는 현재 운영 사실이 아닙니다.

# PC를 꺼도 접속되는 무료 공개 운영

2026-10-30 기준. 사이트는 기존 Sites 주소에서 실행하고, 실제 AI는 Cloudflare Workers AI REST API로 호출합니다. 사용자 PC에서 서버를 실행하지 않습니다. GitHub는 선택적인 소스 저장소이며 현재 서버 API를 GitHub Pages에 그대로 배포할 수는 없습니다.

## 현재 상태

무료 제공자 연결 코드와 한도 오류 처리는 구현했습니다. Cloudflare 계정·토큰을 아직 연결하지 않아 공개 사이트의 직접 입력 분석은 비활성이고 예시만 동작합니다. 실제 모델의 한국어 품질·응답 시간은 연결 후 검증합니다. 공개 호스팅의 요금·접근 정책은 이용 중인 Sites 계정 조건에 따르며 장기 무료를 보장하는 계약은 아닙니다.

## 1. 무료 가입

1. https://dash.cloudflare.com/sign-up 에서 계정을 만들고 이메일 인증을 완료합니다.
2. 도메인 추가·구매는 필요하지 않습니다. Workers 요금제는 **Free**를 유지합니다. 카드 등록, Workers Paid 전환, 유료 서비스 활성화를 하지 않습니다.
3. 대시보드의 Workers AI에서 **Use REST API**를 엽니다.
4. **Create a Workers AI API Token**으로 해당 계정의 Workers AI 전용 토큰을 만듭니다. 모든 서비스에 접근하는 Global API Key를 사용하지 않습니다.
5. 같은 화면의 Account ID를 확인합니다. 토큰·비밀번호를 채팅이나 GitHub에 붙여 넣지 않습니다.

## 2. PC에서 토큰을 안전하게 입력

프로젝트 폴더에서 PowerShell을 열어 실행합니다.

```powershell
./scripts/setup-free-ai.ps1
```

실행 정책 때문에 스크립트 실행이 차단되면 시스템 실행 정책을 바꾸지 말고 Codex에 알려 주세요.
`FREE`를 입력해 무료 요금제를 확인한 후 Account ID와 토큰을 입력합니다. 토큰 입력은 화면에 표시되지 않습니다.
설정은 Git에서 제외하는 `.env.cloudflare.local`에 저장됩니다. 기존 OpenAI 키 파일을 수정하지 않습니다. 이 파일은 운영체제의 일반 로컬 파일이므로 공유하지 마세요.
완료 후 Codex에 **“Cloudflare 로컬 설정 완료”**라고 알려 주세요. Codex가 값을 출력하지 않고 Sites의 서버 비밀 환경 변수로 전달한 뒤 실제 분석을 확인합니다. 파일을 채팅에 첨부하지 않습니다.

## 운영 설정과 한도

운영 환경은 `AI_PROVIDER=cloudflare`, `FREE_ONLY=true`, `CLOUDFLARE_ACCOUNT_ID`, 비밀값 `CLOUDFLARE_AI_TOKEN`을 사용합니다. `ENABLE_LIVE_ANALYSIS=true`는 키 검증 후 적용합니다. D1에는 원문 없이 호출 계수만 저장합니다.

- 무료 제공자 한도에 도달하면 분석을 중단합니다. OpenAI로 우회하거나 유료로 자동 전환하지 않습니다.
- Cloudflare **Free** 요금제에서 하루 10,000 Neurons가 무료입니다. Neurons는 글자 수·분석 횟수·토큰 수와 다릅니다. 이 사이트 외의 계정 내 AI 사용량도 합산됩니다. 무료 횟수를 고정해서 약속하지 않습니다.
- 사이트 자체의 일일 토큰 한도와 사용자별 요청 제한은 남용 완화용입니다. 공급자의 청구 한도를 대체하지 않습니다. **무료 유지의 실제 경계는 Cloudflare 계정의 Free 요금제**입니다. 계정을 유료로 바꾸면 이 코드만으로 무과금을 보장할 수 없습니다.
- 무료 모드는 자동 보완 재호출을 하지 않습니다. 부분 결과는 판단 유보로 표시합니다. 사용자가 다시 실행하거나 자료 대조를 요청하면 각각 새 호출입니다.
- 모델은 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`로 고정했습니다. 한국어 품질은 별도 검증이 필요합니다.
- 무료 모델의 문맥 한도를 위해 프롬프트·스키마를 포함한 보수적 바이트 제한을 적용합니다. 화면 최대 길이 이내여도 전체 자료가 많으면 분할 입력 안내를 반환할 수 있습니다.
- 외부 검색은 연결하지 않았습니다. 자료를 붙여 넣어 대조하는 기능을 사용합니다.

## 근거

- 요금: https://developers.cloudflare.com/workers-ai/platform/pricing/
- 토큰·계정 설정: https://developers.cloudflare.com/workers-ai/get-started/rest-api/
- JSON 출력: https://developers.cloudflare.com/workers-ai/features/json-mode/

무료 정책과 모델 제공 여부는 변경될 수 있습니다. 검증 전 정확도·진실 확률을 주장하지 않습니다.
