# 매체 상대 좌표 SVM 파이프라인

`train_bias.py`는 네트워크 없이 로컬 JSONL 기사로 매체 식별 LinearSVC를 학습하고 JSON 추론 모델을 만든다. 실제 기사 데이터나 완성 모델은 포함하지 않는다. 현재 측정된 정치 편향 정확도가 있다는 뜻이 아니다.

2026-11-04 직접 수집한 로컬 120개 기사와 실제 매체 분류 실험은 [직접 수집 기록](../docs/DIRECT_COLLECTION_2026-11-04.md)에 정리했다. 원문과 연구 가중치는 Git 제외 폴더에 있으며, 공개 배포 모델이 아니다.

## 직접 수집과 자료 진단

`collect_bias_articles.mjs`는 Node의 네이티브 TypeScript 처리를 사용한다(Node 26에서 실행 확인). 검색에서 실제 확인한 기사 URL·publisherId·topicId가 든 JSON 배열을 입력한다. 새 출력 폴더는 `.sites-runtime` 아래여야 하며, 기존 파일은 덮어쓰지 않는다. robots·접근 제한과 취득 크기를 확인하고 같은 호스트 요청 간격을 2초 이상 둔다. 원문·날짜를 만들거나 이용 승인을 부여하지 않는다.

`audit_collected_articles.py`는 실제 원문을 합치고 날짜·주제 핵심어·동일/유사 본문·매체판 구분을 점검한다. 원문은 로컬에 유지하며 검토표의 승인 칸은 빈 값으로 만든다.

`diagnose_publisher_corpus.py`는 로컬 자료에 대한 매체 식별 실험이다. 다른 주제로 평가하고 매체명 제거 전후 성능을 비교한다. 공개 편향 모델 스키마나 승인 상태를 생성하지 않는다. 선택적으로 `--reference-left <매체...> --reference-right <매체...>`를 주면 미검토 기준 가설에 대한 좌표 차이도 계산한다.

## 좌표 투영 선택

학습 명령의 `--projection-method svd|anchor_contrast`는 기본값이 `svd`다. 기본 SVD 결과와 버전은 유지한다. `anchor_contrast`는 매체 식별 SVM을 학습한 뒤 오른쪽 기준 매체들의 평균 결정 계수에서 왼쪽 기준 매체들의 평균 결정 계수를 뺀 방향을 사용한다. 이 선택은 기준 매체의 숫자 점수를 고정하지 않지만 기준 집합의 해석에 의존한다. 두 클래스 LinearSVC의 단일 계수는 -w와 +w로 펼친다.

방법·기준 매체·가중치가 바뀌면 정확한 모델 버전에 대해 다시 축 검토해야 한다. 기사 이용 조건·학습/평가 분리·실제 사람 검토·생산 활성화 요구는 그대로 적용된다.

## 입력과 실행

```powershell
py research/train_bias.py --input articles.local.jsonl --manifest orientation.local.json --output bias-model.local.json
```

필요 패키지는 기존 `research/requirements.txt`의 numpy와 scikit-learn이다. 기사 JSONL의 필수 필드:

- `id`, `publisherId`: 고유 기사 ID와 정규화한 매체 도메인. 예를 들어 MBC는 `imbc.com`이고 URL은 그 하위 도메인일 수 있다.
- `text`, `sourceGroupId`: 본문과 동일 원본·전재 그룹 ID. 원문은 로컬 입력에서만 사용하고 출력하지 않는다.
- `comparisonGroup`: 동일한 주제·명제·기간·기사 형식을 검토해 붙인 공통 비교 그룹. 기본 모드는 한 그룹만 허용한다. 아래의 명시적 여러 주제 모드는 서로 다른 검토 그룹을 보존해 평가한다.
- `url`, `publishedAt`: 해당 매체의 HTTPS 공개 URL과 실제 발행일. 날짜만 있으면 한국 시간 날짜로, 시각이 있으면 `YYYY-MM-DDTHH:MM[:SS[.ffffff]]Z` 또는 `±HH:MM`을 명시한 확장 ISO 형식으로 기록한다.
- `provenance: "public_article"`, `usage: {trainingAllowed: true, modelDistributionAllowed: true, basisUrl: "이용 근거 URL", reviewedBy: "검토자", reviewedAt: "검토일"}`. 필드는 사용 조건 검토 기록이며 프로그램이 법적 허가를 확인하는 것은 아니다.

