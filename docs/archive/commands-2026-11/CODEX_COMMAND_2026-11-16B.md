# Codex 작업 지시 · 편향 기능 완성 회차 3 · 2026-11-16

근거: 커밋 `e13331a`, `docs/BIAS_STATUS.md` 회차 2 기록, `docs/test-runs/bias-diagnosis-2026-11-16.json`. 진행 기록은 `docs/BIAS_STATUS.md`에만 쓴다. 공개 배포 없음. 기준·게이트는 낮추지 않는다.

## 지난 회차에서 잘못 짚은 것 (먼저 바로잡기)

1. **`ready:false`의 원인을 다른 모델에서 찾았다.** 회차 2는 `lib/data/voice-model-status.json`(글자 TF-IDF 후보, F1 0.526·찬성 재현율 0.083)을 "현재 운영 후보"로 보았다. 그러나 좌표·기준선·판별률은 **임베딩 SVM 후보**(`.sites-runtime/voice-expansion-20261115/six-topics-candidate.local.json`, 상태 파일은 `voice-embedding-status.json`)로 만든 것이다. 두 모델을 섞지 않는다. TF-IDF 후보는 이번 회차에서 다루지 않는다.
2. **화면에 "SVM 준비 중"이 나온 것은 실행 환경 문제일 가능성이 크다.** 11-16 1차 점검에서는 격리 연구 빌드(`scripts/vite/local-voice-research-plugin.mjs` 주입, 폴더 `.sites-runtime/local-demo-build-20261116`)에서 0–25점 범위가 나왔다. 회차 2의 화면 확인은 `127.0.0.1:5184`의 일반 빌드였다. 일반 빌드에는 공개 아티팩트가 `null`이라 항상 "준비 중"이다. **시연·점검은 반드시 연구 주입 빌드로 한다.**
3. **"재학습 실행 경로를 찾지 못했다"는 사실과 다르다.** 커밋 `5148b9d`에 경로가 있다.
   - `research/prepare_multitopic_voice_embeddings.py --corpus … --labels … --split-manifest … --output …`
   - `research/train_multitopic_voice_embeddings.py --cache-input … --candidate … --report …`
   - `research/evaluate_voice_embeddings.py --input … --vectors … --candidate … --report … --decision-policy voice-neutral-independent-1.0`
   - 정제 라벨: `.sites-runtime/voice-expansion-20261115/reviewed-five-topics-labels-v1.local.jsonl`, 독립 검토 두 벌 `review-a*.local.jsonl`·`review-b*.local.jsonl`
   - 고정 분할: `six-topics-frozen-split.local.json`, 벡터: `six-topics-complete-embedding-vectors.local.json` + 11-15 임베딩 체크포인트
4. **Groq 키:** 원 프로젝트 `디지털새싹_cmd/.dev.vars`에 `INFORCAST_GROQ_KEY_FILE` 항목이 있다(키 파일 경로 지정 방식). 그러나 이번 회차는 Groq에 의존하지 않는다(아래 작업 2). 키 파일을 열거나 출력하지 않는다.

## 진단에서 확인된 사실 (설계 근거)

- 판별률 기준값: 의대 55.8%(58/104), 원전 33.3%(12/36), 최저임금 52.9%(18/34). 주택은 적격 7건·적격 매체 1곳.
- 가장 큰 탈락 단계는 **구간 폭 ≤0.5**: 방향 문장 ≥3 기사 중 통과 비율이 의대 244→112, 원전 91→44, 최저임금 165→40, 주택 49→9. 원인은 방향 유보와 화자 유보 문장이다.
- **기존 라벨과 정제 라벨의 불일치율 76.5%**(화자 1,393·방향 889·쟁점 1,033 / 2,570문장). 현재 5개 주제 좌표는 불일치가 큰 원시 라벨로 학습한 모델에서 나왔으므로 **재학습 전에는 시연 수치로 쓰지 않는다.**

## 이번 회차 목표

- G1. 정제 라벨로 3개 쟁점(의대 정원·원전 확대·최저임금 인상)을 재학습하고, 고정 평가에서 게이트 통과 여부를 기록한다.
- G2. 재학습 후보로 좌표·기준선을 다시 만들고 판별률 전/후를 같은 형식으로 비교한다.
- G3. 연구 주입 빌드에서 3개 쟁점 실제 링크 각 2건이 끝까지 분석되어 점수 범위, 3분류, 후보 기사가 화면에 나온다.
- G4. 화면 확인을 Claude에 넘긴다.

## 작업 1 · 실행 환경 고정 (30분 이내)

- 연구 주입 빌드를 만드는 명령과 포트를 `package.json` 스크립트 하나로 고정한다(예: `start:research`). 일반 빌드와 포트를 다르게 한다.
- `/api/capabilities`의 `biasModel`에 `researchInjected:true`, 후보 버전, 지원 쟁점을 노출한다(연구 빌드에서만).
- 시작 직후 자기 점검: 지원 쟁점 목록이 비어 있으면 서버 로그에 한 줄 경고를 남긴다.
- 완료 기준: 연구 빌드에서 의대 정원 링크 1건이 점수 범위를 돌려준다(11-16 1차 결과 재현).

