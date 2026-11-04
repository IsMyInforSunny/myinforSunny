import {describe,expect,it} from 'vitest';
import {biasCoordinatesFromResearch} from '../lib/bias-model-adapter';
import {demoAnalysis,demoVerification} from '../lib/fixtures';
import type {Analysis,Reference} from '../lib/contracts';
import type {ResearchVerification} from '../lib/research-contract';
import {compactBiasPrediction,type PortableBiasModel} from '../lib/bias-model';
import {analyzeBiasCoordinate,type BiasOrientationSet} from '../lib/bias-analysis';

// Infrastructure fixture only. No real publisher, article, training, or political score.
const group='synthetic subject';
const evidence={axisId:'synthetic-axis',coordinateSpace:'synthetic-space',modelId:'synthetic-model',modelVersion:'fixture-v1',task:'publisher-identity-coordinate',
  trainingDataId:'synthetic-train',evaluationDataId:'synthetic-heldout',evaluation:{split:'held_out_articles' as const,heldOutUnit:'original_source_group' as const,
    groupSplitId:'synthetic-split',trainingPublisherIds:['left.test','right.test'],evaluationPublisherIds:['left.test','right.test'],
    trainingSourceGroupIds:['train-group'],evaluationSourceGroupIds:['heldout-group'],metrics:['left.test','right.test'].map(publisherId=>({publisherId,sampleCount:3,coordinateMae:0.1,publisherAccuracy:0.8}))}};
const model:PortableBiasModel={schemaVersion:'publisher-coordinate-svm-1',synthetic:false,dataKind:'real',status:'validated',comparisonGroup:group,lineage:[],
  classifierEvidence:evidence,vectorizer:{analyzer:'char',ngramRange:[2,4],lowercase:false,whitespace:'collapse',norm:'l2',sublinearTf:true,vocabulary:{'가나':0},idf:[1]},
  projection:{coefficients:[1],offset:0,scale:2},validation:{heldoutAnchorSeparation:true,humanAxisReview:{status:'approved',reviewedBy:'synthetic',evidence:'fixture only',reviewedModelVersion:'fixture-v1',reviewers:['fixture-a','fixture-b'],sampleCount:40,interReviewerAgreement:0.8}}};
const orientations:BiasOrientationSet={axisId:evidence.axisId,version:'fixture',source:'fixture',note:'fixture',profiles:[{publisherId:'left.test',orientation:'left'},{publisherId:'right.test',orientation:'right'}]};
function analysis():Analysis{
  const a=structuredClone(demoAnalysis('supported'));a.mode='live';a.proposition=group;
  a.sources[0].text='가나다라';a.claims[0].text=group;return a;
}
function result(a:Analysis):ResearchVerification{
  const v:ResearchVerification=structuredClone(demoVerification('supported'));
  const text='가나: 가상 기사 근거입니다.';
  const ref:Reference={id:'reference',provenance:'web_fetched',url:'https://left.test/article',text,truncated:false,
    publishedAt:'2026-01-01T00:00:00Z',fetchedAt:'2026-01-02T00:00:00Z',contentDigest:'synthetic-digest',retrievedTruncated:false,retrievedTextLength:text.length,fullTextLength:text.length,
    biasPrediction:compactBiasPrediction(model,-0.5)!};
  v.mode='live';v.parentAnalysisId=a.analysisId;v.references=[ref];
  v.checks=[{claimId:a.claims[0].id,outcome:'supported',execution:'completed',temporalFit:'matched',explanation:'fixture',limitations:[],relations:[{referenceId:ref.id,quote:text,start:0,end:text.length,relation:'supports',explanation:'fixture'}]}];
  return v;
}
const rows=(a:Analysis,results:ResearchVerification[])=>biasCoordinatesFromResearch(a,results,model,orientations).filter(r=>r.articleId!==a.analysisId);