manifest는 `axisId`, `profiles: [{publisherId, orientation}]`를 받는다. 기존 15개 매체와 정확히 같은 축·구분을 담은 `research/bias-orientation.example.json`을 로컬 복사해 사용한다. 템플릿에는 사람 검토 승인이나 가상의 성능값이 없다. orientation은 기존 `lib/bias-profile-set.ts`와 같은 값을 사용한다. 제외 매체와 미등록 매체는 입력을 거부한다. 좌·우 참고 매체가 모두 필요하다.

최소 매체 2곳, 각 6개의 독립 기사 그룹이 필요하다. 원본 그룹을 나누어 각 매체의 학습 3개·평가 3개 이상을 확보하지 못하면 중단한다. 동일 본문이 서로 다른 원본 그룹에 들어가면 중단한다. 유사한 전재·재작성은 수집 검토자가 같은 그룹으로 묶어야 하며 정확한 본문 해시만으로 모든 누수를 찾을 수는 없다.

## 수집 목표와 부족분 계산

```powershell
py research/plan_bias_collection.py --manifest research/bias-orientation.example.json
py research/plan_bias_collection.py --manifest research/bias-orientation.example.json --preparation-report .sites-runtime/corpus-readiness.local.json --output .sites-runtime/collection-plan.local.json
```

`plan_bias_collection.py`는 네트워크 요청·기사 수집·학습·승인을 하지 않는 메타데이터 전용 도구다. 실제 준비 보고서를 주면 문제가 없는 검토 행의 원본 그룹만 세어 기준 매체별 부족분을 계산한다. 보고서가 없으면 현재 확보량은 `null`로 둔다. 본문·URL·검토자 이름을 계획 결과에 복사하지 않고 기존 출력 파일도 덮어쓰지 않는다.

실제로 준비된 자료에 선택 매체(`unspecified`)가 포함되면 그 매체도 참여 집합에 넣고 학습·평가 각3개에 필요한 최소6개와 부족분을 표시한다. `evaluationSplitOriginalLowerBound`는 사람 평가를 위한 전역 원본 그룹의 산술 하한이고, 매체별 기사 수를 합산한 하한이 아니다. 여러 매체가 같은 원본을 전재한 경우 전역 그룹은 한 번만 센다. 균등 수집안은 매체 사이에도 서로 다른 원본을 확보한다는 보수적인 가정이며, 이 가정은 결과의 `balancedPlanAssumesDistinctOriginalsAcrossPublishers`에 표시한다.

현재 분리기는 원본 그룹의 40%를 올림해 평가에 배정한다. 서로 다른 평가 원본 40개를 얻으려면 산술적으로 전체 독립 원본 그룹이 적어도 98개여야 한다(`ceil(98×0.4)=40`, 97개에서는 39개). 기본 기준 매체 7곳에 균등하게 배정한 수집 계획은 각 14개, 총 98개다. **98개는 평가 표본 수를 확보하기 위한 계획 하한이며 충분한 학습량·정확도·축 분리·배포 가능성을 보장하지 않는다.** 학습/평가 양쪽에서 매체별 3개 이상이 나오는 실제 그룹 분리가 실패하거나 사람이 판단 유보한 평가 표본이 생기면 더 필요하다. 두 평가자가 같은 원본 40개를 각각 검토하므로 최소 80개의 판정 기록이 필요하다.

기본 모델은 동일 비교 명제·기간·기사 형식으로 검토한 한 `comparisonGroup`만 받는다. 여러 주제의 기사 수를 합산해서 한 주제의 조건을 충족했다고 처리하지 않는다. 단순 기사 수나 대략적인 작업 일수로 완성을 약속하지 않으며 실제 취득·원본 중복·매체 분포·사람 검토·축 품질로 판단한다. 수집 계획 도구의 `releaseReady`는 항상 `false`이고 실제 분리·모델 평가는 별도 단계다.

## 여러 주제의 매체 문체 모델

임의 주제 입력을 한 개 명제 전용 모델에 연결하지 않도록 `train_bias.py --cross-topic`을 별도로 제공한다. 각 주제의 기사·기간·원본 그룹·사용 조건을 먼저 기존 준비 단계로 검토한 후, 실제 준비된 JSONL 경로를 반복해서 지정한다.

