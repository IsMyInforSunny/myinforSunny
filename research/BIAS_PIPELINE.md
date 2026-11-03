# 매체 상대 좌표 SVM 파이프라인

`train_bias.py`는 네트워크 없이 로컬 JSONL 기사로 매체 식별 LinearSVC를 학습하고 JSON 추론 모델을 만든다. 실제 기사 데이터나 완성 모델은 포함하지 않는다. 현재 측정된 정치 편향 정확도가 있다는 뜻이 아니다.

## 입력과 실행

```powershell
py research/train_bias.py --input articles.local.jsonl --manifest orientation.local.json --output bias-model.local.json
```

필요 패키지는 기존 `research/requirements.txt`의 numpy와 scikit-learn이다. 기사 JSONL의 필수 필드:

- `id`, `publisherId`: 고유 기사 ID와 정규화한 매체 도메인. 예를 들어 MBC는 `imbc.com`이고 URL은 그 하위 도메인일 수 있다.
- `text`, `sourceGroupId`: 본문과 동일 원본·전재 그룹 ID. 원문은 로컬 입력에서만 사용하고 출력하지 않는다.
- `comparisonGroup`: 동일한 주제·명제·기간·기사 형식을 검토해 붙인 공통 비교 그룹. 한 번의 학습에는 한 그룹만 허용한다.
- `url`, `publishedAt`: 해당 매체의 HTTPS 공개 URL과 ISO 발행일.
- `provenance: "public_article"`, `usage: {trainingAllowed: true, modelDistributionAllowed: true, basisUrl: "이용 근거 URL", reviewedBy: "검토자", reviewedAt: "검토일"}`. 필드는 사용 조건 검토 기록이며 프로그램이 법적 허가를 확인하는 것은 아니다.

manifest는 `axisId`, `profiles: [{publisherId, orientation}]`를 받는다. 기존 15개 매체와 정확히 같은 축·구분을 담은 `research/bias-orientation.example.json`을 로컬 복사해 사용한다. 템플릿에는 사람 검토 승인이나 가상의 성능값이 없다. orientation은 기존 `lib/bias-profile-set.ts`와 같은 값을 사용한다. 제외 매체와 미등록 매체는 입력을 거부한다. 좌·우 참고 매체가 모두 필요하다.

최소 매체 2곳, 각 6개의 독립 기사 그룹이 필요하다. 원본 그룹을 나누어 각 매체의 학습 3개·평가 3개 이상을 확보하지 못하면 중단한다. 동일 본문이 서로 다른 원본 그룹에 들어가면 중단한다. 유사한 전재·재작성은 수집 검토자가 같은 그룹으로 묶어야 하며 정확한 본문 해시만으로 모든 누수를 찾을 수는 없다.

## 산출 방법과 한계

1. 학습 기사만으로 대소문자를 유지하는 문자 2–4gram TF-IDF(최대 20,000개)를 만든다. 공백은 한 칸으로 합치고 양끝 공백을 제거한다. 부분 문자열은 유니코드 코드 포인트 단위다. TF는 `1 + ln(count)`, IDF는 sklearn smooth IDF, 마지막에 L2 정규화한다.
2. 매체 ID를 정답으로 LinearSVC를 학습한다. 정치 방향은 학습 라벨에 들어가지 않는다.
3. 학습된 매체 분류기의 특징 계수 행렬에서 첫 SVD 성분을 좌표축으로 삼는다. 학습 매체 중심의 동일가중 평균을 0으로 옮기고, 학습 기사 최대 절댓값을 1로 정규화한다. 추론값은 [-1,1]로 자른다.
4. 좌·우 참고 그룹은 부호만 고정한다. 별도 평가 기사에서 좌측 매체 중심의 최댓값이 우측 중심의 최솟값보다 작은지 확인한다. 이 조건만으로 정치적 의미가 검증되는 것은 아니다. SVD가 매체 문체·주제 차이를 먼저 포착할 수 있으므로 사람의 축 검토가 필요하다.

