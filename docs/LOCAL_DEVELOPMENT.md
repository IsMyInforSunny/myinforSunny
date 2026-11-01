# Windows 로컬 실행

작업 폴더는 `C:/Users/pp/Desktop/대회/디지털 새싹/디지털새싹_cmd`다. 이전 원본을 수정하지 않는다. 프로젝트 규칙은 루트 `AGENTS.md`를 따른다.

## 더블클릭 실행

- `CLI-시작.cmd`: [크레딧 기반 실행 시 선택](BAZE_CODEX_ROUTING.md)으로 기존 Codex 대화를 재개한다. 최신 월간 크레딧이 90% 미만일 때만 BAZE를 선택하며 미확인·만료·90% 이상이면 ChatGPT 로그인 경로를 선택한다. 같은 대화를 다른 창에서 열었다면 해당 창을 정상 종료한 뒤 재개한다.
- `BAZE-사용량-확인.cmd`: BAZE 사용량 페이지를 열고 월간 크레딧 사용량·한도·다음 갱신일을 수동 등록한다. 실시간 감시나 실행 중 자동 전환은 아니다.
- `환경설치.cmd`: 처음 설치하거나 잠금 파일이 바뀐 경우 실행한다. 잠금 파일 기준 의존성 설치 후 로컬 D1 마이그레이션을 적용한다.
- `웹사이트-시작.cmd`: 개발 서버를 `http://127.0.0.1:5173/`에 연다. 터미널은 계속 열어 두고 종료는 Ctrl+C로 한다. 브라우저에서 해당 주소를 연다.

실행 파일은 실패해도 창을 남긴다. 포트가 이미 사용 중이면 임의 포트로 바꾸지 않으므로 먼저 기존 개발 서버를 확인한다.

## 명령으로 실행

Node.js 22.13 이상과 npm이 필요하다. 현재 잠금 파일을 유지하며 다음 순서로 실행한다.

```powershell
npm.cmd --cache .\.sites-runtime\npm-cache run install:ci
npm.cmd run db:local
npm.cmd run dev:local
```

별도 터미널에서 검사한다.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run check:local
npm.cmd run check:record
```

`check:local`은 실행 중인 개발 서버를 검사한다. 화면 4곳, health, 가상 분석, 외부 기능 비활성 및 로컬 설정 파일 접근 차단을 HTTP로 확인한다. 화면의 픽셀·모바일 조작 검증을 대신하지 않는다.

`check:record`는 타입 검사→단위 테스트→빌드를 순서대로 실행하고 `docs/test-runs/<UTC 시각>/`에 각 출력 로그와 명령·종료 코드·실행 시간을 기록한다. 실패하면 그 단계에서 멈춘다. 제품의 ‘동작 기록’(현재 창 메모리)과 개발 검증 로그(파일)는 별개다.

`db:local`은 `wrangler.local.jsonc`의 가상 DB ID와 `--local`을 사용하고 `.wrangler/state`에만 저장한다. 로컬 개발 서버와 같은 DB ID·저장 위치를 사용한다. 공개 D1이나 배포 설정을 변경하지 않으며 마이그레이션 이력으로 재실행을 관리한다.

## 기본 동작과 키

`.dev.vars`는 키 없는 로컬 예시 설정이다. 실시간 Groq 분석·외부 뉴스 검색·유료 제공자는 비활성이다. 가상 예시를 선택해 분석 화면을 체험할 수 있다. Codex CLI의 BAZE 연결은 웹사이트 API 설정과 별개다.

`.dev.vars`, `.env*`, `.sites-runtime`, `.wrangler`, `node_modules`는 Git 추적에서 제외된다. 환경 설정 파일과 로컬 상태는 개발 서버의 파일 접근에서도 차단한다. 실제 키나 예전 키 파일을 이 작업에서 복사하지 않는다.

독립 평가·실제 API·실제 기사 수집·공개 배포 검증은 이 로컬 환경 준비와 별도로 수행한다.
