# 로컬 실행 환경 준비 결과

검증일: 2026-11-01, Asia/Seoul. 작업 위치는 `디지털새싹_cmd`다. 이전 원본 및 공개 배포 환경을 수정하지 않았다.

## 변경

- 사용자 요구를 루트 `AGENTS.md`에 기록했다. Canva UI·3축·모듈 분리·Claude 협업·좌표의 근거·무료 한도·비밀키 보호·검증 범위를 포함한다.
- 잠금 파일을 사용해 의존성 699개를 설치했다. Node.js v26.13.0 / npm 11.20.0에서 실행했다.
- 첫 `npm ci`에서 누락된 `@emnapi/core`, `@emnapi/runtime`의 중첩 의존성 항목을 잠금 파일에 보완했다. 기존 패키지 버전 변경과 삭제는 없었다. 원래 잠금 파일은 무시된 `.sites-runtime/package-lock.before-local-setup.json`에 보존했다.
- 키 없는 `.dev.vars`를 만들고 실시간 분석·외부 검색·유료 제공자를 비활성화했다. 키나 원문 자료를 복사하지 않았다.
- 로컬 전용 `wrangler.local.jsonc`와 `npm run db:local`을 추가했다. 기존 개발 서버와 같은 가상 DB ID 및 `.wrangler/state/v3/d1` 저장 위치를 사용한다.
- `npm run dev:local`, `npm run check:local`, `환경설치.cmd`, `웹사이트-시작.cmd`, `docs/LOCAL_DEVELOPMENT.md`를 추가했다.
- 개발 서버의 파일 접근 차단에 `.dev.vars`, `.dev.vars.*`, `.wrangler`를 추가했다.

## 실제 확인 결과

| 확인 | 결과 |
|---|---|
| 의존성 설치 및 `npm ls --depth=0` | 성공, 누락 없음 |
| TypeScript 검사 | 성공 |
| Vitest | 30파일 통과, 270시험 통과, 실제 API 시험 13개 건너뜀 |
| 프로덕션 빌드 | 성공 |
| 로컬 D1 | SQL 마이그레이션 4개 적용, 재실행 시 추가 적용 없음 |
| 개발 서버 | `http://127.0.0.1:5173/` 기동 |
| `/`, `/analyze`, `/popup`, `/methodology` | 모두 HTTP 200, HTML 응답 |
| `/api/health` | HTTP 200, `status=ok` |
| `/api/capabilities` | live / webSearch / webFetch 모두 false |
| `supported` 가상 분석 | HTTP 200, mode=demo |
| 비활성 실시간 분석 요청 | HTTP 503, 모델 호출 전 거절 |
| `/.dev.vars` 웹 요청 | HTTP 403 |

검사는 실행 중인 로컬 개발 서버를 대상으로 했다. HTTP 검사는 브라우저 상호작용·모바일 화면·실제 모델 정확도·공개 배포 검증과 다르다.

## 협업·제한

Claude Code 읽기 전용 환경 검토를 요청했으나, 프로젝트 파일을 Claude에 전달하는 별도 권한이 명확하지 않다는 자동 승인 판단으로 실행 전 차단됐다. 사용자에게 허용 파일과 제외 범위를 명시해 추가 확인을 요청했다. Claude는 실행되지 않았고 변경한 파일도 없다. 설치와 자체 검증은 Codex가 수행했다.

현재 Node 버전의 `module.register()` 폐기 예정 경고와 Vite의 lucide-react 의존성 최적화 경고가 나타났다. 타입·시험·빌드·HTTP 확인은 통과했으며, 경고를 실패 또는 정확도 검증으로 혼동하지 않는다.

외부 기사 검색·실제 Groq 추론·사람 평가·공개 배포·기존 BAZE 인증 설정 변경은 수행하지 않았다. 이후 실제 API 사용 전 기존 무료 조건·동의·한도 규칙을 다시 따른다.