```powershell
py research/train_bias.py --cross-topic --input topic-one.local.jsonl --input topic-two.local.jsonl --input topic-three.local.jsonl --input topic-four.local.jsonl --input topic-five.local.jsonl --manifest orientation.local.json --output cross-topic-model.local.json
```

각 행의 실제 `comparisonGroup`을 보존하며 적어도 다섯 주제를 요구한다. 한 번의 학습·평가 분리는 학습에 최소 세 주제, 평가에 최소 두 주제를 배정한다. 같은 주제를 양쪽에 나누지 않는다. 원본 그룹이 여러 주제에 걸치면 해당 주제 전체를 연결해 같은 쪽에 배정하므로, 주제가 달라도 같은 원본이 학습과 평가에 섞이지 않는다. 각 매체는 학습·평가 각각 최소 두 주제와 세 고유 기사 표본을 갖춰야 한다. 기본 평가 비율 40%와 결정적 시드로 후보 분리를 찾고, 이 조건을 만족하지 못하면 학습을 중단한다. 단일 주제 수집 계획의 약 98개 하한만으로 이 주제·매체별 분포가 확보됐다고 볼 수 없다.

출력에는 `topicScope: {mode: "cross_topic", trainingTopics: [...], evaluationTopics: [...]}`를 기록하고 각 `lineage` 행에 실제 `comparisonGroup`을 남긴다. 주제 목록과 분리가 모델 버전 해시에 포함되므로 주제 구성이 달라지면 기존 축 승인 기록을 재사용할 수 없다. 모델 최상위 `comparisonGroup`은 범위를 설명하는 `여러 주제 매체 문체 모델`이며 특정 사용자의 비교 명제를 뜻하지 않는다. 기본 단일 주제 모드의 출력에는 `topicScope`를 추가하지 않는다.

교차 주제 매체 식별 성능은 새로운 주제에서 매체 문체를 구별한 측정치다. 정치 편향 정답 정확도나 모든 주제에 대한 일반화 보장이 아니다. 실제 여러 주제 기사 자료·원본 그룹 분리·모든 기준 매체의 평가·평가 좌표 방향 분리와 최소 두 사람의 40개 독립 평가 원본 축 검토를 모두 통과해야 `validated`가 될 수 있다. 데이터나 검토가 없으면 이 모드를 추가해도 모델은 생성되거나 승인되지 않는다.

## 실제 취득 기사와 사람 검토를 결합하는 준비 단계

`prepare_bias_corpus.py`는 수집 도구의 출력과 실제 검토 기록 사이의 누락을 확인하는 오프라인 준비 도구다. 네트워크 요청·기사 취득·정치 라벨 생성·사용권 승인·학습·모델 활성화를 하지 않는다. 원문 저장 자체의 이용 조건은 취득 전에 확인해야 하며, 이 도구의 통과가 그 확인을 대신하지 않는다.

입력 `fetched.local.jsonl`은 실제 수집기가 취득한 기사당 한 줄이며 `id`, `publisherId`, `url`, `publishedAt`, `fetchedAt`, `text`, `extractionVersion`, `provenance: "public_article"`를 담는다. `publisherId`는 위 학습 계약의 루트 매체 도메인이다. `publishedAt`과 `fetchedAt`은 실제 발행·취득 시점이고, 본문은 제호·광고·기자 반복 푸터의 처리 버전을 `extractionVersion`으로 남긴다. 이 필드는 처리 절차를 수행했다는 사실을 자동 증명하지 않는다. 후보 제목·URL만으로 본문이나 날짜를 만들지 않는다.

공식 파일로 받은 기사 자료는 `intakeMethod: "licensed_dataset_import"`, 실제 파일 처리 시각 `importedAt`, `dataset: {id, sourceUrl}`을 사용한다. 이 경우 `fetchedAt`은 요구하거나 생성하지 않으며 공개 HTTPS 데이터 출처와 처리 시각의 형식·시간 순서를 확인한다. 직접 취득과 파일 가져오기 모두 준비 출력의 `acquisition: {method, acquiredAt, sourceUrl, datasetId?}`에 경로를 기록한다. 파일 가져오기도 동일한 기사 사용 조건·원본 그룹·주제 검토가 필요하며, 데이터셋 이름이나 파일 처리 시각이 학습·배포 승인으로 바뀌지 않는다. `acquisition`은 로컬 학습 입력의 계보이며 현재 모델 JSON의 공개 lineage에는 URL·발행일·해시·그룹·사용 조건이 기록된다.

