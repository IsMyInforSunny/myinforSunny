import fs from 'node:fs';
import path from 'node:path';

/** Explicit local opt-in. Release validation and public JSON remain untouched. */
export function localVoiceResearchPlugin({command,root,env=process.env}){
 const selected=env.LOCAL_VOICE_RESEARCH_MODEL;
 if(!selected)return null;
 if(command!=='serve'){
  const canonical=env.LOCAL_VOICE_RESEARCH_CANONICAL_ROOT&&fs.realpathSync(env.LOCAL_VOICE_RESEARCH_CANONICAL_ROOT);
  const current=fs.realpathSync(root);
  if(!canonical||current===canonical||!current.startsWith(path.join(canonical,'.sites-runtime')+path.sep))
   throw Error('Research voice builds require an isolated checkout inside the canonical project .sites-runtime; unset LOCAL_VOICE_RESEARCH_MODEL before a normal build.');
 }
 const runtime=fs.realpathSync(path.join(root,'.sites-runtime'));
 const file=fs.realpathSync(path.resolve(root,selected));
 if(!file.startsWith(runtime+path.sep))throw Error('Research model must resolve inside project .sites-runtime.');
 const candidate=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 if(candidate.schemaVersion!=='voice-multitopic-embedding-svm-research-1.0'||candidate.status!=='research'||candidate.researchOnly!==true
  ||candidate.encoder?.provider!=='nvidia'||candidate.encoder?.model!=='nvidia/nemotron-3.5-embed-1b'||candidate.encoder?.dimensions!==2048
  ||candidate.segmenter!=='sentence-3.1'||candidate.scopeCharacters!==2000||!candidate.version||!Object.keys(candidate.topics??{}).length
  ||!Array.isArray(candidate.trainingArticleHashes))throw Error('Invalid retained research candidate.');
 const model={version:candidate.version,decisionPolicy:candidate.decisionPolicy,encoder:candidate.encoder,topics:candidate.topics,trainingArticleHashes:candidate.trainingArticleHashes};
 const target=path.resolve(root,'lib/server/local-research-voice.ts').replaceAll('\\','/');
 const comparisonTarget=path.resolve(root,'lib/server/local-research-comparison.ts').replaceAll('\\','/');
 const localJson=name=>{
  if(!env[name])return null;
  const selectedFile=fs.realpathSync(path.resolve(root,env[name]));
  if(!selectedFile.startsWith(runtime+path.sep))throw Error('Research comparison files must resolve inside project .sites-runtime.');
  return JSON.parse(fs.readFileSync(selectedFile,'utf8').replace(/^\uFEFF/,''));
 };
 const comparison={precomputed:localJson('LOCAL_VOICE_PRECOMPUTED'),baselines:localJson('LOCAL_VOICE_BASELINES'),
  provenance:localJson('LOCAL_VOICE_PROVENANCE'),recommendations:localJson('LOCAL_VOICE_RECOMMENDATIONS')?.articles??null};
 return {name:'local-voice-research',enforce:'pre',
  config(){return {server:{host:'127.0.0.1',allowedHosts:['localhost','127.0.0.1']}};},
  transform(_code,id){
   const module=id.split('?')[0].replaceAll('\\','/');
   if(module!==target&&module!==comparisonTarget)return null;
   if(this.environment?.name==='client')throw Error('Research voice model cannot enter a client bundle.');
   return {code:`export default ${JSON.stringify(module===target?model:comparison)};`,map:null};
  }};
}
