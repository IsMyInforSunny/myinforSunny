import type {Analysis} from './contracts';
import type {BiasAnalysisResult} from './bias-analysis';
import {expressionSummary,naturalSentences} from './domain';
import {reviewCitedSources} from './cited-sources';
import {assessWeightedClaimEvidence,type EvidenceObservation,type PublisherWeightSet} from './source-reliability';

export const ANALYSIS_SCORES_VERSION='descriptive-scores-2.0';
export type Score={
  label:string;
  value:number|null;
  status:'ready'|'partial'|'pending'|'not_applicable';
  scale:100;
  numerator:number|null;
  denominator:number|null;
  note:string;
  lowerBound?:number;
  upperBound?:number;
  unresolvedCount?:number;
};
export type AnalysisScores={version:typeof ANALYSIS_SCORES_VERSION;bias:Score;stimulation:Score;reliability:Score;attribution:Score};
export type ScoreEvidence={observations:readonly EvidenceObservation[];weightSet:PublisherWeightSet|null;};
const percent=(numerator:number,denominator:number)=>Math.round(numerator/denominator*100);
const empty=(label:string,note:string,status:Score['status']='pending'):Score=>({label,value:null,status,scale:100,numerator:null,denominator:null,note});

/** Descriptive 0–100 indices with visible denominators; no calibrated truth probabilities. */
export function buildAnalysisScores(analysis:Analysis|null,bias?:BiasAnalysisResult|null,evidence?:ScoreEvidence):AnalysisScores{
  const scores:AnalysisScores={version:ANALYSIS_SCORES_VERSION,
    bias:empty('편향 점수','검증된 기사 좌표와 비교 매체 중심의 거리(0–2)를 0–100점으로 환산합니다. 모델·같은 명제의 비교 표본이 준비되어야 산출합니다.'),
    stimulation:empty('자극 표현 점수','본문과 댓글의 전체 자연 문장 중 자극·공격 표현이 검출된 문장 비율입니다. 표현의 심각도나 사실성을 나타내지 않습니다.'),
    reliability:empty('출처 가중 근거 점수','현재 분석의 취득 원문에서 인용·시점이 확인된 주장별 뒷받침 근거의 가중 비율을 동일 비중으로 평균해 0–100점으로 표현합니다. 출처 가중치는 공개된 이용자 신뢰 인식 자료이며 사실 정확도·진실 확률이 아닙니다. 주장마다 확인된 가중치, 두 매체와 두 원본 집단이 필요합니다. 미대조 주장은 0점으로 확정하지 않습니다.'),
    attribution:empty('근거 출처 명시 점수','전체 사실 주장 중 이름 있는 근거 출처가 연결된 주장 비율입니다. 출처의 실재·정확성·주장의 참일 확률은 별도 확인이 필요합니다. 신뢰 점수와 구분하는 보조 정보입니다.'),
  };
  if(!analysis)return scores;
  if(bias?.status==='ready'&&bias.gaugePercent!==null&&Number.isFinite(bias.gaugePercent)&&bias.gaugePercent>=0&&bias.gaugePercent<=100){
    scores.bias={...scores.bias,status:'ready',value:Math.round(bias.gaugePercent),numerator:bias.magnitude,denominator:2};
  }
  const expression=expressionSummary(analysis);
  if(expression.total){
    const byId=new Map(analysis.expressions.map(e=>[e.sentenceId,e]));
    // A flagged fragment and an undetermined fragment can share one natural
    // sentence. Count that sentence once in the maximum possible flagged count.
    let possible=0;
    for(const source of analysis.sources)for(const sentence of naturalSentences(source.sentences)){
      const entries=sentence.units.map(unit=>byId.get(unit.id));
      if(entries.some(e=>!e||e.status==='flagged'||e.status==='undetermined'))possible++;
    }
    const value=percent(expression.flagged,expression.total);
    const allUnresolved=expression.flagged===0&&expression.undetermined===expression.total;
    scores.stimulation={...scores.stimulation,value:allUnresolved?null:value,status:allUnresolved?'pending':expression.undetermined?'partial':'ready',
      numerator:expression.flagged,denominator:expression.total,unresolvedCount:expression.undetermined,
      ...(expression.undetermined?{lowerBound:value,upperBound:percent(possible,expression.total),
        note:`${scores.stimulation.note} 미판정 문장 ${expression.undetermined}개를 포함해 현재 검출값부터 가능한 상한까지 표시합니다.`}:{}),
    };
  }
  const sourcing=reviewCitedSources(analysis);
  if(sourcing.summary.factualClaims){
    const namedSourceIds=new Set(sourcing.sources.filter(source=>source.signals.named).map(source=>source.id));
    const hasNamedSource=(claim:typeof sourcing.claims[number])=>claim.sourceIds.some(id=>namedSourceIds.has(id));
    const named=sourcing.claims.filter(hasNamedSource).length;
    // An unresolved pronoun may refer to a named source in earlier context.
    // Its possible contribution belongs only in the upper bound, never the count.
    const unresolved=sourcing.claims.filter(claim=>!hasNamedSource(claim)
      &&claim.unresolvedAttribution===true).length;
    const value=percent(named,sourcing.summary.factualClaims);
    scores.attribution={...scores.attribution,value,status:unresolved?'partial':'ready',numerator:named,denominator:sourcing.summary.factualClaims,
      ...(unresolved?{lowerBound:value,upperBound:percent(named+unresolved,sourcing.summary.factualClaims),unresolvedCount:unresolved,
        note:`${scores.attribution.note} 미해결 출처 귀속 ${unresolved}개는 명시 출처 건수에서 제외하고 가능한 상한에만 포함합니다.`}:{}),
    };
  }else {
    if(analysis.warnings.some(w=>w.code==='CLAIMS_UNAVAILABLE'))return scores;
    scores.attribution={...scores.attribution,status:'not_applicable',numerator:0,denominator:0};
    scores.reliability={...scores.reliability,status:'not_applicable',numerator:0,denominator:0};
    return scores;
  }
  const ids=analysis.claims.filter(c=>c.kind==='factual').map(c=>c.id);
  scores.reliability={...scores.reliability,denominator:ids.length};
  // Only a current live research adapter may supply observations. Demo and
  // pasted references cannot manufacture a verified-source score.
  if(analysis.mode==='live'&&evidence){
    const weighted=assessWeightedClaimEvidence(evidence.observations,evidence.weightSet,ids);
    const reviewed=weighted.claims.filter(c=>c.status==='weighted_evidence_available'&&c.shares!==null);
    if(reviewed.length){
      const sum=reviewed.reduce((total,c)=>total+c.shares!.supports,0);
      const remaining=ids.length-reviewed.length,value=percent(sum,ids.length);
      scores.reliability={...scores.reliability,value,status:remaining?'partial':'ready',numerator:sum,unresolvedCount:remaining,
        ...(remaining?{lowerBound:value,upperBound:percent(sum+remaining,ids.length)}:{}),
        note:`${scores.reliability.note} 대조 가능한 주장 ${reviewed.length}/${ids.length}개. ${remaining?'미대조·가중치 부족 주장은 가능한 상한에만 포함합니다.':'현재 검토된 자료 범위의 결과입니다.'}`};
    }
  }
  return scores;
}