## 작업 2 · 정제 라벨로 재학습 (Groq 없이)

1. **합의 라벨 만들기:** `review-a`와 `review-b`(+`-additional`)는 서로 독립인 두 검토다. 같은 문장에서 두 검토가 일치한 필드만 채택한다. 쟁점·방향·화자별 일치율을 기록한다. 이것으로 "두 AI 합의" 조건을 충족하므로 Groq 호출은 하지 않는다. 두 검토가 같은 모델·같은 지시문이면 그 사실을 기록에 적는다.
2. **고정 평가 재채점:** `six-topics-frozen-split`의 평가 문장 중 합의 라벨이 있는 것만으로 현재 임베딩 후보를 다시 채점한다. 원시 라벨 기준 수치와 나란히 적는다. 평가 문장이 쟁점별 찬·반 각 10개 미만이면 "평가 표본 부족"으로 표시한다.
3. **재학습:** 합의 라벨의 학습 분할로 3개 쟁점의 방향(유무→찬반)·화자 헤드를 다시 학습한다. 설정은 기존과 같게(C=1, balanced, 마진 0.15, 중립 독립 정책). 평가 분할은 학습·선택에 쓰지 않는다.
4. **화자 판정 보강(규칙 우선):** 문장에 따옴표와 인용 조사·전달 동사(`lib/cited-sources.ts`의 `SAYING_VERB` 확장판)가 있으면 화자를 `source`로 확정하고, 그 외에만 SVM 화자 헤드를 쓴다. 정제 라벨 기준으로 규칙 단독·SVM 단독·규칙 우선의 화자 일치율을 비교해 가장 높은 것을 채택한다. 선택은 학습 분할에서만 한다.
5. **검사:** 뒤집기, 매체명 가리기, Python–TypeScript 일치(`PYTHON_EXECUTABLE` 지정)를 실행한다.
6. 결과는 `docs/test-runs/retrain-2026-11-16.json`: 라벨 일치율, 재채점 전/후, 재학습 후보의 방향 F1·찬반 재현율·화자 F1·유보율, 게이트 통과 여부.

게이트 미달이어도 멈추지 않는다. "연구 후보(게이트 미달 항목: …)"로 표기하고 작업 3으로 간다.

## 작업 3 · 좌표·기준선 재계산과 판별률 비교

- 재학습 후보로 3개 쟁점 보관 기사 좌표와 전체 기간 기준선을 다시 만든다(임베딩은 이미 있으므로 API 0회).
- 작업 1 진단을 같은 스키마로 다시 돌려 `bias-diagnosis-2026-11-16-after.json`에 저장한다.
- 비교표: 탈락 단계별 건수, 적격 기사 수, 기준선 구간, ±1 비율, 판별률. 전/후를 `BIAS_STATUS.md`에 표 하나로.
- 좌표 스냅샷과 임베딩 스냅샷이 다르다는 회차 2의 미해결 사항은 이번 재계산에서 하나의 스냅샷으로 통일해 해소한다.

## 작업 4 · 실제 링크 점검 (연구 주입 빌드)

- 의대·원전·최저임금 각 2건(보관 기사 1 + 최근 미보관 기사 1). 40문장 초과 기사 1건을 반드시 포함해 분할 호출을 확인한다.
- 기록 항목은 회차 2 지시와 같다: 분석 상태, 좌표 구간, 기준선 구간·건수·매체 수, 점수 범위, 방향, 3분류, 후보 수와 종류, `selfExcluded`, 전체 시간.
- 결과: `docs/test-runs/demo-bias-2026-11-16.json`(URL·본문 제외).
- 실패가 있으면 오류 코드와 단계만 적고 다음 링크로 넘어간다.

## 작업 5 · 마무리

- 연구 주입 빌드를 켜 둔 채 `.sites-runtime/CODEX_TO_CLAUDE.md`에 주소·포트·점검할 링크 목록을 적는다.
- `npm run typecheck`, `npm test`, `npm run build`, `git diff --check` 1회. 커밋 1개.
- `BIAS_STATUS.md` 맨 위에 G1~G4 표. 파일이 길어졌으므로 11-15 회차 기록은 `docs/archive/`로 옮기고 현재 상태만 남긴다.

## 하지 않을 것

- TF-IDF 후보(`voice-model-status.json`) 개선, Groq 호출, 주택 공급 대응, 분기·반기 조정, 새 임베딩.
- 게이트 완화, 중간점 대입, 미확정의 중립 치환, 공개 아티팩트 변경.
- 일반 빌드(연구 주입 없음)로 편향 점수를 점검하는 일.
