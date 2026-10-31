// Built-Worker integration check. All outbound traffic is disabled except a mocked Groq reply.
import {Miniflare} from 'miniflare';
import {MockAgent} from 'undici';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist/server');
const modules=readdirSync(root,{recursive:true}).filter(f=>f.endsWith('.js')).map(f=>({type:'ESModule',path:path.join(root,f)}));
const body='학교 정원이 더 넓으면 좋겠다.';
const raw={clearSentenceIds:[],topics:[{id:'garden',label:'정원 공간',description:'학교 정원',evidence:[{sentenceId:'body_s0',quote:body}]}],topicAssignments:[],stances:[],expressions:[{sentenceId:'body_s0',status:'clear',criteria:[],severity:'none',context:'direct',explanation:'명확한 검토 표현 없음',evidence:[]}],claims:[{id:'opinion',text:body,kind:'opinion',origin:[{sentenceId:'body_s0',quote:body}],targetTime:''}],perspectiveQuestions:[],counterArguments:[{claimId:'not_applicable',kind:'not_applicable',text:'해당 없음',reasoning:'해당 없음',evidenceNeeded:'해당 없음',basis:[{sentenceId:'body_s0',quote:'원문'}]}],searchSuggestions:[],claimsMayBeOmitted:true};
const agent=new MockAgent();agent.disableNetConnect();
agent.get('https://api.groq.com').intercept({path:'/openai/v1/chat/completions',method:'POST'}).reply(200,JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}],usage:{total_tokens:500}}),{headers:{'content-type':'application/json'}});
const mf=new Miniflare({modules:[modules.find(m=>m.path===path.join(root,'index.js')),...modules.filter(m=>m.path!==path.join(root,'index.js'))],modulesRoot:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],assets:{directory:'dist/client',binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},d1Databases:['DB'],fetchMock:agent,bindings:{AI_PROVIDER:'groq',ENABLE_LIVE_ANALYSIS:'true',GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_TPD:'200000',GROQ_CONSOLE_RPD:'1000',GROQ_API_KEY:'synthetic-not-a-real-key',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',FREE_ONLY:'true'}});
try{
 const db=await mf.getD1Database('DB');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const statement of readFileSync('drizzle/'+file,'utf8').replace(/^\uFEFF/,'').split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();
 for(const route of ['/','/analyze','/methodology','/api/health']){
  const response=await mf.dispatchFetch('http://localhost'+route);await response.text();if(response.status!==200)throw Error(`Route ${route}: ${response.status}`);
 }
 const started=performance.now();
 const response=await mf.dispatchFetch('http://localhost/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'text',body,comments:[],transmissionConsent:true})});
 const result=await response.json();
 if(response.status!==200||result.mode!=='live'||result.topics?.[0]?.label!=='정원 공간')throw Error(`Built live route failed: ${JSON.stringify(result)}`);
 const row=await db.prepare('SELECT consumed,active FROM request_budget').first();
 if(row?.consumed!==500||row?.active!==0)throw Error('Budget settlement failed');
 agent.assertNoPendingInterceptors();
 console.log(JSON.stringify({check:'built Worker + tokenizer + actual D1 + mocked Groq',status:'passed',durationMs:Math.round(performance.now()-started),realProviderCalls:0}));
}finally{await mf.dispose();await agent.close();}
