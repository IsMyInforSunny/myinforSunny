# 로컬 모델 연구와 편향 SVM 준비 도구

이 디렉터리는 오프라인 모델 학습·평가 도구를 담습니다. 기존 표현 이진 head 연구와 매체 식별 SVM 기반 편향 좌표 파이프라인을 구분합니다. 공개 웹사이트의 논점·표현·주장 추출은 현재 Groq를 사용하며, 이 연구 도구가 운영 분석 전체를 대체한 상태는 아닙니다. 직접 언어모델을 사전학습한 것도 아닙니다.

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

위 오프라인 표현 모델을 실행·검사할 때는 외부 API 키나 Cloudflare 계정이 필요하지 않습니다. 실제 한국어 표현 학습·평가와 웹 encoder 연결은 여전히 미완료입니다. 공개 사이트의 Groq 활성 상태는 별도 운영 설정이며 [현재 기능 상태](../docs/FEATURE_STATUS_2026-11-03.md)를 따릅니다.

편향 분석은 `train_bias.py`의 매체 식별 SVM과 상대 좌표 산출을 사용합니다. 실제 검토 기사와 사람의 축 검토가 없어 운영 모델 입력은 아직 `null`입니다. 2026-11-03 조사에서 KoPolitic과 Implicit Media Bias 공개 후보의 매체 이름 또는 기사 이용 라이선스가 불충분해 학습 대상으로 채택하지 않았습니다. 후보 상태는 [편향 데이터 준비 상태](bias-data-readiness.md), 수집 목표·부족분 계산과 사람 평가 단계는 [편향 파이프라인](BIAS_PIPELINE.md)을 따릅니다.
