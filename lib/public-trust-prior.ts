import type {PublisherWeightSet} from './source-reliability';

/**
 * A public-perception prior, not an independently measured accuracy or reliability rating.
 * Percentages are converted to [0,1] weights and can only be compared within this survey scope.
 */
export const SOUTH_KOREA_PUBLIC_TRUST_PRIOR_2025: PublisherWeightSet = {
  version: 'reuters-dnr-2025-kr-brand-trust-v1',
  methodology: 'Reuters Institute Digital News Report 2025 South Korea brand trust responses, converted from reported percentages to 0–1 prior weights. Online YouGov sample (South Korea n=2,038), quota-based and census/industry weighted, non-probability sample; this measures reported audience trust, not factual accuracy. It is a partial set: sources without a comparable entry remain unweighted and the claim result is withheld.',
  weights: [
    {publisher: 'imnews.imbc.com', value: 0.60, evidence: 'MBC audience trust 61% (reported 2025-06-17). Set equal to JTBC baseline because the 2-point gap is within the report methodology caveat for differences unlikely to be statistically significant. Reuters Institute Digital News Report 2025, South Korea: https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2025/south-korea . Methodology: https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2025/methodology'},
    {publisher: 'news.jtbc.co.kr', value: 0.60, evidence: 'JTBC audience trust 59% (reported 2025-06-17). Set equal to MBC baseline because the 2-point gap is within the report methodology caveat for differences unlikely to be statistically significant. Reuters Institute Digital News Report 2025, South Korea: https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2025/south-korea . Methodology: https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2025/methodology'},
    {publisher: 'ytn.co.kr', value: 0.55, evidence: 'YTN audience trust 55% (reported 2025-06-17). Reuters Institute Digital News Report 2025, South Korea: https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2025/south-korea . Methodology and sample caveats: https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2025/methodology'},
  ],
};
