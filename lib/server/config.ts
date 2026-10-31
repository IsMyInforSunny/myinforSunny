import type { Capabilities } from '../contracts';
import {dailyLimits} from './limits';
import { RUBRIC } from '../contracts';
import {searchProviderReady,searchProvider} from './search-settings';
export type RuntimeConfig={AI_PROVIDER?:string;FREE_ONLY?:string;ENABLE_PAID_PROVIDER?:string;PAID_ACTIVATION_CONFIRMED?:string;CLOUDFLARE_ACCOUNT_ID?:string;CLOUDFLARE_AI_TOKEN?:string;OPENAI_API_KEY?:string;OPENAI_MODEL?:string;GROQ_API_KEY?:string;IP_HASH_SECRET?:string;GROQ_MODEL?:string;GROQ_ELIGIBILITY_CONFIRMED?:string;GROQ_FREE_PLAN_CONFIRMED?:string;ENABLE_LIVE_ANALYSIS?:string;ENABLE_NEWS_SEARCH?:string;NEWS_TERMS_APPROVED?:string;NEWS_PROVIDER?:string;TAVILY_API_KEY?:string;TAVILY_FREE_PLAN_CONFIRMED?:string;TAVILY_ELIGIBILITY_CONFIRMED?:string;TAVILY_MONTHLY_CREDITS_CONFIRMED?:string;TAVILY_MONTHLY_CREDITS?:string;DB?:D1Database;DAILY_TOKEN_BUDGET?:string;GROQ_CONSOLE_LIMITS_CONFIRMED?:string;GROQ_CONSOLE_TPD?:string;GROQ_CONSOLE_RPD?:string;ALLOWED_RETRIEVAL_HOSTS?:string;onDispatch?:()=>void;onUsage?:(tokens:number)=>void;onRateLimit?:(seconds:number)=>Promise<void>};
export function paidProviderAllowed(c:RuntimeConfig){return c.FREE_ONLY==='false'&&c.ENABLE_PAID_PROVIDER==='true'&&c.PAID_ACTIVATION_CONFIRMED==='true';}
export const GROQ_MODELS=['openai/gpt-oss-120b'] as const;
// Qwen remains a comparison candidate until its tokenizer and request budget are verified.
export function provider(c:RuntimeConfig){return c.AI_PROVIDER??'groq';}
export function modelName(c:RuntimeConfig){return c.GROQ_MODEL??'';}
export function providerReady(c:RuntimeConfig){return provider(c)==='groq'&&!!c.GROQ_API_KEY&&GROQ_MODELS.some(m=>m===c.GROQ_MODEL)&&c.GROQ_ELIGIBILITY_CONFIRMED==='true'&&c.GROQ_FREE_PLAN_CONFIRMED==='true';}
export async function runtimeConfig():Promise<RuntimeConfig>{
  try{const {env}=await import('cloudflare:workers');return env as RuntimeConfig;}catch{return process.env as RuntimeConfig;}
}
export function capabilities(c:RuntimeConfig):Capabilities{
  const live=c.ENABLE_LIVE_ANALYSIS==='true'&&providerReady(c)&&dailyLimits(c).verified&&!!c.DB;
  return {live,webSearch:searchProviderReady(c)&&c.ENABLE_NEWS_SEARCH==='true'&&c.NEWS_TERMS_APPROVED==='true'&&!!c.DB,webFetch:live&&searchProviderReady(c)&&c.ENABLE_NEWS_SEARCH==='true'&&c.NEWS_TERMS_APPROVED==='true'&&!!c.ALLOWED_RETRIEVAL_HOSTS?.trim(),searchProviderName:searchProvider(c)==='tavily'?'Tavily':'GDELT',rubricVersion:RUBRIC,limits:{body:2000,comments:5,comment:200,claimsPerCheck:1},...(!live?{reason:'실시간 분석은 준비 중이에요. 예시를 체험해 보세요.'}:{})};
}
