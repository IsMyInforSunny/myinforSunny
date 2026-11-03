import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const flag=(config,key)=>!own(config,key)?null:config[key]==='true'?true:config[key]==='false'?false:null;
const present=(config,key)=>!own(config,key)?false:typeof config[key]==='string'&&config[key].trim().length>0;
const integer=value=>typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Math.floor(Number(value)):null;
const positiveInteger=value=>typeof value==='string'&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const all=values=>values.every(value=>value===true);
const section=conditions=>({conditions,missingConditions:Object.keys(conditions).filter(key=>conditions[key]===false),
  unknownConditions:Object.keys(conditions).filter(key=>conditions[key]===null),configuredReady:all(Object.values(conditions))});

function allowlist(config){
  const entries=(config.ALLOWED_RETRIEVAL_HOSTS??'').split(',').map(host=>host.trim().toLowerCase()).filter(Boolean);
  const valid=host=>{
    if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host)
      ||host.endsWith('.local')||host.endsWith('.localhost')||/^[\d.]+$/.test(host))return false;
    try{const url=new URL(`https://${host}/`);return url.hostname===host&&!url.username&&!url.password&&!url.port;}catch{return false;}
  };
  return {configured:entries.length>0,allValid:entries.length>0&&entries.every(valid),anyValid:entries.some(valid)};
}

