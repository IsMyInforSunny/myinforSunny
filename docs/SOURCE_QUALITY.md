# 출처 품질 관찰 모듈 (`lib/source-quality.ts`)

수집 자료의 **관찰 정보**를 계산하는 서버/브라우저 공용 순수 TypeScript 모듈이다. 네트워크·LLM·저장소·로그를 사용하지 않으며, 결과에 본문과 원본 URL(추적 파라미터 포함)을 담지 않는다.

**신뢰 점수가 아니다.** 점수, 신뢰 확률, 독립 취재원 수, 원자료 여부, 사실의 참거짓, 매체 정치 성향을 만들지 않는다. 결과의 `independence`는 항상 `'not_determined'`, `interpretation`은 `'observations_only'`이다.

## 공개 API

```ts
type SourceInput = Pick<Reference,'id'|'text'> & Partial<Omit<Reference,'id'|'text'>>; // Reference 그대로 전달 가능

assessSources(references: readonly SourceInput[], options?: SourceQualityOptions): SourceQualityAssessment
selectDiverseSources<T extends SourceInput>(candidates: readonly T[], limit = 2, options?): { selected: T[]; skipped: {id; reason; duplicateOf?}[] }
normalizeSourceUrl(input: unknown): { status: UrlStatus; url?: string; host?: string }
parseTargetPeriod(targetTime?: string): { start: number; end: number } | null   // KST 기준 일 번호
normalizeForComparison(text: string): string
```

`SourceQualityOptions`: `targetTime`(Claim.targetTime), `now`(테스트 고정용), `shortBodyChars`(200), `minComparableChars`(200), `nearIdenticalThreshold`(0.9), `lateToleranceDays`(365).

`SourceQualityAssessment`: `items`(자료별 관찰), `duplicates`(쌍별 중복 후보), `contentClusters`(중복 후보로 연결된 묶음), `sameHostGroups`, `summary`(건수), `notes`(고정 안내문).

## 관찰 항목

| 항목 | 값 |
|---|---|
| url | `ok` / `missing` / `invalid` / `not_https` / `not_public` (+정규화 주소·호스트) |
| publishedAt, fetchedAt | `present` / `missing` / `invalid` / `future` |
| body | 글자 수, `empty`/`short`/`ok`, 잘림 `truncated`/`complete`/`unknown`(`truncated` 플래그 또는 `fullTextLength` > 본문) |
| sourceLinks | 본문 안 https 링크 수, 다른 호스트 링크 수, `present`/`none_found` |
| temporal | `within_period` / `later_than_period` / `mismatch_candidate` / `unknown` + 사유 |

## 규칙

- **URL 정규화**: HTTPS·공개 호스트만. 추적 파라미터(`utm_*`, `fbclid`, `gclid` 등)와 fragment, `www.`, 끝 슬래시를 제거하고 나머지 쿼리는 정렬해 유지한다(`?id=1`과 `?id=2`는 다른 기사). 자격증명·포트·IP·`localhost`·단일 라벨 호스트는 `not_public`.
- **중복 후보 종류**: `same_url`, `identical_text`(정규화 본문 동일), `contained_text`(한쪽이 다른 쪽에 통째로 포함: 발췌), `near_identical_text`(6글자 조각 자카드 ≥ 0.9). 본문 비교는 양쪽 정규화 본문이 200자 이상일 때만 한다. 짧은 공통 문구나, 문맥이 다른 긴 글에 같은 문장이 들어 있는 경우는 후보가 아니다.
- **같은 도메인**은 중복이 아니다. `sameHostGroups`로 묶어 보일 뿐 독립 여부를 판정하지 않는다. **다른 도메인**의 동일 본문은 `sameHost:false`인 중복 후보로, 같은 보도자료·전재일 수 있음을 뜻한다. 중복 후보가 아닌 다른 도메인이라도 독립이라고 말하지 않는다. 호스트 비교는 `www.` 제거 후 정확 일치이며 하위 도메인·계열사는 같은 매체로 묶지 않는다.
- **시점**: `targetTime`이 `2024`, `2024년 10월`, `2024-10-03`, `2020~2022년` 형식일 때만 해석한다(그 밖은 `unknown`). 발행일이 대상 기간 이전이면 `mismatch_candidate`, 기간 이후 `lateToleranceDays` 초과여도 후보, 그 이내는 `later_than_period`(불일치 아님). 날짜 불명·미래·잘못된 발행일은 `unknown`이다. 날짜는 KST 달력 기준. 발행일이 일치해도 내용이 그 시점을 다룬다는 보장은 없다.
- `selectDiverseSources`: 입력 순서(검색 순위)를 유지하며 중복 후보가 아닌 자료를 `limit`개까지 고른다. 호스트가 다른 자료를 먼저, 부족하면 같은 호스트의 다른 기사. 빈 본문은 제외. 선택 결과는 독립성의 보증이 아니다.

## 제한

- 링크 없음은 원자료 부재·부재 확인이 아니다(본문이 잘렸거나 추출에서 링크가 빠졌을 수 있다).
- 한국어·영어 외 언어, 번역·요약·재작성된 전재는 감지하지 못한다. 거짓 음성이 있다.
- 비교는 O(n²)이며 소수(수 건)의 자료를 전제로 한다.
- 이 모듈의 결과를 UI에 쓸 때 점수·독립 출처 수·"신뢰" 표현으로 바꾸지 않는다. 인용·시점 대조 게이트(`lib/server/verify.ts`)를 대체하지 않는다.

시험: `tests/source-quality.test.ts` (모의 자료만 사용, 외부 호출 없음).
