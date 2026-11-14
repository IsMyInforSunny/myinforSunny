import {z} from 'zod/v4';
import type {Analysis} from '../contracts';
import type {ResearchInput} from '../research-contract';
import {voiceArticleHash} from '../sentence-voice';
import type {RuntimeConfig} from './config';
import {digest,readResearchToken,signResearchToken} from './research-token';
import {AppError} from './errors';

const contextSchema=z.object({bodyDigest:z.string().min(1),bodyHash:z.string().regex(/^[a-f0-9]{64}$/),
  article:z.object({url:z.string().url().refine(value=>{
    const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;
  }),title:z.string().max(500).optional(),publishedAt:z.string().refine(value=>Number.isFinite(Date.parse(value))).optional()})});
export type VoiceArticleContext=z.infer<typeof contextSchema>;

/** Sign retrieved metadata after cache delivery, so actor-specific tokens are
 * never stored in the shared public article cache. Contains no article body. */
export async function issueVoiceArticleContext(request:Request,config:RuntimeConfig,analysis:Analysis){
  const body=analysis.sources.find(source=>source.kind==='body');
  if(analysis.mode!=='live'||!analysis.article||!body)return undefined;
  const article={url:analysis.article.url,...(analysis.article.title?{title:analysis.article.title.slice(0,500)}:{}),
    ...(analysis.article.publishedAt&&Number.isFinite(Date.parse(analysis.article.publishedAt))?{publishedAt:analysis.article.publishedAt}:{})};
  const data=contextSchema.safeParse({bodyDigest:await digest(body.text),bodyHash:await voiceArticleHash(body.text),article});
  return data.success?signResearchToken(request,config,'article_context',data.data):undefined;
}

/** Browser-carried dates and URLs cannot establish a same-event baseline. */
export async function readVoiceArticleContext(request:Request,config:RuntimeConfig,input:Pick<ResearchInput,'sources'|'articleContextToken'>):Promise<VoiceArticleContext|null>{
  if(!input.articleContextToken)return null;
  const decoded=await readResearchToken<unknown>(request,config,input.articleContextToken,'article_context');
  const parsed=contextSchema.safeParse(decoded),body=input.sources.find(source=>source.kind==='body');
  if(!parsed.success||!body||parsed.data.bodyDigest!==await digest(body.text)||parsed.data.bodyHash!==await voiceArticleHash(body.text))
    throw new AppError(422,'RESEARCH_INPUT_CHANGED','기사 본문이 바뀌었습니다. 링크를 다시 분석한 뒤 비교해 주세요.');
  return parsed.data;
}
