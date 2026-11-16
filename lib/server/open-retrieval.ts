import {getDomain} from 'tldts';
import fetchDenylist from '../data/fetch-denylist.json';

const blockedRoots=new Set((fetchDenylist.hosts as string[]).map(host=>host.toLowerCase()));

/** The list contains registrable roots so subdomains inherit a policy denial. */
export function isFetchDenylistedHost(host:string){
 const root=getDomain(host,{allowPrivateDomains:false});
 return !!root&&blockedRoots.has(root.toLowerCase());
}

/**
 * Open retrieval is opt-in. A local runtime needs an additional explicit flag
 * because it can reach the operator's private network; callers must pass the
 * runtime classification they have verified rather than guessing from URL.
 */
export function openFetchEnabled(config:{ENABLE_OPEN_FETCH?:string;ALLOW_LOCAL_OPEN_FETCH?:string},runtime:'remote'|'local'){
 return config.ENABLE_OPEN_FETCH==='true'&&(runtime==='remote'||config.ALLOW_LOCAL_OPEN_FETCH==='true');
}

export function isPublicHttpsHostname(hostname:string){
 try{
  if(hostname.includes(':'))return false;
  const parsed=new URL(`https://${hostname}`);
  const host=parsed.hostname.toLowerCase();
  if(parsed.protocol!=='https:'||parsed.port||parsed.username||parsed.password||host.endsWith('.')||!host.includes('.'))return false;
  if(/^(?:localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(host))return false;
  if(/^\[.*\]$/.test(host)||/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host))return false;
  return !!getDomain(host,{allowPrivateDomains:false});
 }catch{return false;}
}
