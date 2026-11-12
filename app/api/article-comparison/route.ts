import {z} from 'zod/v4';
import {containsContactInfo} from '@/lib/privacy';
import {compareEventBaseline} from '@/lib/server/event-comparison';
import {AppError,errorResponse,json,readJson} from '@/lib/server/errors';

const inputSchema=z.object({body:z.string().trim().min(1).max(8000),title:z.string().max(500).optional(),
  publishedAt:z.string().max(60).optional()}).strict();
/** Explicit local-index lookup only; no new collection, external search or AI call. */
export async function POST(request:Request){
  const requestId=crypto.randomUUID();
  try{
    const parsed=inputSchema.safeParse(await readJson(request));
    if(!parsed.success)throw new AppError(422,'VALIDATION_ERROR','비교할 기사 본문·제목·발행일을 확인해 주세요.');
    if(containsContactInfo([parsed.data.body,parsed.data.title??''].join('\n')))throw new AppError(422,'PRIVACY_INPUT_REJECTED','개인 연락처를 지워 주세요.');
    return json(compareEventBaseline(parsed.data));
  }catch(error){return errorResponse(error,requestId);}
}
