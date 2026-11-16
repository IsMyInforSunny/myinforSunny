import type {Analysis} from '../contracts';
import {analyzeRequestSchema,MAX_ARTICLE_CHARACTERS} from '../contracts';
import {containsContactInfo} from '../privacy';
import {articleTextPrefix} from './article-document';
import {analyze} from './analyze';
import {capabilities,type RuntimeConfig} from './config';
import {AppError} from './errors';
import {allowedUrl,retrieveDetailed} from './retrieval';
import {attachVoiceCoordinates} from './voice-analysis';

type UrlRequest=Extract<import('zod/v4').infer<typeof analyzeRequestSchema>,{kind:'url'}>;
type TextRequest=Extract<import('zod/v4').infer<typeof analyzeRequestSchema>,{kind:'text'}>;
export async function prepareUrlAnalysis(req:UrlRequest,config:RuntimeConfig,requestId:string,signal:AbortSignal):Promise<{input:TextRequest;article:NonNullable<Analysis['article']>;articleHash:string}>{
 const hosts=(config.ALLOWED_RETRIEVAL_HOSTS??'').split(',').map(s=>s.trim()).filter(Boolean);
 if(!capabilities(config).directFetch)throw new AppError(503,'ARTICLE_IMPORT_UNAVAILABLE','기사 링크 분석은 현재 준비 중입니다. 잠시 후 다시 시도해 주세요.');
 const url=allowedUrl(req.url,hosts);
 if(!url)throw new AppError(422,'ARTICLE_URL_NOT_ALLOWED','현재 지원하는 언론사의 HTTPS 기사 링크를 입력해 주세요. 포털·단축 주소 대신 언론사 원문 링크를 사용해 주세요.');
 const retrievalStarted=Date.now();
 const fetched=await retrieveDetailed(url.href,'input_article',config,signal);
 console.info(JSON.stringify({type:'article_timing',stage:'retrieved',durationMs:Date.now()-retrievalStarted,requestId}));
 if(!fetched.ok){
  const messages:Record<typeof fetched.reason,string>={
   INVALID_URL:'안전한 HTTPS 기사 링크인지 확인해 주세요.',BLOCKED_DESTINATION:'안전하지 않은 네트워크 주소로 연결되어 가져오기를 중단했습니다.',
   ROBOTS_DISALLOWED:'이 페이지는 자동 수집을 허용하지 않습니다. 본문을 직접 입력해 주세요.',ROBOTS_AI_RESTRICTED:'이 매체는 자동 수집을 제한하고 있어 링크로 가져오지 않습니다. 본문을 붙여 넣어 주세요.',
   ACCESS_RESTRICTED:'로그인·유료 또는 접근 제한 기사는 링크로 분석할 수 없습니다. 공개 본문을 직접 입력해 주세요.',NOT_HTML:'기사 페이지 형식이 아니어서 본문을 가져오지 못했습니다.',
   TOO_LARGE:'기사 페이지가 허용된 크기를 넘어 가져오지 못했습니다.',TIMEOUT:'기사 페이지 응답 시간이 초과됐습니다. 잠시 후 다시 시도하거나 본문을 붙여 넣어 주세요.',
   SCRIPT_RENDERED:'페이지가 스크립트로만 표시되어 본문을 추출하지 못했습니다. 본문을 직접 입력해 주세요.',TOO_SHORT:'추출한 본문이 너무 짧습니다. 본문을 직접 입력해 주세요.',HOST_RATE_LIMITED:'이 매체에 대한 요청이 잠시 제한되었습니다. 기다린 뒤 다시 시도해 주세요.'
  };
  console.info(JSON.stringify({type:'article_retrieval_failed',host:url.hostname,reason:fetched.reason}));
  throw new AppError(422,`ARTICLE_FETCH_${fetched.reason}`,messages[fetched.reason]);
 }
 const {reference:ref}=fetched;
 const body=articleTextPrefix(ref.text,MAX_ARTICLE_CHARACTERS);
 if(containsContactInfo([body,req.proposition??'',...req.comments.map(c=>c.text)].join('\n')))throw new AppError(422,'PRIVACY_INPUT_REJECTED','기사나 댓글에서 전화번호·이메일 등 개인정보가 발견되어 분석을 중단했습니다.');
 const input=analyzeRequestSchema.safeParse({kind:'text',body,comments:req.comments,proposition:req.proposition,transmissionConsent:true});
 if(!input.success||input.data.kind!=='text')throw new AppError(422,'ARTICLE_BODY_UNAVAILABLE','분석할 기사 본문을 확인하지 못했습니다.');
 const article={url:url.href,title:ref.title,...(ref.publishedAt?{publishedAt:ref.publishedAt}:{}),fetchedAt:ref.fetchedAt??new Date().toISOString(),fullTextLength:ref.fullTextLength??ref.text.length,analyzedCharacters:body.length,truncated:!!ref.truncated||body.length<ref.text.length,retrieval:fetched.metadata};
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([ref.text,ref.title,ref.publishedAt])));
 const articleHash=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
 return {input:input.data,article,articleHash};
}
export async function analyzePreparedUrl(prepared:Awaited<ReturnType<typeof prepareUrlAnalysis>>,config:RuntimeConfig,requestId:string,signal:AbortSignal):Promise<Analysis>{
 const result=await analyze(prepared.input,config,requestId,signal,{article:true,articleUrl:prepared.article.url,articleTitle:prepared.article.title});
 result.article=prepared.article;
 if(result.article.truncated)result.warnings.push({code:'ARTICLE_TRUNCATED',message:'긴 기사에서 처음 8,000자 이내만 분석했습니다. 기사 전체에 대한 결과가 아닙니다.'});
 return attachVoiceCoordinates(result);
}
export async function analyzeUrl(req:UrlRequest,config:RuntimeConfig,requestId:string,signal:AbortSignal):Promise<Analysis>{
 return analyzePreparedUrl(await prepareUrlAnalysis(req,config,requestId,signal),config,requestId,signal);
}
