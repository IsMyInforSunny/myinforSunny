/** Prepare changed and uncertain retained sentences for a bounded teacher review. No requests. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const runtime=fs.realpathSync(path.join(root,'.sites-runtime'));
const options={};
const definitions=JSON.parse(fs.readFileSync(path.join(root,'lib/data/voice-issues.json'),'utf8'));
const args=process.argv.slice(2);
for(let index=0;index<args.length;index++){
  const flag=args[index];
  if(!['--corpus','--labels','--reviewed','--output'].includes(flag)||!args[index+1])throw Error('Use --corpus PATH --labels PATH [--reviewed PATH] --output NEW_PATH');
  options[flag.slice(2)]=args[++index];
}
function local(value){
  if(typeof value!=='string')throw Error('A local runtime path is required');
  const target=path.resolve(value);
  if(!target.startsWith(runtime+path.sep))throw Error('Review data must remain beneath .sites-runtime');
  let existing=target;while(!fs.existsSync(existing))existing=path.dirname(existing);
  const actual=fs.realpathSync(existing);
  if(actual!==runtime&&!actual.startsWith(runtime+path.sep))throw Error('Review path resolves outside .sites-runtime');
  return target;
}
const rows=file=>fs.readFileSync(local(file),'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const corpus=rows(options.corpus),labels=rows(options.labels),reviewed=options.reviewed?rows(options.reviewed):[];
const destination=local(options.output);
if(fs.existsSync(destination))throw Error('Preserve the existing review queue');
const byId=new Map(corpus.map(article=>[article.id,article]));
const rawById=new Map(labels.map(record=>[record.articleId,record]));
const reviewedById=new Map(reviewed.map(record=>[record.articleId,record]));
if(byId.size!==corpus.length||rawById.size!==labels.length||reviewedById.size!==reviewed.length)throw Error('Duplicate article identity');
const requests=[],counts={articles:0,sentences:0,totalLabelledSentences:0,changed:0,uncertain:0,truncated:0};
for(const [articleId,record]of rawById){
  const article=byId.get(articleId),revision=reviewedById.get(articleId);
  if(!article||record.articleHash!==article.voiceHash||revision&&revision.articleHash!==record.articleHash)throw Error('Review corpus/body hash mismatch');
  const units=article.sentences;
  if(!Array.isArray(units)||record.labels.length!==units.length||revision&&revision.labels.length!==units.length)throw Error('Incomplete sentence labels');
  const selected=[];
  for(let index=0;index<units.length;index++){
    const unit=units[index],label=record.labels[index],corrected=revision?.labels[index];
    if(label.sentenceId!==unit.sentenceId||corrected&&corrected.sentenceId!==unit.sentenceId)throw Error('Sentence labels are out of order');
    counts.totalLabelledSentences++;
    const changed=!!corrected&&['issue','direction','speaker'].some(key=>label[key]!==corrected[key]);
    const uncertain=[label,corrected].filter(Boolean).some(item=>item.direction==='uncertain'||item.issue==='unknown'||item.speaker==='mixed');
    const truncated=index===units.length-1&&unit.end>=2000&&!/[.!?。！？]["'”’)]*$/.test(unit.text.trim());
    if(!changed&&!uncertain&&!truncated)continue;
    counts.changed+=Number(changed);counts.uncertain+=Number(uncertain);counts.truncated+=Number(truncated);
    selected.push({sentenceId:unit.sentenceId,text:unit.text,previous:units[index-1]?.text??'',following:units[index+1]?.text??'',
      reasons:[...(changed?['changed']:[]),...(uncertain?['uncertain']:[]),...(truncated?['scope_boundary']:[])],
      rawLabel:label,...(corrected?{reviewedLabel:corrected}:{})});
  }
  if(selected.length){counts.articles++;counts.sentences+=selected.length;requests.push({articleId,articleHash:record.articleHash,topic:record.topic,
    issues:definitions.topics[record.topic].issues,sentences:selected});}
}
const sha=file=>createHash('sha256').update(fs.readFileSync(local(file))).digest('hex');
const result={schemaVersion:'voice-targeted-review-1.0',researchOnly:true,humanEvaluationCount:0,apiCalls:0,
  instructions:'Review only the listed changed or boundary sentences using their original context. Return sentence IDs and issue/direction/speaker symbols. Treat both existing labels as hypotheses, preserve uncertainty, and do not create a human evaluation claim.',
  counts,requests,sourceDigests:{corpus:sha(options.corpus),labels:sha(options.labels),reviewed:options.reviewed?sha(options.reviewed):null}};
fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(result,null,2)+'\n',{encoding:'utf8',flag:'wx'});
console.log(JSON.stringify({schemaVersion:result.schemaVersion,...counts,apiCalls:0,humanEvaluationCount:0}));
