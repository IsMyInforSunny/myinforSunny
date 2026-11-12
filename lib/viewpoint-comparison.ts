import type {Analysis} from './contracts';
import type {ResearchVerification} from './research-contract';
import {researchProposition,verifiedRecommendations} from './reliability';

/** A descriptive comparison of grounded article viewpoints, never an SVM score.
 * The recommendation adapter enforces current analysis, exact quotes, canonical
 * URL deduplication, matching proposition and exclusion of the input article. */
export function compareArticleViewpoints(analysis:Analysis,results:ResearchVerification[]){
  const proposition=researchProposition({bodyPosition:analysis.bodyPosition,sources:analysis.sources});
  const selected=researchProposition(analysis);
  const normal=(value:string)=>value.normalize('NFC').trim().replace(/\s+/g,' ');
  const compatible=!!proposition&&!!selected&&normal(proposition)===normal(selected);
  const articles=compatible?verifiedRecommendations(results,analysis).filter(card=>
    card.kind==='supporting_view'||card.kind==='opposing_view'):[];
  const support=articles.filter(card=>card.kind==='supporting_view').length;
  const oppose=articles.filter(card=>card.kind==='opposing_view').length;
  const publishers=new Set(articles.map(card=>card.publisherDomain));
  return {version:'grounded-viewpoint-counts-1.0',
    status:!compatible?'no_grounded_proposition' as const:articles.length<3||publishers.size<2?'insufficient' as const:'ready' as const,
    proposition:compatible?proposition:null,support,oppose,total:articles.length,publisherCount:publishers.size,
    articles,scopeNote:'현재 분석에 연결된 추천 기사 최대 6건의 본문 인용을 비교합니다. 검색 제목·미검증 후보는 제외하며, 찬반 건수는 편향 강도·여론 비율·SVM 점수가 아닙니다.'};
}
