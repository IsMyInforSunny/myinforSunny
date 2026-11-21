param([ValidateSet('supervise','lightning','deepseek','groq','training')][string]$Mode='supervise')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $taskRoot
$runtimePath=Join-Path $taskRoot '.sites-runtime/paired-voice-labels-20261116'
$stateFile=Join-Path $runtimePath 'optimized-supervisor.local.json'
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class LabelingExecutionState {
 [DllImport("kernel32.dll", SetLastError=true)] public static extern uint SetThreadExecutionState(uint flags);
}
'@
if($Mode -ne 'supervise'){
 [void][LabelingExecutionState]::SetThreadExecutionState(2147483649)
 try{
  $arguments=if($Mode -eq 'training'){@('scripts/label-training-monitor.mjs')}else{@('scripts/optimized-labeling.mjs',$Mode)}
  $nodeProcess=Start-Process -FilePath 'node.exe' -ArgumentList $arguments -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath ('optimized-'+$Mode+'.stdout.log')) -RedirectStandardError (Join-Path $runtimePath ('optimized-'+$Mode+'.stderr.log'))
  @{wrapperPid=$PID;nodePid=$nodeProcess.Id;model=$Mode;startedAt=(Get-Date -Format o)}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $runtimePath ('optimized-'+$Mode+'-process.local.json')) -Encoding utf8
  while(-not $nodeProcess.HasExited){Start-Sleep -Seconds 20;[void][LabelingExecutionState]::SetThreadExecutionState(2147483649);$nodeProcess.Refresh()}
  exit $nodeProcess.ExitCode
 }finally{[void][LabelingExecutionState]::SetThreadExecutionState(2147483648)}
}
function Read-Checkpoint([string]$Path){
 for($attempt=0;$attempt -le 5;$attempt++){try{return Get-Content -Raw -LiteralPath $Path -Encoding utf8|ConvertFrom-Json}catch{if($attempt -ge 5){throw};Start-Sleep -Milliseconds 100}}
}
$state=if(Test-Path -LiteralPath $stateFile){Read-Checkpoint $stateFile}else{[pscustomobject]@{startedAt=(Get-Date -Format o);restarts=[pscustomobject]@{};workers=[pscustomobject]@{}}}
$state|Add-Member -NotePropertyName supervisorPid -NotePropertyValue $PID -Force
$lastReport=[DateTime]::MinValue
function Save-State { $state|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $stateFile -Encoding utf8 }
function Start-LabelWorker([string]$name){
 $process=Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/labeling-supervisor.ps1','-Mode',$name) -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
 $state.workers|Add-Member -NotePropertyName $name -NotePropertyValue @{wrapperPid=$process.Id;startedAt=(Get-Date -Format o)} -Force
 Save-State
}
try{
 [void][LabelingExecutionState]::SetThreadExecutionState(2147483649)
 while($true){
  foreach($name in @('lightning','groq')){
   $workerFile=Join-Path $runtimePath ('optimized-'+$name+'-process.local.json')
   $progressFile=Join-Path $runtimePath ('optimized-'+$name+'-progress.local.json')
   $progress=if(Test-Path -LiteralPath $progressFile){Read-Checkpoint $progressFile}else{$null}
   $winnerFile=Join-Path $runtimePath 'second-label-winner.local.json'
   $winner=if(Test-Path -LiteralPath $winnerFile){Read-Checkpoint $winnerFile}else{$null}
   if($name -ne 'lightning' -and $winner -and $winner.model -ne $name){'other model completed90'|Set-Content -LiteralPath (Join-Path $runtimePath ('optimized-'+$name+'.stop'));continue}
   if($progress -and $progress.phase -in @('completed','finished_with_failures','pilot_failed','stopped_other_model_won')){continue}
   $worker=if(Test-Path -LiteralPath $workerFile){Read-Checkpoint $workerFile}else{$null}
   $alive=$false
   if($worker){$alive=$null -ne (Get-Process -Id $worker.nodePid -ErrorAction SilentlyContinue)}
   $stale=$progress -and ((Get-Date).ToUniversalTime()-[DateTime]::Parse($progress.updatedAt).ToUniversalTime()).TotalMinutes -gt 5
   if($progress -and -not $stale -and $progress.phase -notin @('daily_budget_wait')){
    $nowMilliseconds=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $lastAdvance=[Math]::Max([double]$progress.lastDispatchAt,[double]$progress.lastCompletionAt)
    $hasFutureDeadline=$false
    if($progress.inflightRequests){foreach($entry in $progress.inflightRequests.PSObject.Properties){if([double]$entry.Value.deadline -gt $nowMilliseconds){$hasFutureDeadline=$true}}}
    if($lastAdvance -gt 0 -and $nowMilliseconds-$lastAdvance -gt 300000 -and -not $hasFutureDeadline -and [double]$progress.blockedUntil -le $nowMilliseconds){$stale=$true}
   }
   if($alive -and $stale){Stop-Process -Id $worker.nodePid -ErrorAction SilentlyContinue;Stop-Process -Id $worker.wrapperPid -ErrorAction SilentlyContinue;$alive=$false}
   if(-not $alive){if($worker){$prior=if($state.restarts.PSObject.Properties[$name]){[int]$state.restarts.$name}else{0};$state.restarts|Add-Member -NotePropertyName $name -NotePropertyValue ($prior+1) -Force};Start-LabelWorker $name}
  }
  if(((Get-Date)-$lastReport).TotalMinutes -ge 30){
   $statusJson=& node scripts/optimized-labeling.mjs status
   $status=$statusJson|ConvertFrom-Json
   $row='| 라벨링 진행 (자동30분) | 평가 L{0}/90·D{1}/90·G{2}/90; 학습 의대{3}·최저{4}·원전{5}/120 | 처리 {6}/분;429 {7}회 | 예상종료 {8}; 갱신 {9} |' -f $status.lightning.evaluation,$status.deepseek.evaluation,$status.groq.evaluation,$status.lightning.training.medical_school_quota,$status.lightning.training.minimum_wage,$status.lightning.training.nuclear_energy,$status.lightning.ratePerMinute,([int]$status.lightning.rateLimited+[int]$status.deepseek.rateLimited+[int]$status.groq.rateLimited),$status.lightning.eta,(Get-Date -Format 'MM-dd HH:mm')
   $documentPath=Join-Path $taskRoot 'docs/BIAS_STATUS.md';$document=[IO.File]::ReadAllText($documentPath)
   if($document -match '(?m)^\| 라벨링 진행 \(자동30분\).*\|\s*$'){$document=[regex]::Replace($document,'(?m)^\| 라벨링 진행 \(자동30분\).*\|\s*$',$row)}else{$position=$document.IndexOf("`n",$document.IndexOf('| ---'));$document=$document.Insert($position+1,$row+"`n")}
   [IO.File]::WriteAllText($documentPath,$document,[Text.UTF8Encoding]::new($false));$lastReport=Get-Date
  }
  $state|Add-Member -NotePropertyName updatedAt -NotePropertyValue (Get-Date -Format o) -Force;Save-State
  $allFinished=$true
  foreach($name in @('lightning','groq')){
   $checkFile=Join-Path $runtimePath ('optimized-'+$name+'-progress.local.json')
   if(-not (Test-Path -LiteralPath $checkFile)){$allFinished=$false;continue}
   $check=Read-Checkpoint $checkFile
   if($check.phase -notin @('completed','finished_with_failures','pilot_failed','stopped_other_model_won')){$allFinished=$false}
  }
  if($allFinished){$state|Add-Member -NotePropertyName phase -NotePropertyValue 'all_label_workers_finished' -Force;Save-State;break}
  Start-Sleep -Seconds 120
 }
}finally{[void][LabelingExecutionState]::SetThreadExecutionState(2147483648)}
