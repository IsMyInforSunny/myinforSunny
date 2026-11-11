import {z} from 'zod/v4';
import {searchQuerySchema} from './contracts';

export const newsRequestSchema=z.object({query:searchQuerySchema,searchConsent:z.literal(true)}).strict();
export type RelatedArticle={id:string;title:string;url:string;publisherDomain:string;indexedAt?:string;publishedAt?:string;language:string;provenance:'search_result';stance:'not_checked'};
export type NewsResult={provider:'local_index'|'gdelt'|'firecrawl'|'tavily'|'publisher_feeds';query:string;status:'success'|'empty';articles:RelatedArticle[];searchedAt:string;scopeNote:string};