사람 검토 JSON의 최상위 항목은 `comparisonGroup`(실제 비교할 명제), `windowStart`, `windowEnd`(비교 기간의 ISO 시각), `articles`다. 날짜만 쓰면 한국 시간 자정으로 해석하고, 비교 기간의 끝 날짜는 한국 시간 하루 전체를 포함한다. 시각까지 쓰면 `Z` 또는 UTC 오프셋이 반드시 있어야 하며 시간대 없는 시각은 보류한다. 시간대가 포함된 경계를 쓸 때는 확장 ISO 형식만 허용한다. 하루 전체의 시각 경계를 쓰려면 한국 시간 `T00:00:00+09:00`부터 `T23:59:59.999999+09:00`까지 지정한다. 날짜만 입력하는 방식도 같은 한국 날짜 전체를 포함한다. 각 `articles` 항목은 다음과 같다.

| 필드 | 실제로 남겨야 하는 기록 |
| --- | --- |
| `articleId` | 취득 파일의 실제 `id`와 동일한 값 |
| `sourceGroupId` | 원본·전재·가까운 재작성 기사를 검토해 묶은 원본 그룹. 기사 ID에서 자동 생성하지 않음 |
| `topicReview` | `{comparisonGroup, reviewedBy, evidence}`. 같은 주제라는 제목 유사성만으로 채우지 않고 실제 동일 명제·형식·시점을 검토한 기록 |
| `usage` | `{textStorageAllowed, trainingAllowed, evaluationAllowed, modelDistributionAllowed, basisUrl, reviewedBy, reviewedAt}`. 네 가지 사용 범위를 실제로 검토한 boolean, 공개 HTTPS 근거와 실제 검토자·날짜 |

모르는 권한은 `false` 또는 미기입으로 남긴다. 위 항목은 양식 설명이며 사용권·검토자·승인 기록을 자동 생성하는 예제가 아니다. 정치 방향의 사람 정답은 학습 타깃에 넣지 않는다. 아래의 블라인드 평가 CSV에서 실제로 제출받으며, 매체 ID만 SVM 타깃으로 사용한다.

```powershell
py research/prepare_bias_corpus.py --input .sites-runtime/fetched.local.jsonl --reviews .sites-runtime/corpus-reviews.local.json --manifest research/bias-orientation.example.json --report .sites-runtime/corpus-readiness.local.json
```

보고서는 원문 없이 URL·발행일·매체·원본 그룹·본문 해시·미충족 조건을 담는다. 본문이 없는 검색 결과, 미검토 사용권·주제·원본 그룹, 비교 기간 밖 기사, 발행일보다 이른 취득 시점, 매체-URL 불일치(정확한 호스트 또는 명시한 별칭 불일치), 미래 발행·취득·검토 시각, 알려지지 않은 검토 ID를 차단한다. 매체 별칭은 준비기에서 정규 매체 ID로 바꾸어 anchor 누락 집계도 일치시킨다. HTTPS URL 형식은 검사하지만 DNS·원문 접근 성공 여부를 재검증하지 않는다. `www`·추적 쿼리·fragment·끝 슬래시 변형은 동일 URL로 세고, 나머지 식별용 쿼리는 보존한다. 기존 `train_bias.validate`의 동일 본문/원본 그룹 검사와 매체2곳·각6개 독립 기사 하한을 그대로 적용한다. 학습·평가 양쪽에 매체별3개를 나누는 실제 그룹 분리는 다음 학습 단계에서 수행하므로 보고서의 `groupSplitVerified`는 `null`이다.

모든 준비 조건이 맞을 때만 `--export .sites-runtime/articles.local.jsonl`을 같은 명령에 추가해 원문 포함 학습 입력을 명시적으로 내보낸다. `.local.jsonl` 출력은 Git에 넣지 않는다. 불완전하면 메타데이터 보고서만 남기고 원문 내보내기는 거절한다. 기존 보고서·원문·검토 파일을 덮어쓰지 않으므로 재실행 시 새 출력 이름을 사용한다. `*.local.json`, `*.local.jsonl`, `*.local.csv`는 Git에서 무시한다. 이 도구는 기존 사이트 모델 파일을 수정하지 않는다.

