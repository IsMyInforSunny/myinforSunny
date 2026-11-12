import {z} from 'zod/v4';
import {AppError} from './errors';
import {RuntimeConfig,modelName,providerReady,provider,paidProviderAllowed,NVIDIA_FAST_MODEL} from './config';
import {groqProvider,requestTokenBudget} from './providers/groq';
import {nvidiaProvider} from './providers/nvidia';
import {deepseekProvider} from './providers/deepseek';
export {requestTokenBudget,retrySeconds} from './providers/groq';
export {providerFailure} from './errors';

const requestIdPattern=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
/** Collect schema-owned property names without enum values, descriptions or input. */
function schemaFieldNames(node:unknown,names=new Set<string>()):Set<string>{
  if(!node||typeof node!=='object')return names;
  const schema=node as Record<string,unknown>;
  if(schema.properties&&typeof schema.properties==='object'){
    for(const [name,child] of Object.entries(schema.properties)){names.add(name);schemaFieldNames(child,names);}
  }
  if(schema.items)schemaFieldNames(schema.items,names);
  if(schema.additionalProperties&&typeof schema.additionalProperties==='object')schemaFieldNames(schema.additionalProperties,names);
  for(const key of ['$defs','definitions'])if(schema[key]&&typeof schema[key]==='object')for(const child of Object.values(schema[key]))schemaFieldNames(child,names);
  for(const key of ['anyOf','oneOf','allOf'])if(Array.isArray(schema[key])){
    for(const child of schema[key])schemaFieldNames(child,names);
  }
  return names;
}

/** Shared analysis contract across Groq, NVIDIA NIM and direct DeepSeek API. */
export async function structured<T>(config:RuntimeConfig,schema:z.ZodType<T>,instructions:string,input:unknown,signal:AbortSignal,options?:{generationSchema?:z.ZodType;requestId?:string}):Promise<T>{
  if(!['groq','nvidia','deepseek'].includes(provider(config))){
    if(!paidProviderAllowed(config))throw new AppError(503,'PAID_PROVIDER_DISABLED','현재는 무료 제공자만 사용합니다. 유료 API는 명시적 전환 전까지 비활성입니다.');
    throw new AppError(503,'PROVIDER_NOT_CONFIGURED','유료 제공자 전환은 모델·예산·어댑터 검증을 먼저 완료해야 합니다.');
  }
  if(provider(config)==='deepseek'&&!paidProviderAllowed(config))throw new AppError(503,'PAID_PROVIDER_DISABLED','DeepSeek 공식 API는 사용량에 따라 과금됩니다. 유료 제공자 설정을 명시적으로 활성화해야 합니다.');
  if(!providerReady(config))throw new AppError(503,'FEATURE_UNAVAILABLE','AI 제공자의 키·모델 설정을 먼저 확인해야 합니다.');
  const schemaJson=z.toJSONSchema(options?.generationSchema??schema,{target:'draft-7',reused:provider(config)==='nvidia'&&modelName(config)===NVIDIA_FAST_MODEL?'ref':'inline'});
  if(provider(config)==='groq')await requestTokenBudget(instructions,input,schemaJson);
  const requestId=options?.requestId&&requestIdPattern.test(options.requestId)?options.requestId:undefined;
  const call={model:modelName(config),instructions,input,schema:schemaJson,signal,requestId};
  const selected=provider(config)==='nvidia'?nvidiaProvider:provider(config)==='deepseek'?deepseekProvider:groqProvider;
  const output=await selected.generate(call,config);
  const invalid=()=>new AppError(502,'INVALID_MODEL_OUTPUT','AI 결과의 형식을 확인하지 못했습니다. 임의 결과로 대신하지 않습니다.');
  const logFailure=(stage:'json_decode'|'schema_validation',issues?:{path:string;code:string}[])=>{
    console.warn(JSON.stringify({type:'model_output_failure',provider:provider(config),stage,...(requestId?{requestId}:{}),...(issues?{issues}:{})}));
  };
  let decoded:unknown;
  try{decoded=JSON.parse(output);}catch{logFailure('json_decode');throw invalid();}
  const parsed=schema.safeParse(decoded);
  if(!parsed.success){
    const fields=schemaFieldNames(schemaJson);
    const issues=parsed.error.issues.slice(0,8).map(issue=>({
      path:issue.path.slice(0,8).map(part=>typeof part==='number'?String(part):typeof part==='string'&&fields.has(part)?part:'*').join('.'),
      code:issue.code,
    }));
    logFailure('schema_validation',issues);throw invalid();
  }
  return parsed.data;
}
