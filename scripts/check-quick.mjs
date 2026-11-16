import {spawnSync} from 'node:child_process';

const run=(command,args)=>{
 const result=spawnSync(command,args,{stdio:'inherit',shell:process.platform==='win32'});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
};
const changed=new Set();
for(const args of [['diff','--name-only','HEAD'],['ls-files','--others','--exclude-standard']]){
 const result=spawnSync('git',args,{encoding:'utf8'});
 if(result.status!==0)throw new Error(`git ${args.join(' ')} failed`);
 for(const file of result.stdout.split(/\r?\n/).filter(Boolean))changed.add(file.replaceAll('\\','/'));
}
const tests=[...changed].filter(file=>/^tests\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
const sources=[...changed].filter(file=>!file.startsWith('tests/')&&!file.startsWith('docs/')&&!file.startsWith('.sites-runtime/')&&/\.[cm]?[jt]sx?$/.test(file));
run('npm',['run','typecheck']);
if(tests.length)run('npm',['test','--','--maxWorkers=4','--testTimeout=10000',...tests]);
if(sources.length)run('npm',['exec','--','vitest','related','--run','--maxWorkers=4','--testTimeout=10000',...sources]);
if(!tests.length&&!sources.length)process.stdout.write('check:quick: 변경된 소스·테스트가 없어 관련 테스트를 건너뛰었습니다.\n');
