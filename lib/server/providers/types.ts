import type {RuntimeConfig} from '../config';
export type StructuredCall={model:string;instructions:string;input:unknown;schema:unknown;signal:AbortSignal;maxCompletionTokens?:number};
export interface StructuredProvider{id:'groq'|'openai'|'nvidia'|'deepseek';generate(request:StructuredCall,config:RuntimeConfig):Promise<string>;}
