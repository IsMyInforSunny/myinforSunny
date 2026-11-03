import {describe,it,expect} from 'vitest';
import {inferBiasCoordinate,parseBiasModel,isBiasTrainingArticle,compactBiasPrediction,sameBiasModel,type PortableBiasModel} from '../lib/bias-model';
import {analyzeBiasCoordinate,type BiasArticleCoordinate,type BiasOrientationSet} from '../lib/bias-analysis';
import {biasCoordinatesFromResearch} from '../lib/bias-model-adapter';
import {demoAnalysis} from '../lib/fixtures';
import {readResearchToken,signResearchToken} from '../lib/server/research-token';

// Numeric infrastructure fixture, never a real publisher model or political score.
const evidence={axisId:'test',coordinateSpace:'synthetic',modelId:'publisher-char-tfidf-linear-svm',modelVersion:'test',task:'publisher_identity_relative_coordinate',
  trainingDataId:'train',evaluationDataId:'heldout',evaluation:{split:'held_out_articles' as const,heldOutUnit:'original_source_group' as const,
    groupSplitId:'split',trainingPublisherIds:['left.test','right.test'],evaluationPublisherIds:['left.test','right.test'],
    trainingSourceGroupIds:Array.from({length:100},(_,i)=>i).filter(i=>i%50<30).map(i=>`train${i}`),
    evaluationSourceGroupIds:Array.from({length:100},(_,i)=>i).filter(i=>i%50>=30).map(i=>`heldout${i}`),metrics:['left.test','right.test'].map(publisherId=>({publisherId,sampleCount:20,coordinateMae:0.1,publisherAccuracy:0.8}))}};
const fixture={schemaVersion:'publisher-coordinate-svm-1',synthetic:false,dataKind:'real',status:'validated',comparisonGroup:'synthetic subject',
  classifierEvidence:evidence,vectorizer:{analyzer:'char',ngramRange:[2,4],lowercase:false,whitespace:'collapse',norm:'l2',sublinearTf:true,
    vocabulary:{'가 ':2,' 😀':1,'가 😀':4,'나 ':5,'나 😀':6,' 나':0,'가 나':3},
    idf:[1.6931471805599454,1.2876820724517808,1.2876820724517808,1.6931471805599454,1.6931471805599454,1.6931471805599454,1.6931471805599454]},
  projection:{coefficients:[0.1,0.2,0.3,0.4,0.5,0.6,0.7],offset:-0.2,scale:2},
  lineage:Array.from({length:100},(_,i)=>({articleId:`fixture_${i}`,publisherId:i<50?'left.test':'right.test',url:`https://${i<50?'left.test':'right.test'}/fixture-${i}`,
    publishedAt:'2026-01-01T00:00:00Z',sourceGroupId:`${i%50<30?'train':'heldout'}${i}`,contentHash:i.toString(16).padStart(64,'0'),split:i%50<30?'training':'evaluation',
    usage:{trainingAllowed:true,modelDistributionAllowed:true,basisUrl:'https://fixture.test/usage',reviewedBy:'synthetic fixture',reviewedAt:'2026-01-01'}})),
  validation:{heldoutAnchorSeparation:true,humanAxisReview:{status:'approved',reviewedBy:'synthetic reviewer',evidence:'synthetic test only',
    reviewedModelVersion:'test',reviewers:['synthetic-a','synthetic-b'],sampleCount:40,interReviewerAgreement:0.8}}};
const set:BiasOrientationSet={axisId:'test',version:'test',source:'synthetic',note:'synthetic',profiles:[{publisherId:'left.test',orientation:'left'},{publisherId:'right.test',orientation:'right'}]};

