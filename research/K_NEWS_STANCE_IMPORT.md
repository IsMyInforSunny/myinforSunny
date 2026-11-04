# K-News-Stance 로컬 기사 자료 가져오기

`import_k_news_stance.py`는 공식 자료를 로컬에 받은 뒤 기존 편향 학습 준비 도구가 읽을 수 있는 기사 JSONL로 가져온다. 다운로드·신청·모델 학습·사용 조건 승인·사람 평가를 수행하지 않는다.

공식 저장소는 [K-News-Stance](https://github.com/ssu-humane/K-News-Stance)다. README가 설명하는 JSON 필드는 `id`, `issue`, `genre`, `news_outlet`, `link`, `publish_date`, `article`, `article_stance`다. 데이터 파일 자체는 저장소에 없으며, [공식 접근 안내](https://github.com/ssu-humane/K-News-Stance/blob/main/data/instructions.md)의 신청 후 이메일로 `k-news-stance.json`을 받는다. 공개 README는 CC BY-NC 4.0을 명시한다. 가져오기는 이 공개 라이선스 정보를 기록할 뿐, 개별 기사·모델 배포 권리를 승인하지 않는다.

## 가져오기

실제 받은 파일 경로를 입력한다. 출력은 이 체크아웃의 Git 제외 디렉터리 `.sites-runtime` 아래 새 하위 디렉터리만 허용하며 기존 파일을 덮어쓰지 않는다.

```powershell
py research/import_k_news_stance.py --input "C:/자료/k-news-stance.json" --output-dir .sites-runtime/k-news-stance-intake
```

JSON 최상위 배열 또는 `articles`/`data` 배열을 받는다. 최대 150 MiB·10,000행이며 기사 본문·매체 이름·공개 HTTPS 원문 URL·유효한 발행일·논제·기사 형식을 검사한다. 사용자 후보 매체의 전체 이름 별칭과 URL 매체가 일치해야 한다. 조선비즈·IT조선을 조선일보로 취급하지 않으며 포털 URL을 발행 매체 원문으로 바꾸지 않는다. HTTP를 HTTPS로 자동 승격하지 않는다.

출력은 다음 세 파일이다.

- `articles.local.jsonl`: 기사 원문을 포함한 로컬 intake. `prepare_bias_corpus.py`가 쓰는 `id`, `publisherId`, `url`, `publishedAt`, `text`, `provenance`, `extractionVersion` 필드를 제공한다. 원문은 전처리·삭제·재작성하지 않는다.
- `intake-report.local.json`: 매체·논제·기사 형식별 건수, 발행일, 누락·거절 사유, 동일 본문 해시 그룹 수만 담은 메타데이터. 본문·제목·인용은 없다.
- `reviews.local.json`: 기존 준비 도구의 기사 ID에 맞춘 **미작성 검토 문서**. `sourceGroupId`, `topicReview`, `usage`, 비교 명제와 기간은 `null`이며 검토자가 작성해야 한다.

공식 `article_stance`는 intake의 `dataset.articleStance`에 그대로 보관한다. `supportive`, `neutral`, `oppositional`은 특정 논제에 대한 입장이며 정치적 좌·우 라벨이나 새 SVM 축의 승인 기록으로 바꾸지 않는다. 알 수 없는 라벨은 누락·오류로 집계하고 임의 라벨을 만들지 않는다.

## 한 비교 그룹 고르기

먼저 전체 intake 보고서의 `groups`에서 동일 논제·형식의 후보 수와 매체 분포를 확인한다. 한 그룹만 다시 가져오려면 보고서의 정확한 값을 지정한다.

```powershell
py research/import_k_news_stance.py --input "C:/자료/k-news-stance.json" --issue "자료의 정확한 issue 값" --genre "analysis" --output-dir .sites-runtime/k-news-stance-one-group
```

`issue`와 `genre`가 같다는 사실만으로 비교 기간·명제 적합성이 검토됐다고 표시하지 않는다. 해당 그룹도 사람이 비교 범위와 발행일 창을 확인해야 한다. 내용 해시가 같으면 `sourceGroupIdCandidate`가 같지만, 해시가 다른 두 기사가 독립 원본이라는 뜻은 아니다. 전재·재작성·공통 보도자료 여부는 별도로 검토한다.

## 실제 학습까지 남은 자료

1. 공식 JSON 파일이 있어야 가져오기가 가능하다. 현재 코드만으로 기사나 모델이 생성되지는 않는다.
2. 가져온 파일의 `importedAt`은 파일 처리 시각이다. 발행 사이트에서 본문을 취득한 시각이 아니므로 `fetchedAt`을 자동으로 채우지 않는다. 기존 준비 도구에 넣기 전에 실제 출처 취득·자료 수령 계보를 검토하고 필요한 취득 기록을 확보해야 한다.
3. 실제 원본 그룹·주제와 기간·기사별 사용 조건을 검토한다. 검토 문서의 `usage`에는 기존 도구가 요구하는 저장·학습·평가·모델 배포 허용, 근거 URL, 검토자와 검토일이 필요하다. 이 도구는 이를 승인하지 않는다.
4. 같은 비교 그룹의 기사 JSONL과 실제 검토 문서를 `prepare_bias_corpus.py`에 넣고, 준비를 통과한 `.local.jsonl`만 `train_bias.py`에 전달한다. 전체 47개 논제를 한 비교 그룹으로 바꾸지 않는다.
5. 매체별 최소 학습·평가 표본, 원본 그룹 분리, 새 모델 버전에 대한 별도 실제 축 검토가 필요하다. 공개 논문의 평가자 수·일치도나 기존 stance 라벨을 `humanAxisReview`에 복사해 새 모델을 승인하지 않는다.

예시는 실행 순서를 보여 주며 검토 완료·실제 학습 성공을 의미하지 않는다.

```powershell
py research/prepare_bias_corpus.py --input .sites-runtime/k-news-stance-one-group/articles.local.jsonl --reviews .sites-runtime/k-news-stance-one-group/reviews.local.json --manifest research/bias-orientation.example.json --report .sites-runtime/k-news-stance-ready.local.json --export .sites-runtime/k-news-stance-training.local.jsonl
py research/train_bias.py --input .sites-runtime/k-news-stance-training.local.jsonl --manifest research/bias-orientation.example.json --output .sites-runtime/k-news-stance-model.local.json
```

아직 없는 자료를 받은 것처럼 표시하지 않는다. 모든 출력의 초기 상태는 `pending_review`, 학습 승인 기사 수는 0이며 `modelCreated`와 `releaseReady`는 `false`다. 본문과 수신한 원본 JSON은 Git에 추가하지 않는다.
