# 로컬 실행과 환경 설정

## 기본 실행

Node.js 22.13 이상과 npm을 준비하고 저장소 루트에서 실행한다.

```sh
npm ci
npm run dev
```

기본 포트는 5173이며 실제 출력된 Local URL을 확인한다. 예시 모드는 키 없이 사용할 수 있다. `npm run typecheck`, `npm test`, `npm run build`가 기본 검사다. 네이티브 Worker/D1 시험은 로컬 루프백 통신과 런타임 실행 권한이 필요하다. 호스트 제약으로 실패한 검사를 성공으로 간주하지 않는다.

## 서버 설정

`.env.example`은 비밀 값이 없는 안전한 샘플이다. 복사한 실제 환경 파일은 Git에서 제외하고, 호스팅에서는 서버 secret을 사용한다. 프런트엔드 공개 환경변수에 키를 넣지 않는다. 실제 호출은 모델 키 외에도 제공자·모델·실시간 스위치·계정 자격·무료 플랜·콘솔 한도 확인과 D1 바인딩이 필요하다.

| 종류 | 설정 |
|---|---|
| 모델 | AI_PROVIDER=groq, GROQ_MODEL=openai/gpt-oss-120b, GROQ_API_KEY(서버 secret) |
| 무료 정책 | FREE_ONLY=true, ENABLE_PAID_PROVIDER=false, PAID_ACTIVATION_CONFIRMED=false |
| 활성화 | ENABLE_LIVE_ANALYSIS 및 GROQ_ELIGIBILITY_CONFIRMED, GROQ_FREE_PLAN_CONFIRMED |
| 계정 한도 | GROQ_CONSOLE_LIMITS_CONFIRMED, GROQ_CONSOLE_TPD, GROQ_CONSOLE_RPD, DAILY_TOKEN_BUDGET |
| 운영 저장 | DB D1 바인딩. IP_HASH_SECRET을 별도 설정하거나 서버 키에서 용도 분리 HMAC 파생 |
| 검색 | ENABLE_NEWS_SEARCH=false, NEWS_TERMS_APPROVED=false가 안전한 기본값 |
| 취득 | ALLOWED_RETRIEVAL_HOSTS: 조건을 검토한 정확한 호스트 목록. 임의 URL 허용 금지 |
| Tavily 개발 경로 | NEWS_PROVIDER=tavily, TAVILY_API_KEY(secret), TAVILY_FREE_PLAN_CONFIRMED, TAVILY_ELIGIBILITY_CONFIRMED, TAVILY_MONTHLY_CREDITS_CONFIRMED, TAVILY_MONTHLY_CREDITS |

확인 플래그는 단순히 실행시키려고 true로 바꾸는 설정이 아니다. 실제 계정 조건·서비스 약관·사용자 승인과 한도를 확인한 후에만 사용한다. 현재 공개 사이트 검색은 비활성이며 이 문서가 활성화를 승인하지 않는다.

## D1과 배포

`drizzle/`의 순서대로 마이그레이션을 적용한다. 0000은 요청 예산, 0001은 공급자 대기, 0002는 검색 요청, 0003은 월간 검색 집계다. 0003은 최신 로컬 추가이며 공개 적용을 별도로 확인해야 한다. 테이블은 운영 메타데이터용이며 기사·사용자 분석 기록을 저장하지 않는다.

`.openai/hosting.json`에는 기존 Sites 프로젝트가 지정돼 있다. 기존 프로젝트의 소유자·배포 대상·환경을 확인하지 않고 다른 사용자가 그대로 배포하지 않도록 주의한다. `dist/`는 빌드 산출물이며 저장소에 포함하지 않는다. `npm run start`는 빌드 후 로컬 Wrangler 실행 경로다. 일반 GitHub 푸시는 기존 Sites 운영 배포를 자동 실행하도록 설정한 것이 아니다.

## 실제 시험

`tests/groq-pilot.live.test.ts`, `tests/groq-research.live.test.ts`는 opt-in이다. 기본 회귀 시험과 분리하고 승인된 키 파일은 메모리에서만 읽는다. 공개·가상 자료만 사용하고 무료 토큰 창을 지킨다. 실험 원출력과 결과는 무시되는 `.sites-runtime/`에 남을 수 있으므로 공개 저장소에 복사하지 않는다. 실패 기록을 삭제·성공 기록으로 덮어 전체 성능을 주장하지 않는다.

Python 연구 도구는 `research/requirements.txt`를 별도 환경에 설치한다. 공개 서비스의 LLM 경로와 별개이며 합성·사람 라벨·운영 모델을 구분한다.
