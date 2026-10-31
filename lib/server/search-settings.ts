import type {RuntimeConfig} from './config';
export function searchProvider(c:RuntimeConfig){return c.NEWS_PROVIDER??'gdelt';}
export function searchProviderReady(c:RuntimeConfig){
 if(searchProvider(c)==='gdelt')return true;
 const credits=Number(c.TAVILY_MONTHLY_CREDITS);
 return searchProvider(c)==='tavily'&&!!c.TAVILY_API_KEY&&c.TAVILY_FREE_PLAN_CONFIRMED==='true'&&c.TAVILY_ELIGIBILITY_CONFIRMED==='true'&&c.TAVILY_MONTHLY_CREDITS_CONFIRMED==='true'&&Number.isSafeInteger(credits)&&credits>0;
}
export function monthlySearchLimit(c:RuntimeConfig){const n=Number(c.TAVILY_MONTHLY_CREDITS);return searchProvider(c)==='tavily'&&searchProviderReady(c)?Math.min(800,Math.floor(n*0.8)):800;}
