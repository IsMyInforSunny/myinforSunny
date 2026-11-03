import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {diagnoseActivation,diagnoseBiasArtifact,main} from '../scripts/check-activation-readiness.mjs';
import {capabilities} from '../lib/server/config';
import {dailyLimits} from '../lib/server/limits';
import {firecrawlBudget,firecrawlReady} from '../lib/server/firecrawl';
import {parseBiasModel} from '../lib/bias-model';

const groq={AI_PROVIDER:'groq',GROQ_API_KEY:'synthetic-not-a-real-key',GROQ_MODEL:'openai/gpt-oss-120b',
  GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',GROQ_CONSOLE_LIMITS_CONFIRMED:'true',
  GROQ_CONSOLE_TPD:'150000',GROQ_CONSOLE_RPD:'1000',ENABLE_LIVE_ANALYSIS:'true'};
const search={ENABLE_NEWS_SEARCH:'true',NEWS_TERMS_APPROVED:'true',ALLOWED_RETRIEVAL_HOSTS:'news.example,other.example'};
const firecrawl={...search,NEWS_PROVIDER:'firecrawl',FIRECRAWL_API_KEY:'synthetic-crawl-key',FIRECRAWL_TERMS_APPROVED:'true',
  FIRECRAWL_SOURCE_TERMS_APPROVED:'true',FIRECRAWL_FREE_PLAN_CONFIRMED:'true',FIRECRAWL_CONSOLE_LIMITS_CONFIRMED:'true',
  FIRECRAWL_CONSOLE_CREDITS:'1000',FIRECRAWL_CREDIT_BUDGET:'900',FIRECRAWL_SEARCH_CREDIT_COST:'2',FIRECRAWL_SCRAPE_CREDIT_COST:'1'};
const directories:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});

