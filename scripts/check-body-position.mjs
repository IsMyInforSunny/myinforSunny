// Opt-in real HTTP/model regression. No keys, original bodies or response bodies in reports.
import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2),base=args.find(value=>value.startsWith('--base='))?.slice(7);
if(!args.includes('--live')||!base||!/^https?:\/\//.test(base))throw Error('Explicit --live --base=http(s)://... required');
const selected=args.find(value=>value.startsWith('--only='))?.slice(7).split(',');
const fixture=JSON.parse(fs.readFileSync('research/body-position-cases.json','utf8'));
const cases=[...fixture.synthetic.map(item=>({...item,kind:'synthetic'})),...fixture.real.map(item=>({...item,kind:'real'}))].filter(item=>!selected||selected.includes(item.id));
const started=new Date().toISOString(),results=[];
let lastRequest=0;
for(const item of cases){
 // Existing API allows three requests/minute; no guard is disabled for QA.
 const wait=Math.max(0,21000-(Date.now()-lastRequest));
 if(wait)await new Promise(resolve=>setTimeout(resolve,wait));lastRequest=Date.now();
 const at=Date.now();let row={id:item.id,kind:item.kind};
 try{
  const response=await fetch(new URL('/api/analyze',base),{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(item.kind==='real'?{kind:'url',url:item.url,comments:[],transmissionConsent:true}:{kind:'text',body:item.body,comments:[],transmissionConsent:true}),signal:AbortSignal.timeout(120000)});
  const value=await response.json().catch(()=>null),position=value?.bodyPosition;
  const expected=item.expected;
  const passed=expected?response.ok&&Object.entries(expected).every(([key,wanted])=>key==='minimumFactualClaims'
   ?(value.claims??[]).filter(claim=>claim.kind==='factual').length>=wanted:position?.[key]===wanted):null;
  row={...row,httpStatus:response.status,durationMs:Date.now()-at,cache:response.headers.get('x-analysis-cache'),
   proposition:position?.proposition??null,label:position?.label??null,attribution:position?.attribution??null,attributionSource:position?.attributionSource??null,
   stimulation:value?.indicators?.expression??null,naturalSentences:value?.coverage?.naturalSentences??null,
   factualClaims:(value?.claims??[]).filter(claim=>claim.kind==='factual').length,warnings:(value?.warnings??[]).map(warning=>warning.code),
   errorCode:value?.error?.code??null,passed};
 }catch(error){row={...row,durationMs:Date.now()-at,errorCode:error.name,passed:false};}
 results.push(row);console.log(JSON.stringify(row));
 // A disconnected client may leave the server call finishing; do not overlap it.
 // Provider limits and timeouts stop the run; no fallback or automatic retries.
 if(row.httpStatus===429||['RATE_LIMITED','TimeoutError','AbortError','TIMEOUT'].includes(row.errorCode))break;
}
const directory=path.join('docs','test-runs',started.replace(/[:.]/g,'-')+'-body-position');fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify({version:fixture.version,started,base:new URL(base).origin,
 scope:'고정 가상 사례 일치이며 정확도 평가가 아님. 실제 링크는 별도 기록.',results},null,2)+'\n');
console.log(JSON.stringify({report:path.join(directory,'summary.json'),completed:results.length}));
