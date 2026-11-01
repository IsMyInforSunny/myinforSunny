import type {Analysis,Reference} from './contracts';
import type {ResearchVerification} from './research-contract';
import {assessSources,normalizeSourceUrl} from './source-quality';

export type ObservedSources={
 fetched:Reference[];provided:Reference[];demo:Reference[];
 excluded:{stale:number;unbound:number;modeMismatch:number};
 /** A publication-date warning only, never a factual contradiction. */
 temporalWarnings:{referenceId:string;targetTime:string}[];
};
/** Observations need an explicit analysis binding. Callers may scope their own current child results before passing them. */
export function collectObservedSources(analysis:Analysis,results:readonly ResearchVerification[]):ObservedSources{
 const collected:ObservedSources={fetched:[],provided:[],demo:[],excluded:{stale:0,unbound:0,modeMismatch:0},temporalWarnings:[]};
 const seen=new Set<string>();let next=0;
 for(const result of results){
  if(!result.parentAnalysisId){collected.excluded.unbound++;continue;}
  if(result.parentAnalysisId!==analysis.analysisId){collected.excluded.stale++;continue;}
  if(result.mode!==analysis.mode){collected.excluded.modeMismatch++;continue;}
  for(const ref of result.references){
   const canonical=normalizeSourceUrl(ref.url);
   const category=result.mode==='demo'?'demo':ref.provenance==='web_fetched'?'fetched':'provided';
   // The same reference can occur in several checks. Exact repeated observations count once;
   // different text/metadata at the same URL remains visible to the duplicate detector.
   const key=JSON.stringify([category,canonical.url??ref.url??ref.id,ref.text,ref.publishedAt??null,ref.fetchedAt??null,ref.truncated,ref.fullTextLength??null]);
   if(seen.has(key))continue;seen.add(key);
   const copy={...ref,id:`observed_${next++}`};collected[category].push(copy);
   if(category!=='fetched')continue;
   const times=[...new Set(result.checks.filter(c=>c.relations.some(r=>r.referenceId===ref.id)).flatMap(c=>{
    const claim=analysis.claims.find(a=>a.id===c.claimId);return claim?.targetTime?[claim.targetTime]:[];
   }))];
   for(const targetTime of times){
    const observation=assessSources([copy],{targetTime}).items[0];
    if(observation.temporal.status==='mismatch_candidate')collected.temporalWarnings.push({referenceId:copy.id,targetTime});
   }
  }
 }
 return collected;
}
