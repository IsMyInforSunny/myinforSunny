"""Explore already-generated embeddings; PCA coordinates are not stance scores."""
import argparse
import json
from pathlib import Path
import numpy as np
from sklearn.decomposition import PCA


def project(ids,vectors,version):
    x=np.asarray(vectors,dtype=float)
    if x.ndim!=2 or len(ids)!=len(x) or len(set(ids))!=len(ids) or len(ids)>30 or not np.isfinite(x).all():
        raise ValueError('Invalid IDs or embedding matrix')
    if len(x)<3 or np.linalg.matrix_rank(x-x.mean(axis=0))<2:
        return {'status':'skipped','reason':'Need at least three unique samples and centered rank >= 2'}
    model=PCA(n_components=2,svd_solver='full');z=model.fit_transform(x)
    return {'status':'available','embeddingVersion':version,'axisLabels':['PC1','PC2'],
            'points':[{'commentId':i,'x':float(v[0]),'y':float(v[1])} for i,v in zip(ids,z)],
            'explainedVarianceRatio':model.explained_variance_ratio_.tolist(),
            'limitations':['Coordinates from different projections are not directly comparable.']}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    data=json.loads(Path(args.input).read_text(encoding='utf-8-sig'))
    result=project(data['commentIds'],data['vectors'],data['embeddingVersion'])
    Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
