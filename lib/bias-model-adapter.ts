import type {Analysis,Reference} from './contracts';
import type {ResearchVerification} from './research-contract';
import type {BiasArticleCoordinate,BiasOrientationSet} from './bias-analysis';
import {currentResearch} from './current-research';
import {inferBiasCoordinate,sameBiasModel,type PortableBiasModel} from './bias-model';
import {normalizeSourceUrl} from './source-quality';

function publisher(host:string,set:BiasOrientationSet):string|null{
  // Suffix matching is bounded by a dot; hani.co.kr.attacker.test never matches.
  return set.profiles.find(p=>p.orientation!=='excluded'&&(host===p.publisherId||host.endsWith(`.${p.publisherId}`)))?.publisherId??null;
}
function quoteMatches(ref:Reference,quote:{quote:string;start:number;end:number}){
  return Number.isInteger(quote.start)&&Number.isInteger(quote.end)&&quote.start>=0&&quote.end>quote.start
    &&quote.end<=ref.text.length&&!!quote.quote.trim()&&ref.text.slice(quote.start,quote.end)===quote.quote;
}

/** Infer only the target locally; reference predictions originate in the signed fetch flow. */
export function biasCoordinatesFromResearch(analysis:Analysis,results:readonly ResearchVerification[],model:PortableBiasModel|null,set:BiasOrientationSet):BiasArticleCoordinate[]{
  if(!model||analysis.mode!=='live'||model.classifierEvidence.axisId!==set.axisId)return [];
  const group=model.comparisonGroup;
  if(analysis.proposition?analysis.proposition!==group:!analysis.claims.some(c=>c.text===group))return [];
  const body=analysis.sources.find(s=>s.kind==='body');if(!body)return [];
  const prediction=inferBiasCoordinate(model,body.text);if(!prediction)return [];
  const rows=new Map<string,BiasArticleCoordinate>();
  const current=currentResearch(analysis,results).map((result,index)=>({result,index})).sort((a,b)=>
    (Date.parse(a.result.createdAt)||0)-(Date.parse(b.result.createdAt)||0)||a.index-b.index).map(x=>x.result);
  const latestChecks=new Map<string,ResearchVerification['checks'][number]>();
  for(const result of current)for(const check of result.checks)latestChecks.set(check.claimId,check);
  const latestPerspective=current.filter(r=>r.perspectiveChecks?.some(p=>p.positionText===group)).at(-1);
  for(const result of current)for(const ref of result.references){
    if(ref.provenance!=='web_fetched'||!ref.publishedAt||!Number.isFinite(Date.parse(ref.publishedAt))||!ref.fetchedAt)continue;
    const url=normalizeSourceUrl(ref.url);if(url.status!=='ok'||!url.host||!url.url)continue;
    const id=publisher(url.host,set),coordinate=ref.biasPrediction;
    if(!id||!coordinate||coordinate.comparisonGroup!==group||!sameBiasModel(coordinate.classifier,model))continue;
    // Separate claim searches can all compare the same explicit proposition.
    // Retain each claim's current attempt, rather than throwing away every
    // bundle except the last (which would cap the entire baseline at two URLs).
    const currentPerspective=result.checks.length?result.checks.some(c=>latestChecks.get(c.claimId)===c
      &&analysis.claims.some(a=>a.id===c.claimId)&&c.execution==='completed'):result===latestPerspective;
    const perspective=currentPerspective&&result.perspectiveChecks?.some(p=>p.referenceId===ref.id&&p.positionText===group
      &&!['undetermined','not_expressed'].includes(p.stance)&&quoteMatches(ref,p));
    const factual=result.checks.some(c=>latestChecks.get(c.claimId)===c&&analysis.claims.some(a=>a.id===c.claimId&&a.text===group)&&c.execution==='completed'
      &&c.temporalFit==='matched'&&c.relations.some(r=>r.referenceId===ref.id&&quoteMatches(ref,r)));
    if(!perspective&&!factual)continue;
    // A full-text digest is only trusted when extraction was complete.
    const origin=ref.contentDigest&&ref.retrievedTruncated===false&&ref.retrievedTextLength===ref.fullTextLength
      ?`digest:${ref.contentDigest}`:`url:${url.url}`;
    // Use evaluation metadata from the current validated local release, never
    // repeat or trust browser-carried dataset arrays in every article token.
    rows.set(url.url,{articleId:url.url,publisherId:id,comparisonGroup:group,sourceGroupId:origin,
      classifier:{...model.classifierEvidence,coordinate:coordinate.classifier.coordinate}});
  }
  return [{articleId:analysis.analysisId,publisherId:'input',comparisonGroup:group,classifier:prediction},...rows.values()];
}
