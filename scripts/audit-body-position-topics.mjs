import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
const input=process.argv[2];if(!input)throw Error('Local corpus path required');
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom'});
try{
 const {canonicalStanceProposition,STANCE_PROPOSITIONS}=await server.ssrLoadModule('/lib/stance-model.ts');
 const {classifyRelativeTopic}=await server.ssrLoadModule('/lib/relative-metrics.ts');
 const oldRules={medical_school_quota:/의(?:과)?대[\s\S]{0,35}(?:정원|증원|확대)|(?:정원|증원)[\s\S]{0,35}의(?:과)?대/,
 pension_reform:/국민연금|보험료율|소득대체율/,minimum_wage:/최저임금|생활임금/,
 electricity_prices:/(?:전기|전력)\s*(?:요금|료)[\s\S]{0,35}(?:인상|인하|동결|원가|한전|한국전력)|(?:인상|인하|동결)[\s\S]{0,35}전기\s*(?:요금|료)/,
 housing_supply:/(?:주택|아파트|부동산)[\s\S]{0,35}(?:공급|분양|재건축|재개발)|(?:공급|분양|재건축|재개발)[\s\S]{0,35}(?:주택|아파트)/,nuclear_energy:/원전|원자력/};
 const rows=fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 const counts=Object.fromEntries(Object.keys(oldRules).map(topic=>[topic,{before:0,after:0,added:0,removed:0}])),changes=[];
 for(const row of rows){
  const topic=classifyRelativeTopic(row.text),before=topic&&oldRules[topic].test(row.text.slice(0,2000))?topic:null;
  const proposition=canonicalStanceProposition(row.text),after=Object.keys(STANCE_PROPOSITIONS).find(key=>STANCE_PROPOSITIONS[key]===proposition)??null;
  if(before)counts[before].before++;if(after)counts[after].after++;
  if(before!==after){if(after)counts[after].added++;if(before)counts[before].removed++;
   changes.push({id:row.id,before,after,title:row.title,body:row.text.slice(0,2000)});}
 }
 const report={articles:rows.length,counts,changed:changes.length,fireRelatedAdded:changes.filter(row=>row.after==='housing_supply'&&/화재|방화/.test(row.body)).length};
 fs.mkdirSync('.sites-runtime/body-position-20261113',{recursive:true});
 fs.writeFileSync('.sites-runtime/body-position-20261113/topic-changes.local.json',JSON.stringify(changes,null,2));
 fs.writeFileSync('.sites-runtime/body-position-20261113/topic-summary.local.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{await server.close();}
