import type {RuntimeConfig} from '../config';
export type StructuredCall={model:string;instructions:string;input:unknown;schema:unknown;signal:AbortSignal};
export interface StructuredProvider{id:'groq'|'openai';generate(request:StructuredCall,config:RuntimeConfig):Promise<string>;}
