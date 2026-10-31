export class AppError extends Error {
  constructor(public status:number,public code:string,message:string,public retryable=false,public fields?:{path:string;message:string}[]){super(message);}
}
export function json(data:unknown,status=200,headers:Record<string,string>={}){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});}
export function errorResponse(error:unknown,requestId:string){
  if(error instanceof AppError)return json({requestId,error:{code:error.code,message:error.message,retryable:error.retryable,fields:error.fields}},error.status,error.status===429?{'Retry-After':'60'}:{});
  return json({requestId,error:{code:'INTERNAL_ERROR',message:'처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',retryable:true}},500);
}
export async function readJson(request:Request){
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new AppError(415,'UNSUPPORTED_MEDIA_TYPE','JSON 요청만 지원합니다.');
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new AppError(403,'ORIGIN_NOT_ALLOWED','이 사이트에서 요청해 주세요.');
  const reader=request.body?.getReader();if(!reader)throw new AppError(400,'INVALID_JSON','입력 내용을 읽을 수 없습니다.');
  let length=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>384*1024){await reader.cancel();throw new AppError(413,'PAYLOAD_TOO_LARGE','입력 용량을 줄여 주세요.');}chunks.push(value);}
  const body=new Uint8Array(length);let i=0;for(const c of chunks){body.set(c,i);i+=c.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{throw new AppError(400,'INVALID_JSON','올바른 JSON 요청이 필요합니다.');}
}

export function providerFailure(status:number,code?:string,type?:string):AppError{
  const quotaCodes=['insufficient_quota','credit_balance_exhausted','billing_hard_limit_reached','billing_not_active'];
  if(quotaCodes.includes(code??'')||type==='insufficient_quota')return new AppError(503,'API_QUOTA_EXHAUSTED','AI 서비스의 API 크레딧 또는 사용 예산이 부족합니다. 사이트 운영자가 API 결제·한도를 확인해야 합니다.',false);
  if(status===401)return new AppError(503,'API_AUTH_FAILED','AI 서비스 인증 설정을 확인해야 합니다.',false);
  if(status===403||status===404)return new AppError(503,'MODEL_ACCESS_DENIED','설정한 AI 모델의 접근 권한을 확인해야 합니다.',false);
  if(status===429)return new AppError(429,'RATE_LIMITED','AI 서비스의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',true);
  if(status===400)return new AppError(502,'PROVIDER_REQUEST_INVALID','AI 요청 설정을 확인해야 합니다.',false);
  return new AppError(503,'PROVIDER_UNAVAILABLE','AI 서비스에 일시적으로 연결하지 못했습니다.',status>=500);
}
