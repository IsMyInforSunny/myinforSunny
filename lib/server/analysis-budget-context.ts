import {z} from 'zod/v4';
import {ANALYSIS_PROMPT_VERSION,type Analysis,type Claim,type InputSource} from '../contracts';
import {researchProposition} from '../reliability';
import {modelName,provider,type RuntimeConfig} from './config';
import {digest,readResearchToken,signResearchToken} from './research-token';
import {AppError} from './errors';

const contextSchema=z.object({
  groupId:z.string().min(1).max(128),
  sourcesDigest:z.string().min(1),
  claims:z.array(z.object({id:z.string(),digest:z.string()})).max(20),
  propositions:z.array(z.string().max(160)).max(2),
  model:z.string(),
  prompt:z.string(),
}).strict();
type BudgetInput={sources:InputSource[];claims:Claim[];position?:Claim;proposition?:string;analysisContextToken?:string};

// Schema parsing may change property order between the initial response and a
// later request. Fingerprints bind values without depending on that order.
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value)
    .filter(([,child])=>child!==undefined).sort(([left],[right])=>left.localeCompare(right))
    .map(([key,child])=>[key,canonical(child)]));
  return value;
}
const fingerprint=(value:unknown)=>digest(canonical(value));

/** The token is issued after cache delivery and never enters the public cache. */
export async function issueAnalysisBudgetContext(request:Request,config:RuntimeConfig,analysis:Analysis):Promise<string|undefined>{
  if(provider(config)!=='nvidia'||analysis.mode!=='live'||config.ENABLE_LIVE_ANALYSIS!=='true'
    ||analysis.versions.model!==modelName(config)||analysis.versions.prompt!==ANALYSIS_PROMPT_VERSION)return undefined;
  const propositions=[...new Set([analysis.proposition,researchProposition(analysis)].filter((value):value is string=>!!value))];
  const data:z.infer<typeof contextSchema>={
    groupId:analysis.requestId,
    sourcesDigest:await fingerprint(analysis.sources),
    claims:await Promise.all(analysis.claims.map(async claim=>({id:claim.id,digest:await fingerprint(claim)}))),
    propositions,
    model:modelName(config),
    prompt:ANALYSIS_PROMPT_VERSION,
  };
  return signResearchToken(request,config,'analysis_context',data);
}

/** Only the original sources and a subset of the server-extracted claims may
 * reuse the initial analysis request count. Concurrency leases remain separate. */
export async function readAnalysisBudgetContext(request:Request,config:RuntimeConfig,input:BudgetInput):Promise<string|undefined>{
  if(!input.analysisContextToken)return undefined;
  const parsed=contextSchema.safeParse(await readResearchToken(request,config,input.analysisContextToken,'analysis_context'));
  if(!parsed.success)throw new AppError(422,'INVALID_RESEARCH_EVIDENCE','분석 요청 정보를 확인하지 못했습니다. 다시 분석해 주세요.');
  const data=parsed.data;
  const claims=input.position?[...input.claims,input.position]:input.claims;
  const allowed=new Map(data.claims.map(claim=>[claim.id,claim.digest]));
  const valid=provider(config)==='nvidia'&&data.model===modelName(config)&&data.prompt===ANALYSIS_PROMPT_VERSION
    &&data.sourcesDigest===await fingerprint(input.sources)
    &&(!input.proposition||data.propositions.includes(input.proposition))
    &&(await Promise.all(claims.map(async claim=>allowed.get(claim.id)===await fingerprint(claim)))).every(Boolean);
  if(!valid)throw new AppError(422,'RESEARCH_INPUT_CHANGED','기사나 조사 대상이 바뀌었습니다. 다시 분석한 뒤 조사해 주세요.');
  return data.groupId;
}