describe('portable bias inference',()=>{
  it('signs bounded predictions for a large corpus without embedding evaluation group arrays per article',async()=>{
    const large=structuredClone(fixture);
    for(let i=0;i<800;i++){
      const publisherId=i%4<2?'left.test':'right.test',split=i%2===0?'training':'evaluation';
      const sourceGroupId=`${split}_${i}_${'x'.repeat(100)}`;
      large.lineage.push({...structuredClone(large.lineage[0]),articleId:`large_${i}`,publisherId,
        url:`https://${publisherId}/large-${i}`,sourceGroupId,split,contentHash:(i+1000).toString(16).padStart(64,'0')});
      const ids=split==='training'?large.classifierEvidence.evaluation.trainingSourceGroupIds:large.classifierEvidence.evaluation.evaluationSourceGroupIds;
      ids.push(sourceGroupId);
    }
    for(const metric of large.classifierEvidence.evaluation.metrics)metric.sampleCount=large.lineage.filter(row=>row.publisherId===metric.publisherId&&row.split==='evaluation').length;
    const model=parseBiasModel(large)!;expect(model).not.toBeNull();
    const compact=compactBiasPrediction(model,0.2)!;
    expect(JSON.stringify(compact).length).toBeLessThan(1500);
    expect(compact.classifier.evaluation).toEqual({groupSplitId:evidence.evaluation.groupSplitId});
    const request=new Request('https://site.test/api/research',{headers:{'cf-connecting-ip':'192.0.2.1'}}),config={GROQ_API_KEY:'synthetic-token-size-fixture'};
    const refs=[0,1].map(i=>({id:`ref_${i}`,url:`https://left.test/article-${i}`,text:'가상 공개 기사입니다. '.repeat(100),biasPrediction:compact}));
    const full=refs.map(ref=>({...ref,biasPrediction:{comparisonGroup:model.comparisonGroup,classifier:{...model.classifierEvidence,coordinate:0.2}}}));
    const oversized=await signResearchToken(request,config,'evidence',{references:full},60000,10000);
    expect(oversized.length).toBeGreaterThan(64000);
    await expect(readResearchToken(request,config,oversized,'evidence',11000)).rejects.toMatchObject({code:'INVALID_RESEARCH_EVIDENCE'});
    const token=await signResearchToken(request,config,'evidence',{references:refs},60000,10000);
    expect(token.length).toBeLessThan(16000);
    expect(await readResearchToken(request,config,token,'evidence',11000)).toEqual({references:refs});
  });
  it('requires every compact release identity and rejects invalid coordinates or legacy metadata expansion',()=>{
    const model=parseBiasModel(fixture)!,prediction=compactBiasPrediction(model,0.2)!;
    expect(sameBiasModel(prediction.classifier,model)).toBe(true);
    for(const field of ['axisId','coordinateSpace','modelId','modelVersion','task','trainingDataId','evaluationDataId'] as const){
      expect(sameBiasModel({...prediction.classifier,[field]:'different'},model)).toBe(false);
    }
    expect(sameBiasModel({...prediction.classifier,evaluation:{groupSplitId:'different'}},model)).toBe(false);
    expect(sameBiasModel({...model.classifierEvidence,coordinate:0.2},model)).toBe(false);
    expect(sameBiasModel({...prediction.classifier,coordinate:NaN},model)).toBe(false);
    expect(compactBiasPrediction(model,1.1)).toBeNull();
  });
  it('matches sklearn Unicode TF-IDF and projection golden output',()=>{
    const model=parseBiasModel(fixture)!;
    expect(inferBiasCoordinate(model,'  가\n\t😀  ')?.coordinate).toBeCloseTo(0.19969366914159534,12);
    expect(inferBiasCoordinate(model,'unseen')).toBeNull();
  });
  it('rejects synthetic, unreviewed, mismatched and malformed releases',()=>{
    expect(parseBiasModel(null)).toBeNull();
    expect(parseBiasModel({...fixture,synthetic:true})).toBeNull();
    expect(parseBiasModel({...fixture,status:'research_only'})).toBeNull();
    expect(parseBiasModel({...fixture,projection:{...fixture.projection,scale:0}})).toBeNull();
    expect(parseBiasModel({...fixture,lineage:[]})).toBeNull();
    expect(parseBiasModel({...fixture,validation:{...fixture.validation,humanAxisReview:{...fixture.validation.humanAxisReview,reviewers:['same',' same ']}}})).toBeNull();
    expect(parseBiasModel({...fixture,validation:{...fixture.validation,humanAxisReview:{...fixture.validation.humanAxisReview,reviewedModelVersion:'other'}}})).toBeNull();
    expect(parseBiasModel({...fixture,classifierEvidence:{...evidence,evaluation:{...evidence.evaluation,evaluationSourceGroupIds:['train']}}})).toBeNull();
  });
  it('rejects review counts exceeding actual heldout originals or unique content',()=>{
    const exaggerated=structuredClone(fixture);
    exaggerated.validation.humanAxisReview.sampleCount=41;
    expect(parseBiasModel(exaggerated)).toBeNull();
    const shared=structuredClone(fixture),heldout=shared.lineage.filter(r=>r.split==='evaluation');
    heldout[heldout.length-1].sourceGroupId=heldout[0].sourceGroupId;
    shared.classifierEvidence.evaluation.evaluationSourceGroupIds=[...new Set(heldout.map(r=>r.sourceGroupId))];
    expect(parseBiasModel(shared)).toBeNull();
    const duplicateText=structuredClone(fixture),duplicates=duplicateText.lineage.filter(r=>r.split==='evaluation');
    duplicates[duplicates.length-1].contentHash=duplicates[0].contentHash;
    expect(parseBiasModel(duplicateText)).toBeNull();
  });
  it('rejects training references by canonical URL or normalized body hash',async()=>{
    const model=parseBiasModel(fixture)!;
    expect(await isBiasTrainingArticle(model,'https://left.test/fixture-0#fragment','new text')).toBe(true);
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('가 나'));
    model.lineage[0].contentHash=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
    expect(await isBiasTrainingArticle(model,'https://right.test/new',' 가\t\n나 ')).toBe(true);
    expect(await isBiasTrainingArticle(model,'https://right.test/new','different text')).toBe(false);
  });
  it('rejects duplicate originals, hidden text leakage and incompatible feature spaces in a release',()=>{
    const duplicateOrigin=structuredClone(fixture);duplicateOrigin.lineage[1].sourceGroupId=duplicateOrigin.lineage[0].sourceGroupId;
    expect(parseBiasModel(duplicateOrigin)).toBeNull();
    const leakage=structuredClone(fixture);leakage.lineage.find(row=>row.split==='evaluation')!.contentHash=leakage.lineage[0].contentHash;
    expect(parseBiasModel(leakage)).toBeNull();
    const wrongNgram={...fixture,vectorizer:{...fixture.vectorizer,vocabulary:{'a':0,...Object.fromEntries(Object.entries(fixture.vectorizer.vocabulary).filter(([,index])=>index!==0))}}};
    expect(parseBiasModel(wrongNgram)).toBeNull();
    expect(parseBiasModel({...fixture,comparisonGroup:'x'.repeat(161)})).toBeNull();
  });
  it('accepts a target without publisher identity and collapses shared originals',()=>{
    const article=(articleId:string,publisherId:string,coordinate:number):BiasArticleCoordinate=>({articleId,publisherId,comparisonGroup:'synthetic',classifier:{...evidence,coordinate}});
    const rows=[article('target','input',-0.8),...Array.from({length:3},(_,i)=>article(`l${i}`,'left.test',-0.5)),...Array.from({length:3},(_,i)=>article(`r${i}`,'right.test',0.5))];
    expect(analyzeBiasCoordinate(rows,set,'target').status).toBe('ready');
    rows[1].sourceGroupId='shared';rows[2].sourceGroupId='shared';
    expect(analyzeBiasCoordinate(rows,set,'target').reason).toBe('insufficient_publisher_samples');
  });
  it('never promotes demos, other subjects or missing models into coordinates',()=>{
    const analysis=demoAnalysis('mixed'),model=parseBiasModel(fixture) as PortableBiasModel;
    expect(biasCoordinatesFromResearch(analysis,[],model,set)).toEqual([]);
    expect(biasCoordinatesFromResearch({...analysis,mode:'live'},[],model,set)).toEqual([]);
    expect(biasCoordinatesFromResearch({...analysis,mode:'live'},[],null,set)).toEqual([]);
  });
});
