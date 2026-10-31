> **이력 문서**: 아래는 v3 자체 엔진 연구 경로의 설명입니다. 현재 웹 서비스는 Groq LLM 기반이며 아래의 예시 전용·API 불필요 설명은 공개 서비스 현황이 아닙니다. 최신 기준은 저장소 README와 docs/TECHNICAL_SPEC.md를 확인하세요.

# 자체 분석 엔진 — v3 구현

외부 AI API 대신 사전학습 임베딩과 직접 학습한 SVM·보정·검증을 사용합니다. 전체 언어모델의 사전학습을 팀이 했다는 뜻은 아닙니다. 현재 1차 구현은 표현 이진 head이며 논점·입장·근거 모델과 실제 한국어 데이터 평가·웹 encoder 연결은 미완료입니다.

## 구현된 실행 경로

- `engine.py`: 그룹·중복·encoder·자료 계보 검사 → train-only scaler/SVM → calibration-only sigmoid → dev 보고서 → JSON head 내보내기.
- `evaluate-test`: 동결 artifact와 데이터 해시를 확인한 후 test 평가. test 결과로 다시 튜닝하지 않습니다.
- `../lib/model-head.ts`: 동일 JSON head의 브라우저 호환 순수 계산. 원문·벡터를 외부 API에 전송하지 않습니다.
- `test_engine.py`: 합성 자료에서 실제 학습·보정·누수 차단·유보 계산 확인. 실제 한국어 성능을 증명하지 않습니다.
- `evaluate.py`: 규칙·TF-IDF·임베딩 기준선 비교. 구형 입력 필드(reviewed_by, embedding_version)는 기존 비교 도구용이며 engine.py의 새 계약과 구별합니다.
- `project.py`: 기존 PCA 탐색 도구. 시각화 축은 찬반 정답이 아닙니다.

```sh
python -m pip install -r research/requirements.txt
python research/engine.py train --data reviewed-embeddings.jsonl --output-dir local-run
python research/engine.py evaluate-test --data reviewed-embeddings.jsonl --frozen-artifact local-run/head.json --output local-test-report.json
python -m pytest research/test_engine.py -q
```

입력은 `id/group/text/label/split/provenance/license/annotationStatus/reviewers/embedding/embeddingVersion`입니다. train/calibration/dev에는 각 clear·flagged가 모두 필요합니다. 공개 자료의 원래 라벨 기록은 확인 후 이 계약으로 가져오며 검토자 정보를 발명하지 않습니다. 자세한 라벨 기준·후보 자료는 annotation-guide.md를 참고하세요.

합성 시험은 명시적 `--synthetic`으로만 수행하고 provenance=synthetic인 행만 허용합니다. artifact는 synthetic-test-only로 표시됩니다. 사람이 검토한 실험 자료도 experimental-not-approved로 내보내며 테스트 개수만으로 승인 모델이 되지 않습니다. 별도 운영 승격은 아직 구현하지 않았습니다.

현재 독립 한국어 학습·시험·운영 모델이 없으므로 공개 사이트는 예시 상태를 유지합니다. API 키를 만들거나 Cloudflare에 가입할 필요가 없습니다.
