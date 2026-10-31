"""Compare actual LLM predictions with independent human labels; never invent missing labels."""
import argparse,csv,json
from collections import Counter
from pathlib import Path

TASKS={'expression_status':{'flagged','clear','undetermined'},'claim_kind':{'factual','opinion','undetermined','none'},'reference_relation':{'supported','contradicted','conflicting','insufficient','unchecked','not_applicable'}}

def load(path):
 with open(path,encoding='utf-8-sig',newline='') as f:rows=list(csv.DictReader(f))
 if len({r['case_id'] for r in rows})!=len(rows):raise ValueError('Duplicate case ID')
 return {r['case_id']:r for r in rows}

def compare(a,b,p,ids):
 lines=['# 독립 평가 비교표','', '각 과제는 별도로 집계합니다. 사람 간 불일치는 조정 전 결과이며 LLM 정답으로 자동 채택하지 않습니다.','', '| 과제 | 평가 가능/전체 | 사람 일치 | Cohen kappa | 합의 라벨 대비 LLM 일치 |','|---|---:|---:|---:|---:|']
 for task,allowed in TASKS.items():
  pairs=[(a[i][task],b[i][task]) for i in ids if i in a and i in b and a[i].get(task) in allowed and b[i].get(task) in allowed]
  if not pairs:lines.append(f'| {task} | 0/{len(ids)} | 미평가 | 미평가 | 미평가 |');continue
  n=len(pairs);agree=sum(x==y for x,y in pairs);ca,cb=Counter(x for x,y in pairs),Counter(y for x,y in pairs)
  pe=sum(ca[k]*cb[k] for k in allowed)/(n*n);k=(agree/n-pe)/(1-pe) if pe<1 else None
  consensus=[(a[i][task],p[i][task]) for i in ids if i in a and i in b and i in p and a[i].get(task) in allowed and a[i][task]==b[i].get(task) and p[i].get(task) in allowed]
  match=sum(x==y for x,y in consensus);model=f'{match}/{len(consensus)}' if consensus else '미실시'
  lines.append(f'| {task} | {n}/{len(ids)} | {agree}/{n} | {k:.3f}'+' | '+model+' |' if k is not None else f'| {task} | {n}/{len(ids)} | {agree}/{n} | 산출 불가 | {model} |')
 return '\n'.join(lines)+'\n'

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--reviewer1',required=True);parser.add_argument('--reviewer2',required=True);parser.add_argument('--predictions');parser.add_argument('--output',required=True);args=parser.parse_args()
 ids={c['id'] for c in json.loads((Path(__file__).parent/'evaluation-cases.json').read_text(encoding='utf-8'))['cases']}
 a,b=load(args.reviewer1),load(args.reviewer2);p=load(args.predictions) if args.predictions else {}
 if (set(a)|set(b)|set(p))-ids:raise ValueError('Unknown case ID')
 Path(args.output).write_text(compare(a,b,p,ids),encoding='utf-8');print('Comparison report written. Missing human labels remain unevaluated.')
