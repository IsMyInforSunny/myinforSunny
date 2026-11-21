"""Rescore/retrain frozen paired news labels using existing embeddings; API calls: zero."""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import json
import time
from pathlib import Path
from datetime import datetime, timezone
import numpy as np
from train_stance import ROOT, digest, article_prefix
from train_voice import validate, connected_groups, runtime_evaluation
from prepare_voice_embeddings import natural_text, neutral_sample, OPTIONS, MODEL, local_path
from train_multitopic_voice_embeddings import checked_input, train_topic, CONFIGURATION
from voice_features import is_boilerplate

TOPICS=('medical_school_quota','minimum_wage','nuclear_energy')
FIELDS=('issue','direction','speaker')
def read(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def rows(path): return [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()] if path.exists() else []
def write(path,value):
    with path.open('x',encoding='utf-8') as handle: json.dump(value,handle,ensure_ascii=False,indent=2);handle.write('\n')
def completed(path): return {row['articleId']:row for row in rows(path) if row.get('status')=='completed'}
def load_vectors(required):
    """Each cache's declared request set and input digest are verified before reuse."""
    base=ROOT/'.sites-runtime';directories=[base/'voice-expansion-20261115',base/'speed-20261115/priority-four',base/'speed-20261115/priority-resume',base/'speed-20261115/priority-resume-2',base/'speed-20261115/full-corpus-queue',base/'issue-quarter-20261115-priority',base/'issue-quarter-20261115-all-supported',base/'issue-quarter-20261115-title-completion',base/'svm-improvement-20261114']
    pairs=[(base/'voice-expansion-20261115/six-topics-complete-embedding-input.local.json',base/'voice-expansion-20261115/six-topics-complete-embedding-vectors.local.json')]
    for directory in directories[1:]:
        for vectors in sorted(directory.glob('*vectors.local.json')):
            input_path=vectors.with_name(vectors.name.replace('vectors.local.json','input.local.json'))
            if input_path.exists():pairs.append((input_path,vectors))
    result={};provenance=[]
    for input_path,vector_path in pairs:
        source=read(input_path);allowed=checked_input(source);wanted=required&allowed-set(result)
        if not wanted: continue
        cache=read(vector_path)
        if cache.get('inputDigest')!=source['inputDigest'] or cache.get('schemaVersion')!='voice-embeddings-1.0' or cache.get('model')!=MODEL or cache.get('dimensions')!=2048:raise ValueError('Embedding cache provenance mismatch')
        if set(cache.get('vectors',{}))-allowed:raise ValueError('Unrequested cached embedding')
        for key in wanted:
            raw=cache.get('vectors',{}).get(key)
            if raw is None:continue
            vector=np.asarray(raw,dtype=np.float64)
            if vector.shape!=(2048,) or not np.all(np.isfinite(vector)):raise ValueError('Embedding vector malformed')
            norm=np.hypot.reduce(vector)
            if not np.isfinite(norm) or norm<=0:raise ValueError('Embedding vector zero')
            result[key]=vector/norm
        provenance.append({'inputDigest':source['inputDigest'],'vectorsFile':vector_path.name,'retained':len(result)})
        del cache
        if len(result)==len(required):break
    return result,provenance

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--stage',choices=['evaluation','initial','final'],required=True);parser.add_argument('--runtime',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    runtime=local_path(args.runtime);out=local_path(args.output);out.mkdir(parents=True,exist_ok=True)
    result_path=out/'pipeline-result.local.json'
    if result_path.exists():raise ValueError('Preserve existing pipeline result')
    manifest=read(runtime/'paired-sample-manifest.local.json');article_info={row['id']:row for row in manifest['articles']};corpus=rows(runtime/'training-corpus.local.jsonl')
    # JS voiceArticleHash hashes the first 2,000 UTF-16 characters. Python's
    # existing trainer validates its supplied text, so supply that exact scope.
    corpus=[{**row,'text':article_prefix(row['text'])} for row in corpus];corpus_by_id={row['id']:row for row in corpus}
    lightning=completed(runtime/'lightning-labels.local.jsonl');deepseek=completed(runtime/'deepseek-evaluation-labels.local.jsonl');groq=completed(runtime/'groq-evaluation-labels.local.jsonl')
    evaluation=[row for row in manifest['articles'] if row['partition']=='evaluation']
    evaluation=[row for row in evaluation if row['id'] in lightning and (row['id'] in deepseek or row['id'] in groq)]
    paired_counts=Counter(row['topic'] for row in evaluation)
    winner='deepseek-preferred-groq-fallback'
    if len(evaluation)<80 or any(paired_counts[topic]<25 for topic in TOPICS):
        write(result_path,{'stage':args.stage,'status':'blocked','apiCalls':0,'blocker':'paired_evaluation_min80_topic25_required','pairedEvaluation':len(evaluation),'pairedByTopic':dict(paired_counts)})
        return
    selected={row['id']:deepseek.get(row['id']) or groq.get(row['id']) for row in evaluation}
    agreement={field:Counter(compared=0,agree=0) for field in FIELDS};topic_agreement={topic:{field:Counter(compared=0,agree=0) for field in FIELDS} for topic in TOPICS};annotations=[];second_sources=Counter()
    for item in evaluation:
        left,right=lightning[item['id']],selected[item['id']];second_sources[right['model']]+=1
        if left['articleHash']!=item['bodyHash'] or right['articleHash']!=item['bodyHash']:raise ValueError('Evaluation article hash changed')
        a={label['sentenceId']:label for label in left['labels']};b={label['sentenceId']:label for label in right['labels']}
        if set(a)!=set(b):raise ValueError('Second labels do not cover identical frozen sentence IDs')
        labels=[];unit_text={unit['sentenceId']:unit['text'] for unit in corpus_by_id[item['id']]['sentences']}
        for sid in a:
            if is_boilerplate(unit_text.get(sid,'')):
                labels.append({'sentenceId':sid,'issue':'none','direction':'neutral','speaker':'unknown','excluded':True})
                continue
            combined={'sentenceId':sid}
            for field in FIELDS:
                agreement[field]['compared']+=1;topic_agreement[item['topic']][field]['compared']+=1
                same=a[sid][field]==b[sid][field];agreement[field]['agree']+=same;topic_agreement[item['topic']][field]['agree']+=same
                combined[field]=a[sid][field] if same else {'issue':'unknown','direction':'uncertain','speaker':'unknown'}[field]
            if combined['issue'] in ['none','unknown'] and combined['direction'] in ['support','oppose']:combined['direction']='uncertain'
            labels.append(combined)
        annotations.append({'articleId':item['id'],'articleHash':item['bodyHash'],'topic':item['topic'],'version':left.get('voiceVersion','sentence-voice-1.0'),'segmenter':left['segmenter'],'scopeCharacters':2000,'labels':labels,'annotator':{'kind':'ai','model':'Lightning + independent second-model field agreement','version':'paired-consensus-20261117-v1','sourceModels':[left['model'],right['model']]}})
    consensus_rows,_=validate([corpus_by_id[item['id']] for item in evaluation],annotations)
    write(out/'agreement.local.json',{'apiCalls':0,'articles':len(evaluation),'winner':winner,'secondModels':dict(second_sources),'deepseekPreferredWhenBoth':True,'fields':{name:{**counts,'rate':counts['agree']/counts['compared'] if counts['compared'] else None} for name,counts in agreement.items()},'topics':topic_agreement,'usableConsensusSentences':len(consensus_rows),'humanEvaluationCount':0})
    with (out/'consensus-evaluation.local.jsonl').open('x',encoding='utf-8') as handle:
        for row in annotations:handle.write(json.dumps(row,ensure_ascii=False)+'\n')
    accepted=consensus_rows;training_annotations=[];selected_training=[]
    if args.stage!='evaluation':
        for item in manifest['articles']:
            if item['partition']!='training' or item['id'] not in lightning:continue
            row=lightning[item['id']];selected_training.append(item)
            training_annotations.append({'articleId':item['id'],'articleHash':item['bodyHash'],'topic':item['topic'],'version':row.get('voiceVersion','sentence-voice-1.0'),'segmenter':row['segmenter'],'scopeCharacters':2000,'labels':row['labels'],'annotator':{'kind':'ai','model':row['model'],'version':row['modelVersion']}})
        training_counts=Counter(item['topic'] for item in selected_training)
        if any(training_counts[topic]<60 for topic in TOPICS):raise ValueError('Training article trigger not satisfied')
        if args.stage=='final':
            progress=read(runtime/'optimized-lightning-progress.local.json')
            if progress.get('phase') not in ('completed','finished_with_failures'):raise ValueError('Final training requires a terminal Lightning checkpoint')
        # Validate each actual teacher separately, then compose known frozen partitions.
        train_rows,_=validate([corpus_by_id[item['id']] for item in selected_training],training_annotations);accepted=train_rows+consensus_rows
    groups=connected_groups(accepted);eval_ids={item['id'] for item in evaluation};eval_groups={groups[i] for i,row in enumerate(accepted) if row['article']['id'] in eval_ids};sets={'train':[],'evaluation':[],'challenge':[]};records={};excluded=Counter()
    for i,row in enumerate(accepted):
        partition='evaluation' if row['article']['id'] in eval_ids else 'train'
        if partition=='train' and groups[i] in eval_groups:excluded[row['topic']]+=1;continue
        text=natural_text(row['text']);key=hashlib.sha256(text.encode()).hexdigest()
        if not text:continue
        if key in records and records[key]['partition']!=partition:raise ValueError('Semantic text crosses frozen partition')
        records.setdefault(key,{'key':key,'text':text,'partition':partition,'sourceIDs':[]})
        source={'articleId':row['article']['id'],'sentenceId':row['sentenceId'],'topic':row['topic']};records[key]['sourceIDs'].append(source)
        sets[partition].append({'key':key,**source,'group':groups[i],'articleHash':row['hash'],**{field:row[field] for field in FIELDS}})
    vectors,provenance=load_vectors(set(records));missing=set(records)-set(vectors)
    candidate=read(ROOT/'.sites-runtime/voice-expansion-20261115/six-topics-candidate.local.json');scores={}
    for topic in TOPICS:
        evaluated=[row for row in sets['evaluation'] if row['topic']==topic and row['key'] in vectors]
        model=candidate.get('topics',{}).get(topic)
        scores[topic]={'count':len(evaluated),'missingEmbeddings':sum(row['topic']==topic and row['key'] in missing for row in sets['evaluation'])}
        if model and evaluated:scores[topic]['runtime']=runtime_evaluation(evaluated,model['heads'],np.vstack([vectors[row['key']] for row in evaluated]),candidate.get('decisionPolicy'))
    write(out/'current-candidate-rescore.local.json',{'apiCalls':0,'candidateVersion':candidate['version'],'researchOnly':True,'humanEvaluationCount':0,'topics':scores,'vectorsProvenance':provenance})
    result={'stage':args.stage,'status':'completed','apiCalls':0,'completedAt':datetime.now(timezone.utc).isoformat(),'evaluationArticles':len(evaluation),'currentCandidateVersion':candidate['version'],'missingEmbeddingCount':len(missing),'crossPartitionConnectedTrainingExcluded':dict(excluded),'humanEvaluationCount':0}
    if args.stage!='evaluation':
        models={};reports={}
        for topic in TOPICS:
            training=[row for row in sets['train'] if row['topic']==topic];heldout=[row for row in sets['evaluation'] if row['topic']==topic]
            model,report=train_topic(topic,training,heldout,vectors);reports[topic]=report
            if model:models[topic]=model
        version=digest({'configuration':CONFIGURATION,'heads':{topic:model['heads'] for topic,model in models.items()}})[:24]
        report={'schemaVersion':'voice-multitopic-embedding-evaluation-1.0','modelVersion':version,'ready':False,'researchOnly':True,'usageReviewed':False,'humanEvaluationCount':0,'topics':reports,'configuration':CONFIGURATION,'trainingLabelSource':'single Lightning model','evaluationLabelSource':'two-model field consensus','frozenSampleDigest':digest(manifest)}
        write(out/'evaluation.local.json',report)
        write(out/'candidate.local.json',{**{key:value for key,value in candidate.items() if key not in ['topics','evaluation','version','trainingArticleHashes','inputDigest']},'version':version,'inputDigest':digest({'manifest':manifest,'training':training_annotations,'evaluation':annotations,'configuration':CONFIGURATION}),'topics':models,'evaluation':report,'trainingArticleHashes':sorted({row['articleHash'] for row in sets['train']})})
        result.update(trainedTopics=list(models),trainingArticles=dict(Counter(item['topic'] for item in selected_training)),modelVersion=version,ready=False,status='completed' if len(models)==len(TOPICS) else 'blocked',blockers={topic:reports[topic].get('blockers',[]) for topic in TOPICS if topic not in models})
    write(result_path,result)
    print(json.dumps(result,ensure_ascii=True))
if __name__=='__main__':main()
