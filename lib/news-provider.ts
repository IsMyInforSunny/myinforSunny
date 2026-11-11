import type {Capabilities} from './contracts';

export function newsProviderLabel(provider:Capabilities['searchProvider']|'local_index'){
 return provider==='local_index'?'수집 기사 색인':provider==='firecrawl'?'Firecrawl':provider==='tavily'?'Tavily':provider==='publisher_feeds'?'공식 뉴스 RSS':'GDELT';
}