`train_input_ready`는 입력 준비 형식이 맞다는 뜻이며 모델 승인 상태가 아니다. 누락된 참고 축 매체와 독립 원본 수를 별도로 보고하고 `releaseReady`는 항상 `false`다. 제공 manifest의 좌4곳·우3곳을 자료가 없다는 이유로 지우지 않는다. 아래 학습·분리 평가와 실제 두 평가자의 최소40개 독립 평가 원본 검토가 여전히 필요하다. 권리 검토 boolean·검토자 문자열이 있다는 것만으로 실제 독립 검토의 진위가 인증되는 것도 아니다.

```powershell
py -m unittest discover -s research -p test_prepare_bias_corpus.py
```

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

검토 메타데이터의 `sampleCount`는 실제 평가 원본 그룹 수와 고유 본문 해시 수를 넘을 수 없다. 오프라인 학습기와 사이트 로더가 이 모순을 각각 거부한다. 이 개수 검사는 실제 독립 평가가 이루어졌다는 사실을 인증하지 않으며 실제 검토 기록과 승인 확인은 계속 필요하다.

사이트 추론기는 `lib/bias-model.ts`이고 배포 입력은 `lib/data/bias-model.json`이다. 현재 입력은 `null`이며, 실측 모델 검토 전 게이지가 계산 대기인 상태를 유지한다. `validated` 실데이터 산출물을 입력 파일에 넣고 빌드해야 하며, 서버와 브라우저는 동일 산출물을 사용한다. 서버가 취득한 본문의 예측은 기존 서명 토큰에 포함된다. 학습 산출물에 든 정적 평가 기사를 현재 사용자의 조사 결과로 자동 삽입하지 않는다.

```powershell
py -m unittest discover -s research -p test_train_bias.py
```

이 검사는 합성 문장으로 그룹 분리, 데이터 거부 조건, 내보낸 계수의 추론 동등성, 방향 라벨이 학습에 들어가지 않는지, 기준 매체 누락과 잘못된 승인 메타데이터를 거부하는지 확인한다. 실측 모델 평가와 구분한다.

## 실제 사람 평가를 준비하고 집계하기

`review_bias_axis.py`는 실제 평가자를 대신하지 않고, 평가 양식과 실제 일치도 계산을 제공한다. 데이터와 평가자 신원·답안을 만들거나 온라인으로 보내지 않는다. 검토용 파일과 답안은 로컬에 보관한다.

먼저 학습 산출물에서 두 평가자의 빈 CSV를 만든다. 출력 파일은 기존 파일을 덮어쓰지 않는다.

```powershell
py research/review_bias_axis.py prepare --artifact bias-model.local.json --reviewer-one reviewer-one.local.csv --reviewer-two reviewer-two.local.csv --sample-count 40
```

학습 기사와 분리된 평가 기사만 사용하며, 같은 원본 그룹이나 같은 본문 해시에서는 한 기사만 뽑는다. 모델 버전과 기사 ID로 정렬한 결정적 표본이므로 같은 자료로 반복 생성하면 같은 표본이 나온다. 원본 그룹·본문 해시가 학습/평가 양쪽에 있거나 실제 자료의 이용 조건 검토 기록이 누락되면 중단한다. 40개보다 적으면 확보된 양식만 만들고, 그 상태에서 승인은 불가능하다.

두 CSV의 열은 `modelVersion,reviewSetId,articleId,url,publicationDate,reviewerId,label`이다. 모델 점수·매체 ID·모델의 좌우 분류는 넣지 않는다. URL로 매체를 짐작할 수 있으므로 완전한 매체 은폐는 아니다. 평가자는 서로 답안을 보지 않고 별도 사본에 각자의 실제 `reviewerId`와 `label`을 적는다. 라벨은 `left`, `center`, `right`, `undetermined` 중 하나다. 판정할 수 없으면 `undetermined`, 아직 읽지 않았다면 빈 칸으로 남긴다. 모델 버전·원문 URL·날짜·기사 ID·reviewSetId는 수정하지 않는다.

평가 기준은 사전에 같은 주제·시점·명제에서의 기사 표현과 입장으로 합의한다. 매체 이름만 보고 라벨을 붙이지 않는다. `center`와 판단 불가인 `undetermined`를 구분하고, 자료 선정·라벨 정의·예외·원문 접근 실패를 별도 검토 기록에 남긴다. 평가자 ID를 다르게 적는 것만으로 실제 독립 검토가 증명되지는 않는다.