manifest에 설정한 좌·우 기준 매체는 **모두** 평가 표본에 있어야 축 검증을 통과한다. 일부 기준 매체가 빠진 데이터로 연구용 학습은 가능하나 `heldoutAnchorSeparation`은 false이고 `research_only`로 남는다. 제공 템플릿은 좌 4곳·우 3곳의 기준을 포함하므로 해당 7곳 전체의 평가 자료가 필요하다. 자료가 없다는 이유로 기준 매체를 임의 삭제하지 않는다.

본문의 제호·기자명·구독 안내·반복 푸터를 자동으로 제거하지 않는다. 수집 단계에서 이를 제거하고 처리 버전을 기록해야 매체 이름만 외우는 분류기를 줄일 수 있다. 기간·주제·형식 차이 및 가까운 전재로 인한 누수도 사람 검토가 필요하다.

`publisherAccuracy`는 매체 ID 식별 성능이다. `coordinateMae`는 평가 기사의 좌표와 학습 매체 중심 간 평균 절대 거리다. 두 값 모두 사람의 정치 편향 정답에 대한 정확도나 신뢰구간이 아니다. 특히 coordinateMae로 보여 주는 불확실성은 거친 비교 지표이며 사람 평가 오차를 대신하지 않는다.

## 출력과 활성화

JSON의 `vectorizer`, `projection`으로 다음 추론을 실행한다:

`coordinate = clip((dot(normalizedTFIDF, coefficients) + offset) / scale, -1, 1)`

`classifierEvidence`는 `lib/bias-analysis.ts` 공통 계약이다. `references`는 학습에 쓰이지 않은 평가 기사들의 좌표다. `lineage`에는 URL·발행일·본문 해시·원본 그룹·학습/평가 구분·사용 조건만 있고 원문은 없다. 모델 어휘에 기사 문자열 일부가 남을 수 있으므로 원문 미포함이 익명성이나 배포 허가를 보장하지 않는다.

기본 상태는 `research_only`다. 첫 학습 후 출력된 `modelVersion`에 대해 manifest의 `humanAxisReview: {status: "approved", reviewedBy: "검토 책임자", reviewers: ["평가자1", "평가자2"], sampleCount: 40, evidence: "검토 기록 경로", reviewedModelVersion: "출력 버전", interReviewerAgreement: 0부터 1까지의 실제 평가자 일치도}`를 기록하고 같은 입력으로 재실행한다. 최소 두 평가자·40표본의 실제 검토 기록, 버전 일치, 평가 좌·우 중심 분리 조건을 통과해야 `validated`가 된다. 임의 값으로 승인하지 않는다. 사람 평가 표본·방법·평가자·일치도 정의·범위는 evidence 기록에 남긴다. 생산 활성화는 이 검토 외에도 별도의 데이터·모델 검토가 필요하다.

합성 인프라 확인은 `--synthetic`과 `provenance: "synthetic"`를 사용한다. 합성 결과는 승인 정보를 주어도 항상 `research_only`이며 실측 모델로 배포하지 않는다.

사이트 추론기는 `lib/bias-model.ts`이고 배포 입력은 `lib/data/bias-model.json`이다. 현재 입력은 `null`이며, 실측 모델 검토 전 게이지가 계산 대기인 상태를 유지한다. `validated` 실데이터 산출물을 입력 파일에 넣고 빌드해야 하며, 서버와 브라우저는 동일 산출물을 사용한다. 서버가 취득한 본문의 예측은 기존 서명 토큰에 포함된다. 학습 산출물에 든 정적 평가 기사를 현재 사용자의 조사 결과로 자동 삽입하지 않는다.

```powershell
py -m unittest discover -s research -p test_train_bias.py
```

이 검사는 합성 문장으로 그룹 분리, 데이터 거부 조건, 내보낸 계수의 추론 동등성, 방향 라벨이 학습에 들어가지 않는지, 기준 매체 누락과 잘못된 승인 메타데이터를 거부하는지 확인한다. 실측 모델 평가와 구분한다.
