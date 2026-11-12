# 기사 내용 SVM 학습과 공개

`train_stance.py`는 공통 명제에 대한 작성자 입장을 학습한다. 매체 이름·정치 성향을 정답으로 사용하지 않는다. 문장 2~4자 TF-IDF, LinearSVC, 원본·사건·날짜 그룹 분리를 사용하며 Python과 사이트 인코더의 수치 일치는 별도 검사한다. AI 교사 라벨 재현율은 사람 정확도가 아니다.

현재 160개 실제 기사 라벨 중 학습 가능 표본은 찬성 17, 반대 7, 비방향 57개다. 연구 가중치는 `.sites-runtime`에만 저장한다. 반대 표본 수·AI 라벨 재현 점검·찬반 재현율·이용 검토가 미달이므로 생산 모델은 null이다.

## 공개 전 검증

`release_stance.py`는 다음 조건을 모두 확인한 뒤에만 `lib/data/stance-model.json`과 상태 파일을 쓴다.

- 이미 학습·모델 배포 허용을 검토한 원자료와 라벨. 기존 수집 자료의 `pending_unapproved`를 자동 변경하지 않는다.
- `usage-review` 문서의 `corpusDigest`, `labelsDigest`가 `train_stance.digest`로 계산한 전체 입력과 일치한다.
- 검토자 `reviewedBy`, 시간대가 있는 과거 검토일 `reviewedAt`, 근거 HTTPS `basisUrl`, 실제 `trainingAllowed`, `modelDistributionAllowed`가 있다. 이 문서는 실제 권리 검토를 기록하며 권리를 부여하지 않는다.
- 후보 모델이 ready이고, 같은 코드·입력·사건 그룹으로 재학습한 가중치·평가·버전이 전부 일치한다. 숫자나 상태 플래그만 고쳐 통과할 수 없다.
- 학습 표본 자체의 이용 허용과 최소 표본·독립 평가·성능 기준도 다시 확인한다.

명령은 실제 확보한 파일 경로로 실행한다.

```powershell
py research/release_stance.py --corpus .sites-runtime/승인된자료.local.jsonl --labels .sites-runtime/라벨.local.jsonl --candidate .sites-runtime/통과한모델.local.json --usage-review .sites-runtime/실제이용검토.local.json --event-groups .sites-runtime/사건그룹.local.json
```

공개 모델에는 검토·입력의 해시만 보존하며 원문·인용·주소·검토자 개인정보는 넣지 않는다. 런타임은 공개 검토 표식이 없는 모델을 거부한다. `isStanceTrainingArticle`은 정규화한 원문 해시로 학습 원본을 식별한다. 이 기능만으로 유사 전재·관련 사건까지 제외되는 것은 아니다.

모델을 공개하는 절차의 구현과 실제 모델 완성은 다르다. 현재 데이터의 공개·학습 권리 및 통과 모델을 확보했다고 보고하지 않는다. 6개 정책 명제를 넘는 일반 논점 SVM과 같은 명제 비교 집합의 정량 점수·추천 연결은 추가 구현이 필요하다.
