import type {RuntimeConfig} from './config';
// Console-verified values must be supplied by the operator; a public table is not account evidence.
export const FREE_SAFETY_RATIO=0.8;
export const IP_REQUESTS_PER_MINUTE=3;
export const IP_REQUESTS_PER_HOUR=20;
export const REQUEST_TIMEOUT_MS=60000;
export const DEFAULT_DAILY_TOKEN_BUDGET=120000;
export const MODEL_REQUEST_RESERVATION=6500;
export const MAX_MODEL_TOKENS_PER_MINUTE=7000;
/** Missing minute values retain legacy safeguards; supplied verified values can only tighten them. */
export function minuteLimits(c:RuntimeConfig){
 const confirmed=c.GROQ_CONSOLE_LIMITS_CONFIRMED==='true';
 const configured=(value:string|undefined)=>!!value?.trim();
 const integer=(value:string|undefined)=>value&&/^\d+$/.test(value.trim())&&Number.isSafeInteger(Number(value))?Number(value):undefined;
 const tokenConfigured=configured(c.GROQ_CONSOLE_TPM),requestConfigured=configured(c.GROQ_CONSOLE_RPM);
 const tokenLimit=integer(c.GROQ_CONSOLE_TPM),requestLimit=integer(c.GROQ_CONSOLE_RPM);
 const invalid=confirmed&&(tokenConfigured&&tokenLimit===undefined||requestConfigured&&requestLimit===undefined);
 const tokens=confirmed&&tokenLimit!==undefined?Math.min(MAX_MODEL_TOKENS_PER_MINUTE,tokenLimit):MAX_MODEL_TOKENS_PER_MINUTE;
 const requests=confirmed&&requestLimit!==undefined?requestLimit:null;
 const reason=invalid?'invalid_minute_limits':tokens<MODEL_REQUEST_RESERVATION?'reservation_exceeds_token_limit':requests===0?'no_requests_available':'ok';
 return {tokens,requests,tokensVerified:confirmed&&tokenLimit!==undefined,requestsVerified:confirmed&&requestLimit!==undefined,
   compatible:reason==='ok',reason};
}
export function dailyLimits(c:RuntimeConfig){
 const positive=(value:string|undefined)=>value?.trim()&&Number.isFinite(Number(value))&&Number(value)>=0?Math.floor(Number(value)):undefined;
 const confirmed=c.GROQ_CONSOLE_LIMITS_CONFIRMED==='true';
 const tokenLimit=positive(c.GROQ_CONSOLE_TPD);const requestLimit=positive(c.GROQ_CONSOLE_RPD);
 const requested=positive(c.DAILY_TOKEN_BUDGET)??DEFAULT_DAILY_TOKEN_BUDGET;
 return {verified:confirmed&&tokenLimit!==undefined&&requestLimit!==undefined,tokens:Math.min(DEFAULT_DAILY_TOKEN_BUDGET,requested,Math.floor((tokenLimit??150000)*FREE_SAFETY_RATIO)),requests:Math.min(500,Math.floor((requestLimit??625)*FREE_SAFETY_RATIO))};
}
