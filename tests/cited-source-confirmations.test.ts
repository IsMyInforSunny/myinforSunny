import {describe,it,expect} from 'vitest';
import {citedSourceConfirmations,reviewedCitedSources} from '../lib/cited-source-confirmations';
import {SOUTH_KOREA_PUBLIC_TRUST_PRIOR_2025} from '../lib/public-trust-prior';
import {buildReviewExport} from '../lib/review-export';
import {makeSources} from '../lib/domain';
import {demoAnalysis,demoVerification} from '../lib/fixtures';
import type {ResearchVerification} from '../lib/research-contract';

const literal='가상 학교 도서관은 평일 오후 여섯 시에 문을 닫는다';
function sample(){
  const a=structuredClone(demoAnalysis('supported'));a.mode='live';
  const body=`MBC 보도에 따르면 “${literal}”.`;
  a.sources=makeSources({kind:'text',body,comments:[]});const s=a.sources[0].sentences[0];
  a.claims=[{id:'c1',text:literal,kind:'factual',origin:[{sourceId:a.sources[0].id,sentenceId:s.id,start:0,end:body.length,quote:body}]}];
  const v:ResearchVerification={...structuredClone(demoVerification('supported')),mode:'live',parentAnalysisId:a.analysisId,
    references:[{id:'r',provenance:'web_fetched',url:'https://imnews.imbc.com/synthetic',text:literal,truncated:false,fetchedAt:'2026-11-01T00:00:00Z'}],
    checks:[{claimId:'c1',execution:'completed',outcome:'supported',temporalFit:'matched',relations:[{referenceId:'r',quote:literal,start:0,end:literal.length,relation:'supports',explanation:'synthetic'}],explanation:'synthetic',limitations:[]}]};
  return {a,v};
}
describe('original cited-source confirmation adapter',()=>{
  it('binds an exact literal passage to a currently fetched, explicitly named publisher',()=>{
    const {a,v}=sample();expect(citedSourceConfirmations(a,[v])).toEqual([{citedSourceId:'cite_1',url:'https://imnews.imbc.com/synthetic',provenance:'web_fetched',quoteMatched:true}]);
  });
  it('does not promote another publisher, paraphrase, invalid quote or supplied text',()=>{
    for(const variant of ['publisher','paraphrase','forged','provided','time'] as const){
      const {a,v}=sample();
      if(variant==='publisher')v.references[0].url='https://hani.co.kr/synthetic';
      if(variant==='paraphrase'){v.references[0].text='학교 도서관은 저녁 여섯 시까지 운영된다';v.checks[0].relations[0]={...v.checks[0].relations[0],quote:v.references[0].text,end:v.references[0].text.length};}
      if(variant==='forged')v.checks[0].relations[0].start=1;
      if(variant==='provided')v.references[0].provenance='provided_text';
      if(variant==='time')v.checks[0].temporalFit='unclear';
      expect(citedSourceConfirmations(a,[v])).toEqual([]);
    }
  });
  it('drops old and demo results and superseded successful checks',()=>{
    const {a,v}=sample();
    expect(citedSourceConfirmations(a,[{...v,parentAnalysisId:'old'}])).toEqual([]);
    expect(citedSourceConfirmations({...a,mode:'demo'},[v])).toEqual([]);
    const failed={...v,references:[],checks:v.checks.map(c=>({...c,execution:'failed' as const,relations:[]}))};
    expect(citedSourceConfirmations(a,[v,failed])).toEqual([]);
  });
  it('does not confirm every claim merely because they cite the same source',()=>{
    const {a,v}=sample();const other='가상 급식실은 매주 수요일 오후에 문을 닫는다';
    const body=`MBC 보도에 따르면 “${literal}” 그리고 “${other}”.`;
    a.sources=makeSources({kind:'text',body,comments:[]});const sentence=a.sources[0].sentences[0];
    a.claims=[literal,other].map((text,i)=>({id:`c${i+1}`,text,kind:'factual' as const,origin:[{sourceId:a.sources[0].id,sentenceId:sentence.id,
      start:body.indexOf(text),end:body.indexOf(text)+text.length,quote:text}]}));
    const result=reviewedCitedSources(a,[v],SOUTH_KOREA_PUBLIC_TRUST_PRIOR_2025);
    expect(result.claims.map(c=>c.originalVerified)).toEqual([true,false]);
    expect(result.summary.originalVerifiedClaims).toBe(1);
  });
  it('exports source assessment details and fetched URLs only with their respective consent',()=>{
    const {a,v}=sample(),base={analysis:a,checks:v.checks,feedback:'',includeRaw:false,includeRefs:false,verifications:[],researchResults:[v],researchStage:'completed' as const};
    const minimal=buildReviewExport(base);
    expect(minimal.sourceAssessment?.summary.originalVerifiedClaims).toBe(1);
    expect(minimal).not.toHaveProperty('citedSourceAssessment');
    expect(JSON.stringify(minimal)).not.toContain(literal);
    const raw=buildReviewExport({...base,includeRaw:true});
    expect(raw.citedSourceAssessment?.sources[0].originalCheck.url).toBeNull();
    expect(JSON.stringify(raw)).not.toContain('https://imnews.imbc.com/synthetic');
    const full=buildReviewExport({...base,includeRaw:true,includeRefs:true});
    expect(full.citedSourceAssessment?.sources[0].originalCheck.url).toBe('https://imnews.imbc.com/synthetic');
  });
});
