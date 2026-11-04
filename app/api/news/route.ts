import {withAudit} from '@/lib/server/with-audit';
import {newsRequestSchema} from '@/lib/news-contract';
import {containsContactInfo} from '@/lib/privacy';
import {searchNews} from '@/lib/server/news';
import {isSearchLockBusy,releaseSearch,reserveSearch} from '@/lib/server/search-budget';
import {capabilities,runtimeConfig} from '@/lib/server/config';
import {AppError,errorResponse,json,readJson} from '@/lib/server/errors';
async function handlePost(request:Request){const id=crypto.randomUUID();try{
 const parsed=newsRequestSchema.safeParse(await readJson(request));
 if(!parsed.success)throw new AppError(422,'VALIDATION_ERROR','검색 전송 확인과 한국어·영문 핵심어 3~100자를 확인해 주세요. 연산자·주소·제어문자는 사용할 수 없습니다.');
 if(containsContactInfo(parsed.data.query))throw new AppError(422,'PRIVACY_INPUT_REJECTED','개인 연락처를 검색어로 사용할 수 없습니다.');
 const config=await runtimeConfig();
 // An unready provider must not consume site search quota.
 if(!capabilities(config).webSearch)throw new AppError(503,'SEARCH_UNAVAILABLE','관련 기사 검색을 준비 중입니다. 잠시 후 다시 확인해 주세요.');
 await reserveSearch(request,config,id);
 // Only the pre-dispatch lock failure frees the reservation; no automatic retry.
 try{return json(await searchNews(parsed.data.query,config,request.signal));}
 catch(e){if(isSearchLockBusy(e))await releaseSearch(request,config,id);throw e;}
 }catch(e){return errorResponse(e,id);}}

export const POST=withAudit('news',handlePost);
