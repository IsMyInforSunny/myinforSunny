import fs from 'node:fs';
import path from 'node:path';

// Resolve the existing provider configuration; never persist a credential.
export function createBazeLabelingAdapter(configPath = process.env.INFORCAST_BAZE_CONFIG_PATH ?? path.join(process.env.USERPROFILE, '.codex/config.toml')) {
  const config = fs.readFileSync(configPath, 'utf8');
  const section = config.match(/\[model_providers\.factchat\]([\s\S]*?)(?=\n\[|$)/)?.[1];
  if (!section) throw Error('BAZE_FACTCHAT_CONFIG_MISSING');
  const string = name => {
    const value = section.match(new RegExp('^\\s*'+name+'\\s*=\\s*("[^"\\r\\n]*")', 'm'))?.[1];
    return value ? JSON.parse(value) : undefined;
  };
  const base = new URL(string('base_url'));
  if (base.protocol !== 'https:' || base.hostname !== 'api.baze.co' || base.username || base.password || base.search || base.hash) throw Error('BAZE_CONFIG_ENDPOINT_INVALID');
  const envKey = string('env_key');
  if (!envKey || !process.env[envKey]) throw Error('BAZE_CONFIG_CREDENTIAL_UNAVAILABLE');
  const key = process.env[envKey];
  const baseUrl = base.href.replace(/\/$/, '');
  async function request(endpoint, body, timeoutMs) {
    const response = await fetch(baseUrl + endpoint, {method: body ? 'POST' : 'GET', headers: {Authorization: 'Bearer '+key, ...(body ? {'Content-Type':'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {}), redirect:'error', signal:AbortSignal.timeout(timeoutMs)});
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(Error('BAZE_HTTP_'+response.status), {status:response.status}); }
    return response.json();
  }
  return {
    metadata: {baseUrl, configSource:'factchat provider configuration', credentialSource:'configured env_key; value never logged'},
    async models() { const data=await request('/models',undefined,20000); return (data.data ?? []).map(({id,owned_by,lifecycle,shutdown_at,endpoints})=>({id,owned_by,lifecycle,shutdown_at,endpoints})); },
    async label({model,messages,maxTokens,timeoutMs=180000}) {
      const started=Date.now();
      const data=await request('/responses',{model,input:messages,temperature:0,max_output_tokens:maxTokens,text:{format:{type:'json_object'}},store:false},timeoutMs);
      const text=data.output_text ?? (data.output ?? []).flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text??'').join('');
      return {text,status:data.status,finishReason:data.incomplete_details?.reason??data.status,usage:data.usage??null,durationMs:Date.now()-started};
    }
  };
}
