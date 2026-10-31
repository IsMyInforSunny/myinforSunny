import type {RuntimeConfig} from './config';
// Console-verified values must be supplied by the operator; a public table is not account evidence.
export const FREE_SAFETY_RATIO=0.8;
export const IP_REQUESTS_PER_MINUTE=3;
export const IP_REQUESTS_PER_HOUR=20;
export const REQUEST_TIMEOUT_MS=60000;
export const DEFAULT_DAILY_TOKEN_BUDGET=120000;
export function dailyLimits(c:RuntimeConfig){
 const positive=(value:string|undefined)=>value?.trim()&&Number.isFinite(Number(value))&&Number(value)>=0?Math.floor(Number(value)):undefined;
 const confirmed=c.GROQ_CONSOLE_LIMITS_CONFIRMED==='true';
 const tokenLimit=positive(c.GROQ_CONSOLE_TPD);const requestLimit=positive(c.GROQ_CONSOLE_RPD);
 const requested=positive(c.DAILY_TOKEN_BUDGET)??DEFAULT_DAILY_TOKEN_BUDGET;
 return {verified:confirmed&&tokenLimit!==undefined&&requestLimit!==undefined,tokens:Math.min(requested,Math.floor((tokenLimit??150000)*FREE_SAFETY_RATIO)),requests:Math.min(500,Math.floor((requestLimit??625)*FREE_SAFETY_RATIO))};
}
