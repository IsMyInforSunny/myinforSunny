import type {Analysis} from './contracts';
import type {ResearchVerification} from './research-contract';
import {reviewCitedSources,type CitedSource} from './cited-sources';
import {MEDIA_NAME_MAP,assessCitedSources,type SourceConfirmation} from './cited-source-assessment';
import type {PublisherWeightSet} from './source-reliability';
import {canonicalPublisherHost} from './source-reliability';
import {currentResearch} from './current-research';
import {normalizeSourceUrl} from './source-quality';

const MIN_LITERAL_CHARS=12;
const hostKey=canonicalPublisherHost;
const mediaName=(name:string)=>name.replace(/\s+/g,'').replace(/(?:의)?(?:보도|뉴스)$/,'');

function namedHost(source:CitedSource){
  if(!source.signals.named||!source.name)return null;
  const name=mediaName(source.name);
  return MEDIA_NAME_MAP.entries.find(entry=>(entry.names as readonly string[]).some(alias=>mediaName(alias)===name))?.host??null;
}
function sentenceText(analysis:Analysis,source:CitedSource){
  const input=analysis.sources.find(s=>s.id===source.sourceId);
  const sentence=input?.sentences.find(s=>s.id===source.sentenceId);
  return input&&sentence?input.text.slice(sentence.start,sentence.end):'';
}
function literals(text:string,source:CitedSource){
  const values=[...text.matchAll(/[“"「『]([^”"」』]+)[”"」』]/gu)].map(match=>match[1].trim());
  if(/에\s?(?:따르면|의하면)/u.test(source.quote)){
    const at=text.indexOf(source.quote);
    if(at>=0)values.push(text.slice(at+source.quote.length).replace(/^[\s,:]+|[\s.。]+$/gu,''));
  }
  return values.filter(value=>Array.from(value).length>=MIN_LITERAL_CHARS);
}

/**
 * Original-source confirmation is stricter than related-news corroboration:
 * the publisher identity (or explicit original URL) AND a literal passage must
 * match a current, time-matched, fetched reference's validated citation.
 */
export function citedSourceConfirmations(analysis:Analysis,results:readonly ResearchVerification[]):SourceConfirmation[]{
  if(analysis.mode!=='live')return [];
  const current=currentResearch(analysis,results).map((result,index)=>({result,index})).sort((a,b)=>
    (Date.parse(a.result.createdAt)||0)-(Date.parse(b.result.createdAt)||0)||a.index-b.index).map(x=>x.result);
  const latest=new Map<string,{result:ResearchVerification;check:ResearchVerification['checks'][number]}>();
  for(const result of current)for(const check of result.checks)latest.set(check.claimId,{result,check});
  const review=reviewCitedSources(analysis),output=new Map<string,SourceConfirmation>();
  for(const source of review.sources){
    if(!source.signals.named)continue;
    const text=sentenceText(analysis,source),fragments=literals(text,source);if(!fragments.length)continue;
    const expected=namedHost(source);
    const explicit=new Set([...text.matchAll(/https:\/\/[^\s<>“”"'‘’()[\]{}]+/gu)]
      .map(match=>normalizeSourceUrl(match[0].replace(/[.,!?;:。]+$/gu,'')).url).filter(Boolean));
    for(const claim of review.claims.filter(c=>c.sourceIds.includes(source.id))){
      const actual=analysis.claims.find(c=>c.id===claim.claimId);
      const claimFragments=fragments.filter(fragment=>actual?.origin.some(span=>span.sourceId===source.sourceId
        &&span.sentenceId===source.sentenceId&&span.quote.includes(fragment)));
      if(!claimFragments.length)continue;
      const entry=latest.get(claim.claimId);if(!entry||entry.check.execution!=='completed'||entry.check.temporalFit!=='matched')continue;
      for(const relation of entry.check.relations){
        const ref=entry.result.references.find(r=>r.id===relation.referenceId);
        if(!ref||ref.provenance!=='web_fetched'||!ref.fetchedAt||!Number.isFinite(Date.parse(ref.fetchedAt)))continue;
        const url=normalizeSourceUrl(ref.url);if(url.status!=='ok'||!url.url||!url.host)continue;
        // A named MBC attribution cannot be confirmed by another publisher's URL.
        if(expected?hostKey(url.host)!==expected:!explicit.has(url.url))continue;
        if(!Number.isInteger(relation.start)||!Number.isInteger(relation.end)||relation.start<0||relation.end<=relation.start
          ||relation.end>ref.text.length||ref.text.slice(relation.start,relation.end)!==relation.quote)continue;
        if(!claimFragments.some(fragment=>relation.quote.includes(fragment)))continue;
        output.set(source.id,{citedSourceId:source.id,url:url.url,provenance:'web_fetched',quoteMatched:true});
      }
    }
  }
  return [...output.values()];
}

/** One source may be cited by several claims; checking one never checks all of them. */
export function reviewedCitedSources(analysis:Analysis,results:readonly ResearchVerification[],weightSet:PublisherWeightSet|null){
  const overall=assessCitedSources(analysis,{weightSet,confirmations:citedSourceConfirmations(analysis,results)});
  const claims=overall.claims.map(claim=>{
    const factual=analysis.claims.find(c=>c.id===claim.claimId)!;
    const scoped={...analysis,claims:[factual]};
    return assessCitedSources(scoped,{weightSet,confirmations:citedSourceConfirmations(scoped,results)}).claims[0];
  });
  return {...overall,claims,summary:{...overall.summary,originalVerifiedClaims:claims.filter(c=>c.originalVerified).length}};
}
