"""Offline grouped baseline comparison; never reads application submissions.

Input JSONL: id, group, text, label (clear/flagged), split (train/dev/test),
reviewed_by (at least two human reviewer IDs), optional embedding and embedding_version.
Use the dev split for model selection; run the held-out test only after freezing choices.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import LinearSVC


def load_data(path):
    rows=[json.loads(line) for line in Path(path).read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    if not rows:
        raise ValueError('Empty dataset')
    ids=set(); groups={}
    for r in rows:
        if r['id'] in ids:
            raise ValueError('Duplicate item ID')
        ids.add(r['id'])
        if r['label'] not in {'clear','flagged'} or r['split'] not in {'train','dev','test'}:
            raise ValueError('Invalid label or split')
        if len(set(r.get('reviewed_by',[])))<2:
            raise ValueError('Evaluation labels require independent human review')
        previous=groups.setdefault(r['group'],r['split'])
        if previous!=r['split']:
            raise ValueError('Thread/group leakage across splits')
    # Also reject exact duplicate texts leaking between splits.
    texts={}
    for r in rows:
        key=' '.join(r['text'].split())
        if texts.setdefault(key,r['split'])!=r['split']:
            raise ValueError('Duplicate text leakage across splits')
    return rows


def metrics(y_true,y_pred):
    return {'report':classification_report(y_true,y_pred,labels=['clear','flagged'],output_dict=True,zero_division=0),
            'confusion_matrix':confusion_matrix(y_true,y_pred,labels=['clear','flagged']).tolist()}


def evaluate(rows,split):
    train=[r for r in rows if r['split']=='train']
    target=[r for r in rows if r['split']==split]
    if len({r['label'] for r in train})<2 or not target:
        raise ValueError('Need both training classes and a non-empty evaluation split')
    x=[r['text'] for r in train];y=[r['label'] for r in train]
    tx=[r['text'] for r in target];ty=[r['label'] for r in target]
    result={}
    rule=lambda t:'flagged' if any(w in t for w in ['바보','멍청','죽여']) else 'clear'
    result['keyword_rule']=metrics(ty,[rule(t) for t in tx])
    model=make_pipeline(TfidfVectorizer(analyzer='char',ngram_range=(2,5),min_df=1),LinearSVC(random_state=42))
    model.fit(x,y);result['tfidf_linear_svm']=metrics(ty,model.predict(tx))
    if all('embedding' in r for r in train+target):
        versions={r.get('embedding_version') for r in train+target}
        if len(versions)!=1 or None in versions:
            raise ValueError('Embedding versions must match')
        ex=np.asarray([r['embedding'] for r in train],dtype=float)
        et=np.asarray([r['embedding'] for r in target],dtype=float)
        if ex.ndim!=2 or et.ndim!=2 or ex.shape[1]!=et.shape[1] or not np.isfinite(ex).all() or not np.isfinite(et).all():
            raise ValueError('Invalid embedding matrix')
        for name,clf in [('embedding_logistic',LogisticRegression(max_iter=2000,random_state=42)),('embedding_linear_svm',LinearSVC(random_state=42))]:
            pipeline=make_pipeline(StandardScaler(),clf)
            pipeline.fit(ex,y);result[name]=metrics(ty,pipeline.predict(et))
    return {'split':split,'train_count':len(train),'evaluation_count':len(target),'labels':['clear','flagged'],
            'results':result,'limitations':['Dataset-specific experimental results; no production probability calibration performed.']}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data',required=True);parser.add_argument('--split',choices=['dev','test'],default='dev');parser.add_argument('--output',required=True)
    args=parser.parse_args();out=evaluate(load_data(args.data),args.split)
    Path(args.output).write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Evaluation report saved; no submitted user text was used.')
