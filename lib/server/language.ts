import {z} from 'zod/v4';
import {AppError} from './errors';
import {RuntimeConfig,modelName,providerReady,provider,paidProviderAllowed} from './config';
import {groqProvider,requestTokenBudget} from './providers/groq';
import {nvidiaProvider} from './providers/nvidia';
export {requestTokenBudget,retrySeconds} from './providers/groq';
export {providerFailure} from './errors';

/** Shared analysis contract. Groq and NVIDIA use the same validated analysis contract. */
export async function structured<T>(config:RuntimeConfig,schema:z.ZodType<T>,instructions:string,input:unknown,signal:AbortSignal,options?:{generationSchema:z.ZodType}):Promise<T>{
  if(!['groq','nvidia'].includes(provider(config))){
    if(!paidProviderAllowed(config))throw new AppError(503,'PAID_PROVIDER_DISABLED','현재는 무료 제공자만 사용합니다. 유료 API는 명시적 전환 전까지 비활성입니다.');
    throw new AppError(503,'PROVIDER_NOT_CONFIGURED','유료 제공자 전환은 모델·예산·어댑터 검증을 먼저 완료해야 합니다.');
  }
  if(!providerReady(config))throw new AppError(503,'FEATURE_UNAVAILABLE','AI 제공자의 키·모델 설정을 먼저 확인해야 합니다.');
  const schemaJson=z.toJSONSchema(options?.generationSchema??schema,{target:'draft-7'});
  if(provider(config)==='groq')await requestTokenBudget(instructions,input,schemaJson);
  const output=await (provider(config)==='nvidia'?nvidiaProvider:groqProvider).generate({model:modelName(config),instructions,input,schema:schemaJson,signal},config);
  try{return schema.parse(JSON.parse(output));}
  catch{throw new AppError(502,'INVALID_MODEL_OUTPUT','AI 결과의 형식을 확인하지 못했습니다. 임의 결과로 대신하지 않습니다.');}
}