/** Pure, redacted configuration diagnostic. No network, runtime calls, or mutations. */
export function diagnoseActivation(config={},options={}){
  const available=options.configReadable!==false;
  const condition=value=>available?value:null;
  const hosts=allowlist(config),db=options.dbBindingConfigured??null;
  const provider=config.AI_PROVIDER??'groq',searchProvider=config.NEWS_PROVIDER??'gdelt';
  const tokenLimit=integer(config.GROQ_CONSOLE_TPD),requestLimit=integer(config.GROQ_CONSOLE_RPD);
  const limitsConfirmed=flag(config,'GROQ_CONSOLE_LIMITS_CONFIRMED');
  const limitsVerified=available&&limitsConfirmed===true&&tokenLimit!==null&&requestLimit!==null;
  const requestedTokens=integer(config.DAILY_TOKEN_BUDGET)??120000;
  const tokens=limitsVerified?Math.min(120000,requestedTokens,Math.floor(tokenLimit*.8)):null;
  const requests=limitsVerified?Math.min(500,Math.floor(requestLimit*.8)):null;
  const minuteTokenConfigured=!!config.GROQ_CONSOLE_TPM?.trim(),minuteRequestConfigured=!!config.GROQ_CONSOLE_RPM?.trim();
  const minuteInteger=value=>typeof value==='string'&&/^\d+$/.test(value.trim())&&Number.isSafeInteger(Number(value))?Number(value):null;
  const minuteTokens=minuteInteger(config.GROQ_CONSOLE_TPM),minuteRequests=minuteInteger(config.GROQ_CONSOLE_RPM);
  const minuteTokensVerified=available&&limitsConfirmed===true&&minuteTokens!==null;
  const minuteRequestsVerified=available&&limitsConfirmed===true&&minuteRequests!==null;
  const effectiveMinuteTokens=minuteTokensVerified?Math.min(7000,minuteTokens):7000;
  const minuteCompatible=limitsConfirmed!==true||((!minuteTokenConfigured||minuteTokens!==null)&&(!minuteRequestConfigured||minuteRequests!==null)
    &&effectiveMinuteTokens>=6500&&(!minuteRequestsVerified||minuteRequests>=1));
  const groq={...section({
    GROQ_PROVIDER_SELECTED:condition(provider==='groq'),GROQ_API_KEY_PRESENT:condition(present(config,'GROQ_API_KEY')||options.groqReferencedKeyPresent===true),
    GROQ_SUPPORTED_MODEL_CONFIGURED:condition(config.GROQ_MODEL==='openai/gpt-oss-120b'),
    GROQ_ELIGIBILITY_CONFIRMED:condition(flag(config,'GROQ_ELIGIBILITY_CONFIRMED')),
    GROQ_FREE_PLAN_CONFIRMED:condition(flag(config,'GROQ_FREE_PLAN_CONFIRMED')),
    GROQ_CONSOLE_LIMITS_CONFIRMED:condition(limitsConfirmed),GROQ_CONSOLE_TPD_VALID:condition(tokenLimit!==null),
    GROQ_CONSOLE_RPD_VALID:condition(requestLimit!==null),ENABLE_LIVE_ANALYSIS:condition(flag(config,'ENABLE_LIVE_ANALYSIS')),
    GROQ_CONFIGURED_MINUTE_LIMITS_COMPATIBLE:condition(minuteCompatible),
    DB_BINDING_CONFIGURED:db,
  }),verifiedConfiguredLimits:{consoleTokensPerDay:limitsVerified?tokenLimit:null,consoleRequestsPerDay:limitsVerified?requestLimit:null,
    effectiveTokensPerDay:tokens,effectiveRequestsPerDay:requests,
    consoleTokensPerMinute:minuteTokensVerified?minuteTokens:null,consoleRequestsPerMinute:minuteRequestsVerified?minuteRequests:null},
    minuteProtection:{effectiveRollingMinuteTokens:available?effectiveMinuteTokens:null,
      effectiveGlobalRequestsPerMinute:minuteRequestsVerified?minuteRequests:null,
      consoleTokensPerMinuteConfirmed:minuteTokensVerified,consoleRequestsPerMinuteConfirmed:minuteRequestsVerified,
      projectOverrideVerified:null,
      legacyTokenSafeguardUsed:available&&!minuteTokensVerified},
    oneAnalysisFitsConfiguredBudget:limitsVerified?tokens>=6500&&requests>=1&&minuteCompatible:null,runtimeReadinessVerified:null};
  const common={ENABLE_NEWS_SEARCH:condition(flag(config,'ENABLE_NEWS_SEARCH')),NEWS_TERMS_APPROVED:condition(flag(config,'NEWS_TERMS_APPROVED')),DB_BINDING_CONFIGURED:db};
  const gdelt=section({...common,GDELT_PROVIDER_SELECTED:condition(searchProvider==='gdelt')});
  const allowance=positiveInteger(config.FIRECRAWL_CONSOLE_CREDITS),searchCost=positiveInteger(config.FIRECRAWL_SEARCH_CREDIT_COST),scrapeCost=positiveInteger(config.FIRECRAWL_SCRAPE_CREDIT_COST),budget=positiveInteger(config.FIRECRAWL_CREDIT_BUDGET);
  const firecrawlLimitsVerified=available&&flag(config,'FIRECRAWL_CONSOLE_LIMITS_CONFIRMED')===true&&allowance!==null&&searchCost!==null&&searchCost>=2&&scrapeCost!==null&&scrapeCost>=1&&budget!==null;
  const effectiveCredits=firecrawlLimitsVerified?Math.min(budget,Math.floor(allowance*.8),800):null;
  const firecrawl={...section({...common,FIRECRAWL_PROVIDER_SELECTED:condition(searchProvider==='firecrawl'),
    FIRECRAWL_API_KEY_PRESENT:condition(present(config,'FIRECRAWL_API_KEY')),
    FIRECRAWL_TERMS_APPROVED:condition(flag(config,'FIRECRAWL_TERMS_APPROVED')),
    FIRECRAWL_SOURCE_TERMS_APPROVED:condition(flag(config,'FIRECRAWL_SOURCE_TERMS_APPROVED')),
    FIRECRAWL_FREE_PLAN_CONFIRMED:condition(flag(config,'FIRECRAWL_FREE_PLAN_CONFIRMED')),
    FIRECRAWL_CONSOLE_LIMITS_CONFIRMED:condition(flag(config,'FIRECRAWL_CONSOLE_LIMITS_CONFIRMED')),
    FIRECRAWL_CONSOLE_CREDITS_VALID:condition(allowance!==null),FIRECRAWL_SEARCH_CREDIT_COST_VALID:condition(searchCost!==null&&searchCost>=2),
    FIRECRAWL_SCRAPE_CREDIT_COST_VALID:condition(scrapeCost!==null&&scrapeCost>=1),FIRECRAWL_CREDIT_BUDGET_VALID:condition(budget!==null),
    EXACT_HOST_ALLOWLIST_HAS_VALID_ENTRY:condition(hosts.anyValid),
  }),verifiedConfiguredLimits:{consoleCredits:firecrawlLimitsVerified?allowance:null,effectiveLifetimeCredits:effectiveCredits,
    searchCreditsPerCall:firecrawlLimitsVerified?searchCost:null,scrapeCreditsPerCall:firecrawlLimitsVerified?scrapeCost:null},
    oneSearchAndTwoScrapesFitConfiguredBudget:firecrawlLimitsVerified?effectiveCredits>=searchCost+2*scrapeCost:null,
    accountCreditsRemainingVerified:null};
  const selectedSearch=searchProvider==='gdelt'?gdelt:searchProvider==='firecrawl'?firecrawl:null;
  const research={...section({GROQ_CONFIGURATION_READY:available?groq.configuredReady:null,
    SEARCH_PROVIDER_SUPPORTED:condition(!!selectedSearch),SELECTED_SEARCH_CONFIGURATION_READY:available&&selectedSearch?selectedSearch.configuredReady:available?false:null,
    EXACT_HOST_ALLOWLIST_CONFIGURED:condition(hosts.configured),EXACT_HOST_ALLOWLIST_ALL_ENTRIES_VALID:condition(hosts.allValid)}),
    runtimeReadinessVerified:null};
  return {schemaVersion:'activation-readiness-1',configurationReadSucceeded:available,
    scope:'local_configuration_only',groq,gdelt,firecrawl,research,
    runtimeVerification:{DB_CONNECTION_VERIFIED:null,DB_MIGRATIONS_VERIFIED:null,GROQ_REQUEST_SUCCESS_VERIFIED:null,
      GROQ_CURRENT_ACCOUNT_REMAINING_QUOTA_VERIFIED:null,SEARCH_REQUEST_SUCCESS_VERIFIED:null,SOURCE_TERMS_SCOPE_VERIFIED:null},
    siteSafetyLimits:{modelReservationTokens:6500,modelRollingMinuteTokens:7000,modelConcurrency:1,
      searchRequestsPerMinute:3,searchRequestsPerHour:20,searchRequestsPerDay:200,articleFetchesPerQuery:2},
  };
}

