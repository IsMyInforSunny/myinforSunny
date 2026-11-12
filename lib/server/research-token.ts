import type {RuntimeConfig} from './config';
import {AppError} from './errors';
import {actorHash} from './budget';

export type ResearchTokenKind='plan'|'evidence';
type Envelope<T>={v:1;kind:ResearchTokenKind;actor:string;issuedAt:number;expiresAt:number;data:T};
const encoder=new TextEncoder();
function encode(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function decode(text:string){if(!/^[A-Za-z0-9_-]+$/.test(text))throw Error('invalid encoding');return Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}
async function key(config:RuntimeConfig){const material=config.IP_HASH_SECRET??(config.AI_PROVIDER==='deepseek'?config.DEEPSEEK_API_KEY:config.AI_PROVIDER==='nvidia'?config.NVIDIA_API_KEY:config.GROQ_API_KEY);if(!material)throw new AppError(503,'RESEARCH_UNAVAILABLE','자동 조사 설정을 확인해야 합니다.');const base=await crypto.subtle.importKey('raw',encoder.encode(material),{name:'HMAC',hash:'SHA-256'},false,['sign']);const derived=await crypto.subtle.sign('HMAC',base,encoder.encode('naeinfo:research-envelope:v1'));return crypto.subtle.importKey('raw',derived,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function digest(value:unknown){return encode(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(value)))));}
export async function signResearchToken<T>(request:Request,config:RuntimeConfig,kind:ResearchTokenKind,data:T,ttlMs=30*60000,now=Date.now()){
 const payload:Envelope<T>={v:1,kind,actor:await actorHash(request,config),issuedAt:now,expiresAt:now+Math.min(ttlMs,30*60000),data};
 const content=encode(encoder.encode(JSON.stringify(payload)));const signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key(config),encoder.encode(content))));return `${content}.${signature}`;
}
export async function readResearchToken<T>(request:Request,config:RuntimeConfig,token:string,kind:ResearchTokenKind,now=Date.now()):Promise<T>{
 try{
  if(token.length>64000)throw Error('too large');const parts=token.split('.');if(parts.length!==2)throw Error('invalid envelope');
  if(!await crypto.subtle.verify('HMAC',await key(config),decode(parts[1]),encoder.encode(parts[0])))throw Error('bad signature');
  const payload=JSON.parse(new TextDecoder().decode(decode(parts[0]))) as Envelope<T>;
  if(payload.v!==1||payload.kind!==kind||payload.expiresAt<=now||payload.issuedAt>now+5000||payload.expiresAt-payload.issuedAt>30*60000||payload.actor!==await actorHash(request,config))throw Error('expired or different caller');
  return payload.data;
 }catch{throw new AppError(422,'INVALID_RESEARCH_EVIDENCE','조사 자료의 유효 기간이나 일치 여부를 확인하지 못했습니다. 다시 조사를 시작해 주세요.');}
}