describe('operator-only activation readiness',()=>{
  it('distinguishes absent confirmation from explicit false and never treats local DB config as a runtime test',()=>{
    const unset=diagnoseActivation({},{}),disabled=diagnoseActivation({ENABLE_LIVE_ANALYSIS:'false'},{dbBindingConfigured:true});
    expect(unset.groq.conditions.GROQ_API_KEY_PRESENT).toBe(false);
    expect(unset.groq.conditions.ENABLE_LIVE_ANALYSIS).toBeNull();
    expect(unset.groq.conditions.DB_BINDING_CONFIGURED).toBeNull();
    expect(disabled.groq.conditions.ENABLE_LIVE_ANALYSIS).toBe(false);
    expect(disabled.groq.conditions.DB_BINDING_CONFIGURED).toBe(true);
    expect(disabled.runtimeVerification.DB_CONNECTION_VERIFIED).toBeNull();
    expect(diagnoseActivation({}, {configReadable:false}).groq.conditions.GROQ_API_KEY_PRESENT).toBeNull();
  });
  it('agrees with Groq runtime conditions and computes only console-confirmed effective limits',()=>{
    for(const config of [groq,{...groq,GROQ_FREE_PLAN_CONFIRMED:'false'},{...groq,GROQ_API_KEY:''},{...groq,GROQ_MODEL:'unsupported'},{...groq,GROQ_CONSOLE_TPD:''}]){
      const report=diagnoseActivation(config,{dbBindingConfigured:true});
      expect(report.groq.configuredReady).toBe(capabilities({...config,DB:{} as D1Database}).live);
    }
    const report=diagnoseActivation(groq,{dbBindingConfigured:true}),limits=dailyLimits(groq);
    expect(report.groq.verifiedConfiguredLimits).toMatchObject({effectiveTokensPerDay:limits.tokens,effectiveRequestsPerDay:limits.requests});
    expect(report.groq.configuredReady).toBe(true);
    expect(report.groq.runtimeReadinessVerified).toBeNull();
    expect(diagnoseActivation({...groq,GROQ_CONSOLE_LIMITS_CONFIRMED:'false'}).groq.verifiedConfiguredLimits.consoleTokensPerDay).toBeNull();
    expect(diagnoseActivation({...groq,GROQ_CONSOLE_TPD:'1000'}).groq.oneAnalysisFitsConfiguredBudget).toBe(false);
  });
  it('uses confirmed console minute limits without claiming project override verification',()=>{
    const confirmed={...groq,GROQ_CONSOLE_TPM:'6600',GROQ_CONSOLE_RPM:'2',DAILY_TOKEN_BUDGET:'1000000'};
    const report=diagnoseActivation(confirmed,{dbBindingConfigured:true});
    expect(report.groq.configuredReady).toBe(true);
    expect(report.groq.verifiedConfiguredLimits).toMatchObject({consoleTokensPerMinute:6600,consoleRequestsPerMinute:2,effectiveTokensPerDay:120000});
    expect(report.groq.minuteProtection).toMatchObject({effectiveRollingMinuteTokens:6600,effectiveGlobalRequestsPerMinute:2,legacyTokenSafeguardUsed:false});
    expect(report.groq.minuteProtection).toMatchObject({consoleTokensPerMinuteConfirmed:true,consoleRequestsPerMinuteConfirmed:true,projectOverrideVerified:null});
    expect(diagnoseActivation({...confirmed,GROQ_CONSOLE_TPM:'6499'},{dbBindingConfigured:true}).groq.configuredReady).toBe(false);
    expect(diagnoseActivation(groq,{dbBindingConfigured:true}).groq).toMatchObject({configuredReady:true,minuteProtection:{effectiveRollingMinuteTokens:7000,effectiveGlobalRequestsPerMinute:null,legacyTokenSafeguardUsed:true}});
    const unknown=diagnoseActivation({...confirmed,GROQ_CONSOLE_LIMITS_CONFIRMED:'false'});
    expect(unknown.groq.verifiedConfiguredLimits.consoleTokensPerMinute).toBeNull();
    expect(unknown.groq.verifiedConfiguredLimits.consoleRequestsPerMinute).toBeNull();
  });
  it('resolves an explicit Groq reference from the config directory without importing other external settings',async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'inforcast-reference-'));directories.push(directory);
    const configDirectory=path.join(directory,'config');mkdirSync(configDirectory);
    const secret='gsk_SYNTHETIC_REFERENCE_KEY_DO_NOT_PRINT_123';
    writeFileSync(path.join(directory,'key.vars'),`GROQ_API_KEY="${secret}"\nENABLE_LIVE_ANALYSIS=true\nFIRECRAWL_API_KEY=${secret}\n`);
    const configPath=path.join(configDirectory,'fixture.vars');
    writeFileSync(configPath,'INFORCAST_GROQ_KEY_FILE=../key.vars\nENABLE_LIVE_ANALYSIS=false\n');
    const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('network forbidden'));
    const before={...process.env};
    const report=await main(['--config',configPath],directory);
    if('argumentError' in report)throw Error('Fixture arguments rejected');
    expect(report.groq.conditions.GROQ_API_KEY_PRESENT).toBe(true);
    expect(report.groq.conditions.ENABLE_LIVE_ANALYSIS).toBe(false);
    expect(report.firecrawl.conditions.FIRECRAWL_API_KEY_PRESENT).toBe(false);
    expect(report.groq.conditions.DB_BINDING_CONFIGURED).toBeNull();
    expect(report.runtimeVerification.GROQ_REQUEST_SUCCESS_VERIFIED).toBeNull();
    expect(report.runtimeVerification.DB_CONNECTION_VERIFIED).toBeNull();
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(JSON.stringify(report)).not.toContain(directory);
    expect(JSON.stringify(report)).not.toContain('key.vars');
    expect(process.env).toEqual(before);expect(fetch).not.toHaveBeenCalled();
  });
  it('does not report a key for missing, wrong-name or invalid referenced credentials',async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'inforcast-invalid-reference-'));directories.push(directory);
    const configPath=path.join(directory,'fixture.vars');
    writeFileSync(configPath,'INFORCAST_GROQ_KEY_FILE=key.vars\n');
    for(const contents of [null,'GROQ_API_KEY=short','OTHER_API_KEY=gsk_SYNTHETIC_OTHER_KEY_1234567890','GROQ_API_KEY=gsk_invalid!characters_1234567890']){
      if(contents!==null)writeFileSync(path.join(directory,'key.vars'),contents);
      const report=await main(['--config',configPath],directory);
      if('argumentError' in report)throw Error('Fixture arguments rejected');
      expect(report.configurationReadSucceeded).toBe(true);
      expect(report.groq.conditions.GROQ_API_KEY_PRESENT).toBe(false);
      expect(report.groq.configuredReady).toBe(false);
      expect(JSON.stringify(report)).not.toContain(directory);
      expect(JSON.stringify(report)).not.toContain('key.vars');
    }
  });
  it('separates GDELT from Firecrawl and preserves the actual bounded credit formula',()=>{
    const gdelt=diagnoseActivation({...groq,...search},{dbBindingConfigured:true});
    expect(gdelt.gdelt.configuredReady).toBe(true);expect(gdelt.firecrawl.configuredReady).toBe(false);
    const combined={...groq,...firecrawl},report=diagnoseActivation(combined,{dbBindingConfigured:true}),budget=firecrawlBudget(combined);
    expect(report.firecrawl.configuredReady).toBe(firecrawlReady({...combined,DB:{} as D1Database}));
    expect(report.firecrawl.verifiedConfiguredLimits).toEqual({consoleCredits:1000,effectiveLifetimeCredits:budget.limit,searchCreditsPerCall:budget.search,scrapeCreditsPerCall:budget.scrape});
    expect(report.research.configuredReady).toBe(true);
    expect(report.firecrawl.accountCreditsRemainingVerified).toBeNull();
    expect(diagnoseActivation({...combined,FIRECRAWL_SEARCH_CREDIT_COST:'1'},{dbBindingConfigured:true}).firecrawl.configuredReady).toBe(false);
  });
  it('rejects wildcard, URL, local, IP and credential allowlist entries without returning their values',()=>{
    for(const host of ['*.example.com','https://news.example','news.example/path','127.0.0.1','localhost','private.local','user:secret@news.example','news.example:8443']){
      const report=diagnoseActivation({...groq,...firecrawl,ALLOWED_RETRIEVAL_HOSTS:host},{dbBindingConfigured:true});
      expect(report.firecrawl.conditions.EXACT_HOST_ALLOWLIST_HAS_VALID_ENTRY).toBe(false);
      expect(report.research.configuredReady).toBe(false);
      expect(JSON.stringify(report)).not.toContain(host);
    }
  });
  it('distinguishes a known null model, unknown unreadable artifact and research-only or invalid declared release',async()=>{
    expect((await diagnoseBiasArtifact(null,parseBiasModel)).conditions.MODEL_ARTIFACT_PRESENT).toBe(false);
    expect((await diagnoseBiasArtifact(undefined,parseBiasModel)).conditions.MODEL_ARTIFACT_PRESENT).toBeNull();
    const research=await diagnoseBiasArtifact({schemaVersion:'publisher-coordinate-svm-1',status:'research_only'},parseBiasModel);
    expect(research.researchOnly).toBe(true);expect(research.configuredReady).toBe(false);
    const invalid=await diagnoseBiasArtifact({schemaVersion:'publisher-coordinate-svm-1',synthetic:false,dataKind:'real',status:'validated'},parseBiasModel);
    expect(invalid.conditions.MODEL_DECLARED_VALIDATED).toBe(true);expect(invalid.conditions.MODEL_RELEASE_SCHEMA_VALIDATED).toBe(false);
  });
  it('reads explicit fixture files without network, env mutation, raw values or account identifiers in output',async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'inforcast-readiness-'));directories.push(directory);
    const secret='SENTINEL_RAW_VALUE_MUST_NEVER_BE_PRINTED';
    const configPath=path.join(directory,'fixture.vars'),bindingsPath=path.join(directory,'fixture.jsonc'),modelPath=path.join(directory,'model.json');
    writeFileSync(configPath,`GROQ_API_KEY="${secret}"\nGROQ_MODEL=openai/gpt-oss-120b\nENABLE_LIVE_ANALYSIS=false\nUNRELATED_SETTING=${secret}\nALLOWED_RETRIEVAL_HOSTS=${secret}.example\n`);
    writeFileSync(bindingsPath,`{ // fixture metadata only\n "d1_databases": [{"binding":"DB","database_id":"${secret}"}],\n}`);
    writeFileSync(modelPath,'null');
    const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('network forbidden'));
    const before=process.env.GROQ_API_KEY;
    const report=await main(['--config',configPath,'--bindings',bindingsPath,'--model',modelPath],directory);
    if('argumentError' in report)throw new Error('Fixture diagnostic arguments were rejected');
    expect(report.configurationReadSucceeded).toBe(true);
    expect(report.groq.conditions.GROQ_API_KEY_PRESENT).toBe(true);
    expect(report.groq.conditions.DB_BINDING_CONFIGURED).toBe(true);
    expect(report.bias.conditions.MODEL_ARTIFACT_PRESENT).toBe(false);
    expect(report.bias.artifactReadSucceeded).toBe(true);
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(JSON.stringify(report)).not.toContain(directory);
    expect(process.env.GROQ_API_KEY).toBe(before);expect(fetch).not.toHaveBeenCalled();
    expect(await main(['--config'],directory)).toMatchObject({argumentError:true});
  });
});