function readText(filename,limit=262144){
  try{const text=readFileSync(filename,'utf8');return text.length<=limit?{readable:true,text}:{readable:false};}catch{return {readable:false};}
}
/** Explicit local reference only; return presence, never a key, path or other external setting. */
function referencedGroqKeyPresent(config,configPath){
  if(!present(config,'INFORCAST_GROQ_KEY_FILE'))return false;
  const file=readText(path.resolve(path.dirname(configPath),config.INFORCAST_GROQ_KEY_FILE));
  if(!file.readable)return false;
  try{return /^gsk_[A-Za-z0-9_-]{20,}$/.test(parseEnv(file.text).GROQ_API_KEY??'');}catch{return false;}
}
function readJson(filename){
  const file=readText(filename,8_000_000);if(!file.readable)return {readable:false};
  try{return {readable:true,value:JSON.parse(file.text)};}catch{}
  try{const parsed=ts.parseConfigFileTextToJson('diagnostic.json',file.text);return parsed.error?{readable:false}:{readable:true,value:parsed.config};}catch{return {readable:false};}
}
export async function diagnoseBiasArtifact(artifact,parseModel){
  const exists=artifact===undefined?null:artifact!==null;
  const known=predicate=>exists===null?null:exists&&predicate;
  const expectedSchema=known(artifact?.schemaVersion==='publisher-coordinate-svm-1');
  let validated=null;
  if(exists===false)validated=false;
  else if(exists===true&&typeof parseModel==='function'){try{validated=!!parseModel(artifact);}catch{validated=false;}}
  const conditions={MODEL_ARTIFACT_PRESENT:exists,EXPECTED_RELEASE_SCHEMA:expectedSchema,
    MODEL_DECLARED_VALIDATED:known(artifact?.status==='validated'),MODEL_DECLARED_REAL:known(artifact?.synthetic===false&&artifact?.dataKind==='real'),
    MODEL_RELEASE_SCHEMA_VALIDATED:validated};
  return {...section(conditions),researchOnly:known(artifact?.status==='research_only'),
    validationRuntimeAvailable:typeof parseModel==='function',
    evaluationCounts:validated?{publishers:artifact.classifierEvidence.evaluation.metrics.length,
      trainingSourceGroups:artifact.classifierEvidence.evaluation.trainingSourceGroupIds.length,
      evaluationSourceGroups:artifact.classifierEvidence.evaluation.evaluationSourceGroupIds.length,
      humanReviewedSamples:artifact.validation.humanAxisReview.sampleCount}:null};
}

export async function main(args=process.argv.slice(2),cwd=process.cwd()){
  const paths={config:path.join(cwd,'.dev.vars'),bindings:path.join(cwd,'wrangler.local.jsonc'),model:path.join(cwd,'lib/data/bias-model.json')};
  for(let index=0;index<args.length;index++){
    const name={'--config':'config','--bindings':'bindings','--model':'model'}[args[index]];
    if(!name||!args[index+1]||args[index+1].startsWith('--'))return {schemaVersion:'activation-readiness-1',argumentError:true};
    paths[name]=path.resolve(cwd,args[++index]);
  }
  const env=readText(paths.config);let config={};let configReadable=env.readable;
  if(configReadable){try{config=parseEnv(env.text);}catch{configReadable=false;}}
  const bindings=readJson(paths.bindings);
  const dbBindingConfigured=bindings.readable?Array.isArray(bindings.value?.d1_databases)
    &&bindings.value.d1_databases.some(binding=>binding?.binding==='DB'&&typeof binding.database_id==='string'&&!!binding.database_id.trim()):null;
  const groqReferencedKeyPresent=configReadable&&!present(config,'GROQ_API_KEY')&&referencedGroqKeyPresent(config,paths.config);
  const report=diagnoseActivation(config,{configReadable,dbBindingConfigured,groqReferencedKeyPresent});
  const artifact=readJson(paths.model);let parseModel;
  try{({parseBiasModel:parseModel}=await import('../lib/bias-model.ts'));}catch{}
  const bias=await diagnoseBiasArtifact(artifact.readable?artifact.value:undefined,parseModel);
  return {...report,bias:{...bias,artifactReadSucceeded:artifact.readable}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await main(),null,2));}
  catch{console.log(JSON.stringify({schemaVersion:'activation-readiness-1',diagnosticFailed:true}));process.exitCode=1;}
}
