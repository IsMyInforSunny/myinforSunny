import type {ResearchInput} from '../research-contract';
import {capabilities,type RuntimeConfig} from './config';
import {AppError} from './errors';
import {searchProviderReady} from './search-settings';

/** One signed research request carries at most this many factual claims.
 * The browser runner splits a longer analysis into sequential batches; it never
 * marks claims outside a finished batch as reviewed. Must match researchInputSchema.
 */
export const RESEARCH_BATCH_CLAIMS=5;

export type ResearchWaitCode='LIVE_ANALYSIS_DISABLED'|'SEARCH_DISABLED'|'NEWS_TERMS_PENDING'|'SEARCH_BUDGET_STORE_MISSING'|'FIRECRAWL_NOT_READY'|'TAVILY_NOT_READY'|'FETCH_HOSTS_MISSING'|'DIRECT_FETCH_DISABLED';
export type ResearchWaitReason={code:ResearchWaitCode;message:string};

/** Names the operational conditions still blocking automatic research.
 * Messages describe settings by purpose only; no key, host list or secret value is echoed.
 */
export function researchWaitReasons(c:RuntimeConfig,purpose:'search'|'evidence'|'direct'='search'):ResearchWaitReason[]{
 const cap=capabilities(c);const reasons:ResearchWaitReason[]=[];
 if(!cap.live)reasons.push({code:'LIVE_ANALYSIS_DISABLED',message:cap.reason??'실시간 분석이 준비되지 않았습니다.'});
 const firecrawl=(c.NEWS_PROVIDER??'gdelt')==='firecrawl';
 if(purpose==='search'&&!cap.webSearch){
  if(firecrawl)reasons.push({code:'FIRECRAWL_NOT_READY',message:'Firecrawl 검색 연결(무료 조건·이용 승인)이 아직 준비되지 않았습니다.'});
  else{
   if(c.NEWS_PROVIDER==='tavily'&&!searchProviderReady(c))reasons.push({code:'TAVILY_NOT_READY',message:'이전 사이트의 한국어 검색 연결은 복구됐지만 무료 계정·한도 설정이 아직 준비되지 않았습니다.'});
   if(c.ENABLE_NEWS_SEARCH!=='true')reasons.push({code:'SEARCH_DISABLED',message:'기사 검색이 아직 운영에서 켜지지 않았습니다.'});
   if(c.NEWS_TERMS_APPROVED!=='true')reasons.push({code:'NEWS_TERMS_PENDING',message:'출처별 기사 이용 조건 확인·승인이 아직 기록되지 않았습니다.'});
   if(!c.DB)reasons.push({code:'SEARCH_BUDGET_STORE_MISSING',message:'검색 한도(일일 요청 상한) 기록 저장소가 연결되지 않았습니다.'});
  }
 }
 if(purpose==='direct'&&(c.ENABLE_DIRECT_FETCH!=='true'||c.NEWS_TERMS_APPROVED!=='true'||firecrawl))reasons.push({code:'DIRECT_FETCH_DISABLED',message:'직접 기사 주소 취득이 아직 운영에서 승인되지 않았습니다.'});
 if(!c.ALLOWED_RETRIEVAL_HOSTS?.trim())reasons.push({code:'FETCH_HOSTS_MISSING',message:'본문 취득을 허용한 공개 기사 출처 목록이 아직 설정되지 않았습니다.'});
 return reasons;
}

export function waitReasonText(reasons:ResearchWaitReason[]){return reasons.map(r=>r.message).join(' ');}

/** Server-side guard for one research batch. The schema already caps claims; this
 * gives a specific message and rejects duplicate IDs so per-claim coverage cannot double count.
 */
export function assertResearchBatch(input:ResearchInput){
 if(input.claims.length>RESEARCH_BATCH_CLAIMS)throw new AppError(422,'RESEARCH_BATCH_TOO_LARGE',`한 번의 조사 요청에는 사실 주장을 최대 ${RESEARCH_BATCH_CLAIMS}개까지 보낼 수 있습니다. 나머지는 다음 묶음으로 나누어 조사해 주세요.`);
 const ids=input.claims.map(c=>c.id);
 if(new Set(ids).size!==ids.length)throw new AppError(422,'VALIDATION_ERROR','같은 주장이 조사 묶음에 중복되어 있습니다.');
}