두 답안만으로 먼저 측정 보고서를 만들 수 있다.

```powershell
py research/review_bias_axis.py report --artifact bias-model.local.json --reviewer-one reviewer-one.local.csv --reviewer-two reviewer-two.local.csv --output axis-review.local.json
```

보고서는 두 사람이 모두 라벨을 붙인 공통 표본의 Cohen κ와, `undetermined`를 제외한 공통 판단 가능 표본의 κ를 각각 계산한다. 관측 일치율·라벨 분포·표본 수·전체 적격 평가 자료 대비 커버리지도 표시한다. 두 평가자가 한 종류 라벨만 사용해 κ가 정의되지 않으면 1로 바꾸지 않고 `null`과 사유를 기록한다. κ는 사람끼리의 일치도이며 모델의 정확도가 아니다. 두 사람 모두 판단 가능한 서로 다른 원본 최소 40개가 필요하다.

**높은 κ만으로 축을 승인하지 않는다.** 두 평가자는 블라인드 답안을 제출한 뒤 실제 축·좌표·실패 사례·주제 누수·제호 암기 여부를 따로 확인하고 축의 정치적 해석을 승인할지 결정해야 한다. 승인 결정을 기록한 로컬 JSON의 형식은 다음과 같다. 아래 값은 양식 설명용이며 실제 승인이나 평가자 신원이 아니다.

```json
{
  "reviewedModelVersion": "실제 검토한 모델 버전",
  "reviewedBy": "실제 검토 책임자 식별자",
  "evidence": "실제 축 검토 기록의 로컬 경로",
  "reviewers": [
    {"reviewerId": "첫 CSV와 같은 실제 ID", "axisApproved": false, "independentReview": false, "evidence": "첫 평가자의 실제 축 검토 기록"},
    {"reviewerId": "둘째 CSV와 같은 실제 ID", "axisApproved": false, "independentReview": false, "evidence": "둘째 평가자의 실제 축 검토 기록"}
  ]
}
```

독립 검토와 축 승인이 실제로 완료됐을 때만 각 평가자가 해당 boolean 값을 true로 기록한다. 그 결정을 집계하려면 `report`에 `--decision axis-decision.local.json`을 추가한다. 실제 자료, 정확히 일치하는 모델 버전, 최소 40개 공통 판단 가능 원본, 정의된 비음수 κ, 기존 평가 매체 축 분리 검사, 두 평가자의 명시적 독립 검토·축 승인과 근거 기록이 모두 있어야 보고서에 `humanAxisReview`를 생성한다. 합성 자료는 모든 답안과 승인을 채워도 계속 `research_only`다. 이 도구는 학습 모델·manifest·사이트 배포 파일을 자동 변경하지 않는다.

보고서의 정확한 계약은 다음과 같다.

- `schemaVersion: "bias-axis-human-review-1"`, `modelVersion`, `reviewSetId`, `dataKind`.
- `status: "research_only" | "human_review_ready"`, `blockingReasons: string[]`.
- `eligibleArticleCount`, `commonArticleCount`, `commonDeterminateArticleCount`, `commonEligibleCorpusCoverage`, 공통 기사 ID 목록 두 종류와 답안 파일 SHA256 두 개.
- `reviewers: [{reviewerId,submittedRows,labeledRows,labelCounts,eligibleCorpusCoverage}]`.
- `agreementAllCommon`, `agreementDeterminate`: 각각 `{sampleCount,observedAgreement,cohensKappa,undefinedReason}`. 빈 표본에서 두 수치는 null이다.
- `humanAxisReview: null | {status:"approved",reviewedBy,reviewers:string[],sampleCount,evidence,reviewedModelVersion,interReviewerAgreement}`. 승인 메타데이터의 `sampleCount`와 `interReviewerAgreement`는 공통 판단 가능 표본의 실제 수와 κ다.

`human_review_ready`는 사람 검토 메타데이터를 준비했다는 뜻이다. 실제 배포는 별도로 검토한다. 보고서의 `humanAxisReview`를 같은 모델의 로컬 manifest에 반영해 학습 명령을 같은 입력으로 다시 실행하고, 출력 모델 버전이 바뀌지 않았는지 확인한다. 표본·전처리·모델이 바뀌면 기존 승인을 재사용하지 않는다.

```powershell
py -m unittest discover -s research -p test_review_bias_axis.py
```
