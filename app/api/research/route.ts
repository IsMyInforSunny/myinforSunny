import {withAudit} from '@/lib/server/with-audit';
import {z} from 'zod/v4';
import {researchInputSchema} from '@/lib/research-contract';
import {runtimeConfig} from '@/lib/server/config';
import {withBudget} from '@/lib/server/budget';
import {REQUEST_TIMEOUT_MS} from '@/lib/server/limits';
import {planResearch,discoverEvidence,importEvidence,compareEvidence,requireResearch,requireEvidence,validateResearch} from '@/lib/server/research';
import {AppError,errorResponse,json,readJson} from '@/lib/server/errors';
const token=z.string().min(1).max(64000);
const schema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('plan'),input:researchInputSchema}).strict(),
 z.object({operation:z.literal('discover'),input:researchInputSchema,planToken:token,queryIndex:z.number().int().min(0).max(5)}).strict(),
 z.object({operation:z.literal('compare'),input:researchInputSchema,evidenceToken:token}).strict(),
 z.object({operation:z.literal('import'),input:researchInputSchema,claimId:z.string().min(1).max(64),urls:z.array(z.string().url().max(2000)).min(1).max(2)}).strict(),
]);
async function handlePost(request:Request){const id=crypto.randomUUID();try{
 const parsed=schema.safeParse(await readJson(request));if(!parsed.success)throw new AppError(422,'VALIDATION_ERROR','조사 대상과 전송 동의를 확인해 주세요.');
 const config=await runtimeConfig();
 const data=parsed.data;
 if(data.operation==='plan'||data.operation==='discover')requireResearch(config);else requireEvidence(config);
 validateResearch(data.input);
 if(data.operation==='import')return json(await importEvidence(request,data.input,data.claimId,data.urls,config,AbortSignal.any([request.signal,AbortSignal.timeout(REQUEST_TIMEOUT_MS)])));
 if(data.operation==='discover')return json(await discoverEvidence(request,data.input,data.planToken,data.queryIndex,config,AbortSignal.any([request.signal,AbortSignal.timeout(REQUEST_TIMEOUT_MS)])));
 return json(await withBudget<unknown>(request,config,id,REQUEST_TIMEOUT_MS,(budgeted,signal)=>data.operation==='plan'?planResearch(request,data.input,budgeted,signal):compareEvidence(request,data.input,data.evidenceToken,budgeted,id,signal)));
 }catch(e){return errorResponse(e,id);}}

export const POST=withAudit('research',handlePost);
