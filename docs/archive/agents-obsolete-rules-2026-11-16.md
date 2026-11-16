# 교체한 오래된 AGENTS 규칙 · 2026-11-16

현재 규칙은 각 AGENTS.md와 docs/CURRENT_PLAN.md를 따릅니다. 아래는 보존용 원문입니다.

### publish-2230/AGENTS.md:26

- 2026-11-15 사용자 결정: 범위 좌표 기사도 동일 쟁점·기간의 비교 집합에 포함하며 하한·상한의 매체 동일가중 중앙값으로 구간 기준선을 계산한다. 기사 폭 ≤0.5·방향 문장 ≥3·매체당 적격 기사 ≥3·매체 ≥2 조건을 유지하고 중간점 대입을 하지 않는다. 평가 정답은 두 AI 합의 기준이며 사람 정확도가 아니다. 작업 순서와 진행 기록은 docs/CODEX_COMMAND_2026-11-15.md 및 docs/BIAS_STATUS.md를 따른다.

### publish-2230/AGENTS.md:36

- 입력 기사 입장은 사용자가 지정하며, 차이는 `abs(입력 입장 - 적격 매체 평균 기준선)`으로 표시한다. 현재 범위는 0~2다.

### publish-2230/AGENTS.md:64

- 웹사이트의 현재 분석 제공자는 Groq `openai/gpt-oss-120b`다. 코딩 에이전트용 BAZE/factchat 설정과 구분한다.

### publish-2230/AGENTS.md:74

- 사용자 지시: 작업을 마칠 때마다 GitHub `IsMyInforSunny/myinforSunny`에 검증한 변경을 커밋·업로드하고 브랜치와 커밋을 보고한다. 원격의 별도 개발 변경이 있으면 전용 브랜치를 사용하여 기존 main을 보존한다. 키·로컬 환경·브라우저 상태는 업로드하지 않는다.

### root/AGENTS.md:16

- 새 대화에서 현재 작업을 이어받을 때 `docs/CODEX_HANDOFF.md`를 확인한다. 코딩 CLI: BAZE는 `fcc-codex`, ChatGPT는 `codex`로 실행하고 `/resume`으로 같은 대화를 이어 쓴다. 두 명령 모두 제공자 이름 `fcc`를 쓰도록 `~/.codex/config.toml`에 설정되어 있다(BAZE 크레딧 소진 시 사용자가 수동 전환).

### root/AGENTS.md:75

- 웹사이트의 현재 분석 제공자는 Groq `openai/gpt-oss-120b`다. 코딩 에이전트용 BAZE/factchat 설정과 구분한다.

### root/AGENTS.md:36

- 2026-11-15 사용자 결정: 범위 좌표 기사도 동일 쟁점·기간 비교에 포함하고 하한·상한의 매체 동일가중 중앙값으로 구간 기준선을 계산한다. 방향 문장 ≥3·기사 구간 폭 ≤0.5·매체당 적격 기사 ≥3·매체 ≥2를 유지하며 기사 중간점으로 대체하지 않는다. 두 AI 합의 라벨은 사람 정확도가 아니다. 작업 1~9는 현재 체크아웃의 docs/CODEX_COMMAND_2026-11-15.md를 따르고 진행은 docs/BIAS_STATUS.md 한 개에 기록한다.
