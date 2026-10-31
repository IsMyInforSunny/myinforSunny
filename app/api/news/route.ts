import {newsRequestSchema} from '@/lib/news-contract';
import {containsContactInfo} from '@/lib/privacy';
import {searchNews} from '@/lib/server/news';
import {reserveSearch} from '@/lib/server/search-budget';
import {runtimeConfig} from '@/lib/server/config';
import {AppError,errorResponse,json,readJson} from '@/lib/server/errors';
export async function POST(request:Request){const id=crypto.randomUUID();try{
 const parsed=newsRequestSchema.safeParse(await readJson(request));
 if(!parsed.success)throw new AppError(422,'VALIDATION_ERROR','검색 전송 확인과 영문 핵심어 3~100자를 확인해 주세요.');
 if(containsContactInfo(parsed.data.query))throw new AppError(422,'PRIVACY_INPUT_REJECTED','개인 연락처를 검색어로 사용할 수 없습니다.');
 const config=await runtimeConfig();await reserveSearch(request,config,id);
 return json(await searchNews(parsed.data.query,config,request.signal));
 }catch(e){return errorResponse(e,id);}}
