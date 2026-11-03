# 운영자용 실제 분석·조사 준비 진단

프로젝트 폴더에서 다음 명령을 실행한다. 공개 화면에는 진단을 노출하지 않는다.

```powershell
node scripts/check-activation-readiness.mjs
node scripts/check-activation-readiness.mjs --config .dev.vars --bindings wrangler.local.jsonc --model lib/data/bias-model.json
```

기본 입력은 현재 폴더의 `.dev.vars`, `wrangler.local.jsonc`, `lib/data/bias-model.json`이다. `--config`에는 별도의 합성 `.vars` 파일을 지정할 수도 있다. 셸 환경의 키를 합치거나 복사하지 않으며 파일을 수정하지 않는다. 본 진단은 네트워크·모델·검색 호출을 하지 않는다.

설정에 직접 키가 없고 `INFORCAST_GROQ_KEY_FILE` 참조가 명시되어 있으면, 설정 파일의 디렉터리를 기준으로 해당 파일을 읽어 `GROQ_API_KEY` 형식만 메모리에서 확인한다. 유효한 `gsk_` 형식이면 키 존재를 `true`로 표시한다. 파일이 없거나 키 이름·형식이 다르면 `false`다. 외부 파일의 다른 키·설정은 가져오지 않고, 참조 경로와 키 값도 출력하지 않는다. 이는 인증 성공 확인이 아니므로 실제 요청 성공은 계속 `null`이다.

출력은 고정된 조건 이름과 `true`/`false`/`null`, 확인된 설정의 숫자 한도만 포함한다. 키·매체 호스트·계정 ID·설정 경로·임의 환경값·기사·질의는 출력하지 않는다. 예시:

```json
{
  "conditions": {
    "GROQ_API_KEY_PRESENT": false,
    "ENABLE_LIVE_ANALYSIS": false,
    "DB_BINDING_CONFIGURED": true
  },
  "missingConditions": ["GROQ_API_KEY_PRESENT", "ENABLE_LIVE_ANALYSIS"],
  "unknownConditions": [],
  "configuredReady": false
}
```

`true`는 파일에 필요한 구성이 있거나 해당 확인 플래그가 이미 `true`인 상태다. 기존 확인을 다시 승인받으라는 뜻이 아니다. `false`는 비활성·누락·유효하지 않은 구성, `null`은 설정 파일을 읽지 못했거나 확인할 근거가 없는 상태다. 명시하지 않은 확인 플래그는 `null`, 명시적으로 비활성화한 플래그는 `false`다. 진단 실행 성공의 종료 코드는 0이며 활성화 완료를 의미하지 않는다.

Groq은 지원 모델·키 존재·이용 자격·무료 요금제·콘솔 한도·실시간 플래그와 DB 바인딩 구성을 각각 확인한다. 일일 토큰 예산은 `min(설정 예산, 120000, 확인된 TPD×0.8)`, 요청 예산은 `min(500, 확인된 RPD×0.8)`이다. 한 요청 예약 6,500토큰이 들어가는지도 별도로 보여 준다. 콘솔 확인 플래그가 없으면 계정 한도나 예상 예산을 확인된 수치처럼 출력하지 않는다.

선택 설정 `GROQ_CONSOLE_TPM`·`GROQ_CONSOLE_RPM`은 사용자가 콘솔에서 확인해 제공한 분당 한도를 기록한다. 조직 기본 한도를 사용할 수 있으며, 이를 프로젝트별 재정의까지 검증했다는 뜻으로 해석하지 않는다. 기존 `GROQ_CONSOLE_LIMITS_CONFIRMED=true`인 경우 적용하며, 진단은 해당 플래그를 바꾸거나 재승인을 요청하지 않는다. 출력의 `consoleTokensPerMinuteConfirmed`·`consoleRequestsPerMinuteConfirmed`는 이 설정 확인을 뜻하고 `projectOverrideVerified`는 `null`이다. TPM이 명시되면 분당 토큰 상한은 `min(7000, 확인된 TPM)`이고, 6,500 미만이면 요청 전 준비 상태에서 차단한다. RPM이 명시되면 사용자 전체의 최근 60초 요청 수를 하나의 DB 예약에서 함께 제한한다. 기존 IP당 분당3회·시간당20회, 동시1개와 일일 상한은 유지한다. 명시된 RPM0 또는 잘못된 숫자도 준비 상태를 차단한다.

이미 콘솔 확인을 마친 기존 설정에서 분당 값이 없거나 빈칸이면 기존 7,000토큰/분 보호를 유지하고 새 확인 절차를 추가하지 않는다. 이 경우 분당 계정 수치는 미확인으로 표시하고 `legacyTokenSafeguardUsed:true`로 구별한다. 현재 프로젝트에 더 낮은 값이 확인되면 해당 선택 설정을 추가해 기존 보호를 강화한다. 현재 사용자가 제공한 Free 요금제의 조직 기본값은 RPM30·RPD1000·TPM8000·TPD200000이며 프로젝트별 재정의는 미확인이다. 사이트는 기존의 더 낮은 분당7,000토큰·일일120,000토큰·일일500회·동시1개를 유지한다. 공급자가 더 낮은 실제 한도를 적용해 거절하면 기존 오류·대기 처리를 따르며 자동 재시도나 유료 전환을 하지 않는다.

GDELT와 Firecrawl 조건은 각각 표시하되 `research`는 선택된 공급자만 평가한다. Firecrawl은 무료 조건·서비스/출처 이용 조건·키·정확한 공개 호스트 목록·크레딧 예산을 확인한다. 크레딧 한도는 `min(설정 예산, 확인된 크레딧×0.8, 800)`이며 검색 비용은 최소 2, 본문 취득 비용은 최소 1이어야 한다. 남은 실제 크레딧이나 이미 사용한 DB 예약액은 이 오프라인 진단으로 알 수 없다. 호스트는 URL·와일드카드·포트·개인 IP 대신 정확한 공개 호스트 이름이어야 한다. 이 추가 목록 검사는 이용 허락을 대신하지 않는다.

DB 바인딩 선언은 DB 연결·마이그레이션 성공과 다르므로 후자는 `runtimeVerification`에서 `null`로 둔다. 실제 공급자의 현재 잔량·응답 성공·출처별 이용 조건의 구체적 범위도 오프라인에서 재확인하지 않는다. 이 미확인은 이미 설정된 확인 플래그를 취소하거나 새 승인 절차를 만들지 않는다.

편향 모델은 `null`, `research_only`, 검증된 실제 release를 구별한다. `bias-model.ts`의 실제 `parseBiasModel`이 검증하며, release라고 선언한 메타데이터만으로 통과시키지 않는다. 결과에는 스키마 일치 여부와 검증 통과 후의 표본 건수만 표시한다. Node의 TypeScript 지원이 없는 환경에서는 `validationRuntimeAvailable:false`와 검증 미확인 상태를 표시하므로, 지원되는 Node에서 재실행한다(현재 개발 환경 Node 26; Node 22.13에서는 `node --experimental-strip-types ...` 사용 가능).

이 파일은 운영 진단 사용법이며 외부 분석·검색 플래그를 켜거나 유료 전환·재시도·예산 확대를 수행하지 않는다. 실제 API 시험은 프로젝트의 기존 opt-in 절차에서 별도로 실행한다.
