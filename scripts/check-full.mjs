import {spawnSync} from 'node:child_process';

const run=(command,args)=>{
 const result=spawnSync(command,args,{stdio:'inherit',shell:process.platform==='win32'});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
};
run('npm',['run','typecheck']);
run('npm',['test','--','--maxWorkers=4','--testTimeout=10000']);
run('npm',['run','build']);
run('git',['diff','--check']);
