import {describe,expect,it} from 'vitest';
import {dailyLimits,minuteLimits,MODEL_REQUEST_RESERVATION,MAX_MODEL_TOKENS_PER_MINUTE} from '../lib/server/limits';
import {capabilities,type RuntimeConfig} from '../lib/server/config';

const config:RuntimeConfig={AI_PROVIDER:'groq',GROQ_API_KEY:'synthetic-only',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',
  ENABLE_LIVE_ANALYSIS:'true',GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_TPD:'200000',GROQ_CONSOLE_RPD:'1000',DB:{} as D1Database};

describe('verified project minute limits',()=>{
  it('preserves legacy protection when the historically confirmed account has no minute values',()=>{
    expect(minuteLimits(config)).toMatchObject({tokens:7000,requests:null,tokensVerified:false,requestsVerified:false,compatible:true});
    expect(capabilities(config).live).toBe(true);
    expect(minuteLimits({...config,GROQ_CONSOLE_TPM:'',GROQ_CONSOLE_RPM:''}).compatible).toBe(true);
  });
  it('uses stricter verified minute limits without increasing fixed reservation, rolling window or daily budget',()=>{
    expect(minuteLimits({...config,GROQ_CONSOLE_TPM:'6600',GROQ_CONSOLE_RPM:'2'})).toMatchObject({tokens:6600,requests:2,compatible:true,tokensVerified:true,requestsVerified:true});
    expect(minuteLimits({...config,GROQ_CONSOLE_TPM:'8000',GROQ_CONSOLE_RPM:'30'})).toMatchObject({tokens:7000,requests:30});
    expect(MODEL_REQUEST_RESERVATION).toBe(6500);expect(MAX_MODEL_TOKENS_PER_MINUTE).toBe(7000);
    expect(dailyLimits({...config,DAILY_TOKEN_BUDGET:'1000000'}).tokens).toBe(120000);
    expect(dailyLimits({...config,DAILY_TOKEN_BUDGET:'1000'}).tokens).toBe(1000);
  });
  it('fails readiness for a verified project that cannot fit one reservation or has no request capacity',()=>{
    for(const patch of [{GROQ_CONSOLE_TPM:'6499'},{GROQ_CONSOLE_RPM:'0'},{GROQ_CONSOLE_TPM:'not-a-number'},{GROQ_CONSOLE_RPM:'-1'}]){
      expect(minuteLimits({...config,...patch}).compatible).toBe(false);
      expect(capabilities({...config,...patch})).toMatchObject({live:false,reason:expect.stringContaining('분당 한도')});
    }
    expect(minuteLimits({...config,GROQ_CONSOLE_TPM:'6500'}).compatible).toBe(true);
  });
  it('does not turn organization-only or unconfirmed numbers into verified project limits or activation',()=>{
    const unconfirmed={...config,GROQ_CONSOLE_LIMITS_CONFIRMED:'false',GROQ_CONSOLE_TPM:'8000',GROQ_CONSOLE_RPM:'30'};
    expect(minuteLimits(unconfirmed)).toMatchObject({tokens:7000,requests:null,tokensVerified:false,requestsVerified:false});
    expect(capabilities(unconfirmed).live).toBe(false);
  });
});
