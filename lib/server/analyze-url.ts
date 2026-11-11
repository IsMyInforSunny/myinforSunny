import type {Analysis} from '../contracts';
import {analyzeRequestSchema} from '../contracts';
import {containsContactInfo} from '../privacy';
import {articleTextPrefix} from './article-document';
import {analyze} from './analyze';
import {capabilities,type RuntimeConfig} from './config';
import {AppError} from './errors';
import {allowedUrl,retrieve} from './retrieval';

export async function analyzeUrl(req:Extract<import('zod/v4').infer<typeof analyzeRequestSchema>,{kind:'url'}>,config:RuntimeConfig,requestId:string,signal:AbortSignal):Promise<Analysis>{
 const hosts=(config.ALLOWED_RETRIEVAL_HOSTS??'').split(',').map(s=>s.trim()).filter(Boolean);
 if(!capabilities(config).directFetch)throw new AppError(503,'ARTICLE_IMPORT_UNAVAILABLE','기사 링크 분석은 현재 준비 중입니다. 잠시 후 다시 시도해 주세요.');
 const url=allowedUrl(req.url,hosts);
 if(!url)throw new AppError(422,'ARTICLE_URL_NOT_ALLOWED','현재 지원하는 언론사의 HTTPS 기사 링크를 입력해 주세요. 포털·단축 주소 대신 언론사 원문 링크를 사용해 주세요.');
 const retrievalStarted=Date.now();
 const ref=await retrieve(url.href,'input_article',config,signal);
 console.info(JSON.stringify({type:'article_timing',stage:'retrieved',durationMs:Date.now()-retrievalStarted,requestId}));
 if(!ref||ref.text.trim().length<100)throw new AppError(422,'ARTICLE_BODY_UNAVAILABLE','기사 본문을 가져오지 못했습니다. 언론사 원문 링크인지 확인해 주세요. 로그인·유료·접근 제한 기사는 분석할 수 없습니다.');
 const body=articleTextPrefix(ref.text,8000);
 if(containsContactInfo([body,req.proposition??'',...req.comments.map(c=>c.text)].join('\n')))throw new AppError(422,'PRIVACY_INPUT_REJECTED','기사나 댓글에서 전화번호·이메일 등 개인정보가 발견되어 분석을 중단했습니다.');
 const input=analyzeRequestSchema.safeParse({kind:'text',body,comments:req.comments,proposition:req.proposition,transmissionConsent:true});
 if(!input.success||input.data.kind!=='text')throw new AppError(422,'ARTICLE_BODY_UNAVAILABLE','분석할 기사 본문을 확인하지 못했습니다.');
 const result=await analyze(input.data,config,requestId,signal);
 result.article={url:ref.url??url.href,title:ref.title,fetchedAt:ref.fetchedAt??new Date().toISOString(),fullTextLength:ref.fullTextLength??ref.text.length,analyzedCharacters:body.length,truncated:!!ref.truncated||body.length<ref.text.length};
 if(result.article.truncated)result.warnings.push({code:'ARTICLE_TRUNCATED',message:'긴 기사에서 처음 8,000자 이내만 분석했습니다. 기사 전체에 대한 결과가 아닙니다.'});
 return result;
}
