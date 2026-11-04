import type {Capabilities} from './contracts';

export function newsProviderLabel(provider:Capabilities['searchProvider']){
 return provider==='firecrawl'?'Firecrawl':provider==='tavily'?'Tavily':provider==='publisher_feeds'?'공식 뉴스 RSS':'GDELT';
}