describe('current research bias coordinate adapter',()=>{
  it('collects six distinct articles for one claim within the latest signed sampling plan',()=>{
    const a=analysis();
    const bundles=Array.from({length:3},(_,index)=>{
      const v=result(a);v.researchPlanId='synthetic-plan-1';v.createdAt=`2026-02-01T00:00:0${index}Z`;
      v.references=['left.test','right.test'].map((host,side)=>{
        const ref=structuredClone(v.references[0]);ref.id=`ref_${index}_${side}`;ref.url=`https://${host}/sample-${index}`;
        ref.contentDigest=`synthetic-original-${index}-${side}`;ref.biasPrediction=compactBiasPrediction(model,side===0?-0.5:0.5)!;
        return ref;
      });
      v.checks[0].relations=v.references.map(ref=>({referenceId:ref.id,quote:ref.text,start:0,end:ref.text.length,relation:'supports',explanation:'synthetic quote'}));
      return v;
    });
    const coordinates=biasCoordinatesFromResearch(a,bundles,model,orientations);
    expect(coordinates.filter(row=>row.articleId!==a.analysisId)).toHaveLength(6);
    expect(analyzeBiasCoordinate(coordinates,orientations,a.analysisId)).toMatchObject({status:'ready',eligiblePublisherCount:2});
    const rerun=result(a);rerun.researchPlanId='synthetic-plan-2';rerun.createdAt='2026-02-01T00:00:04Z';
    rerun.references=[];rerun.checks[0].execution='failed';
    expect(rows(a,[...bundles,rerun])).toEqual([]);
  });
  it('accumulates current same-proposition claim bundles but removes an older bundle after its failed recheck',()=>{
    const a=analysis(),template=structuredClone(a.claims[0]);
    a.claims=Array.from({length:3},(_,i)=>({...structuredClone(template),id:`claim_${i}`,text:`별도 사실 주장 ${i}`}));
    const bundles=a.claims.map((claim,index)=>{
      const v=result(a);v.createdAt=`2026-02-01T00:00:0${index}Z`;
      v.checks[0].claimId=claim.id;v.checks[0].relations=[];
      v.references=['left.test','right.test'].map((host,side)=>{
        const ref=structuredClone(v.references[0]),text=`가나: 가상 기사 ${index} ${side}의 서로 다른 근거입니다.`;
        ref.id=`ref_${index}_${side}`;ref.url=`https://${host}/article-${index}`;ref.text=text;
        ref.contentDigest=`synthetic-distinct-${index}-${side}`;ref.retrievedTextLength=text.length;ref.fullTextLength=text.length;
        ref.biasPrediction!.classifier.coordinate=side===0?-0.5:0.5;
        return ref;
      });
      v.perspectiveChecks=v.references.map(ref=>({referenceId:ref.id,positionText:group,
        stance:ref.url!.includes('left.test')?'opposes_position':'supports_position',
        quote:ref.text,start:0,end:ref.text.length,explanation:'synthetic same-subject quote'}));
      return v;
    });
    const coordinates=biasCoordinatesFromResearch(a,bundles,model,orientations);
    expect(coordinates.filter(row=>row.articleId!==a.analysisId)).toHaveLength(6);
    expect(analyzeBiasCoordinate(coordinates,orientations,a.analysisId)).toMatchObject({status:'ready',eligiblePublisherCount:2});
    const failed=structuredClone(bundles[1]);failed.createdAt='2026-02-01T00:00:04Z';
    failed.references=[];delete failed.perspectiveChecks;failed.checks[0].execution='failed';
    const afterRecheck=biasCoordinatesFromResearch(a,[...bundles,failed],model,orientations);
    expect(afterRecheck.filter(row=>row.articleId!==a.analysisId)).toHaveLength(4);
    expect(afterRecheck.some(row=>row.articleId.endsWith('/article-1'))).toBe(false);
    expect(analyzeBiasCoordinate(afterRecheck,orientations,a.analysisId).reason).toBe('insufficient_publisher_samples');
  });
  it('accepts a current verified article and keeps its full-original digest for deduplication',()=>{
    const a=analysis(),v=result(a);const second=structuredClone(v.references[0]);second.id='second';second.url='https://right.test/reprint';
    v.references.push(second);v.checks[0].relations.push({...v.checks[0].relations[0],referenceId:'second'});
    expect(rows(a,[v])).toHaveLength(2);
    expect(new Set(rows(a,[v]).map(r=>r.sourceGroupId)).size).toBe(1);
  });
  it('rejects stale, unbound and demonstration results',()=>{
    const a=analysis(),v=result(a);
    expect(rows(a,[{...v,parentAnalysisId:'stale'},{...v,parentAnalysisId:undefined},{...v,mode:'demo'}])).toEqual([]);
    expect(biasCoordinatesFromResearch({...a,mode:'demo'},[v],model,orientations)).toEqual([]);
  });
  it('requires exact public publisher boundaries and an actual matching quote',()=>{
    const a=analysis();
    for(const url of ['https://left.test.attacker.example/article','https://notleft.test/article','http://left.test/article']){
      const v=result(a);v.references[0].url=url;expect(rows(a,[v])).toEqual([]);
    }
    const missing=result(a);missing.checks[0].relations=[];expect(rows(a,[missing])).toEqual([]);
    const forged=result(a);forged.checks[0].relations[0].quote='없는 인용';expect(rows(a,[forged])).toEqual([]);
  });
  it('does not reuse an earlier completion after a failed, skipped, or insufficient recheck',()=>{
    const a=analysis(),old=result(a);
    for(const state of ['failed','skipped','insufficient'] as const){
      const latest=result(a);latest.references=[];latest.checks[0].relations=[];
      if(state==='insufficient')latest.checks[0].outcome='insufficient';else latest.checks[0].execution=state;
      expect(rows(a,[old,latest])).toEqual([]);
    }
  });
  it('uses the explicit current proposition rather than an unrelated same-text claim',()=>{
    const a=analysis(),v=result(a);a.proposition='a different selected subject';
    expect(biasCoordinatesFromResearch(a,[v],model,orientations)).toEqual([]);
  });
  it('rejects predictions from a different coordinate space or evaluation split',()=>{
    const a=analysis();
    for(const change of ['space','split'] as const){
      const v=result(a),classifier=v.references[0].biasPrediction!.classifier;
      if(change==='space')classifier.coordinateSpace='other-space';else classifier.evaluation.groupSplitId='other-split';
      expect(rows(a,[v])).toEqual([]);
    }
  });
});
