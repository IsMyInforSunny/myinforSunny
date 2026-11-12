import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
import {inferContentStance,isStanceTrainingArticle,parseStanceModel} from '../lib/stance-model';

// Synthetic encoder fixtures verify cross-language mathematics only. They
// never train the product model or stand in for real article accuracy tests.
const program=String.raw`
import hashlib,json,sys
sys.path.insert(0,'research')
from train_stance import PROPOSITIONS,model_text
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
body='최저임금 인상을 지지한다. 최저임금 인상은 필요하다.'
other='최저임금 동결을 요구한다. 인상에 반대한다.'
texts=[model_text(body,'minimum_wage'),model_text(other,'minimum_wage')]
v=TfidfVectorizer(analyzer='char',ngram_range=(2,4),lowercase=False,sublinear_tf=True)
x=v.fit_transform(texts).toarray()
coef=np.vstack([np.zeros(x.shape[1]),-x[0]*2,x[0]*2])
intercepts=[-2,0,0]
hash=hashlib.sha256(body.encode()).hexdigest()
m={'schemaVersion':'content-stance-svm-1.0','version':'synthetic-parity-only',
'task':'article_stance_toward_proposition','status':'ready','scopeCharacters':2000,
'propositions':PROPOSITIONS,'classes':['non_directional','oppose','support'],
'vectorizer':{'vocabulary':{k:int(i) for k,i in v.vocabulary_.items()},'idf':v.idf_.tolist()},
'coefficients':coef.tolist(),'intercepts':intercepts,'coordinateScale':5,'trainingHashes':[hash],
'release':{'schemaVersion':'stance-release-1.0','corpusDigest':hash,'labelsDigest':hash,
'reviewDigest':hash,'modelDigest':hash,'trainingAllowed':True,'modelDistributionAllowed':True},
'evaluation':{'ready':True,'automaticChecksPassed':True,'humanEvaluationCount':0,'groupOverlap':0,
'splitId':'test-only','blockers':[],'teacher':['ai','fixture','1'],
'classCounts':{'non_directional':10,'support':10,'oppose':10},
'aiTeacherAgreement':{'macroF1':.7,'majorityMacroF1':.3,'recall':{'support':.7,'oppose':.7}}}}
expected=float((x[0]@coef[2]-x[0]@coef[1])/5)
print(json.dumps({'model':m,'body':body,'coordinate':expected}))
`;

describe('portable SVM encoder and release boundaries',()=>{
 const data=JSON.parse(execFileSync(process.platform==='win32'?'py':'python3',['-c',program],{
   cwd:resolve('.'),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},timeout:30_000}));
 it('matches Python char TF-IDF margins rather than categorical LLM positions',()=>{
   const model=parseStanceModel(data.model);expect(model).not.toBeNull();
   const prediction=inferContentStance(model!,data.body,'minimum_wage');
   expect(prediction.status).toBe('ready');expect(prediction.label).toBe('support');
   expect(prediction.coordinate).toBeCloseTo(data.coordinate,10);
 });
 it('rejects an unreleased artifact even when its evaluation claims to pass',()=>{
   const {release,...unreleased}=data.model;expect(release).toBeDefined();
   expect(parseStanceModel(unreleased)).toBeNull();
   expect(parseStanceModel({...data.model,status:'research'})).toBeNull();
   expect(parseStanceModel({...data.model,release:{...release,trainingAllowed:false}})).toBeNull();
 });
 it('excludes normalized training originals from independent comparisons',async()=>{
   const model=parseStanceModel(data.model)!;
   expect(await isStanceTrainingArticle(model,data.body)).toBe(true);
   expect(await isStanceTrainingArticle(model,data.body.replaceAll(' ','  '))).toBe(true);
   expect(await isStanceTrainingArticle(model,'최저임금 동결을 요구한다.')).toBe(false);
 });
});
