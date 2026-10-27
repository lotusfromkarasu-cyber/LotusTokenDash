// Exercise the packaged Agent Speed bridge against two isolated Codex homes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const directory=await mkdtemp(join(root,'build/speed-smoke-'));
const first=join(directory,'first'),second=join(directory,'second');
const firstSessions=join(first,'sessions'),secondSessions=join(second,'sessions');
await Promise.all([mkdir(firstSessions,{recursive:true}),mkdir(secondSessions,{recursive:true}),mkdir(join(directory,'data'),{recursive:true})]);
const base=Date.now()-10_000;
const line=(when,type,payload)=>JSON.stringify({timestamp:new Date(when).toISOString(),type,payload});
function session(id,output) {
  const usage={input_tokens:1000,cached_input_tokens:500,output_tokens:output,total_tokens:1000+output};
  return [line(base-500,'session_meta',{id,cwd:join(directory,id),model_provider:'openai'}),
    line(base,'turn_context',{model:'gpt-6.1-sol'}),line(base,'event_msg',{type:'task_started',turn_id:'one'}),
    line(base+5000,'event_msg',{type:'token_count',info:{total_token_usage:usage,last_token_usage:usage}}),
    line(base+5100,'event_msg',{type:'task_complete'})].join('\n')+'\n';
}
const firstFile=join(firstSessions,'rollout-first.jsonl');
await writeFile(firstFile,session('first',100));
await writeFile(join(secondSessions,'rollout-second.jsonl'),session('second',200));
const executable=process.argv[2]??join(root,'build/service',process.platform==='win32'?'lotus-speed.exe':'lotus-speed');
const child=spawn(executable,[],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,CODEX_HOME:first,
  LOTUS_DATA_DIR:join(directory,'data'),LOTUS_SPEED_CODEX_ROOTS:JSON.stringify([firstSessions,secondSessions]),LOTUS_SPEED_TEST_CODEX_ONLY:'1'}});
let latest,history,errors='';
child.stderr.on('data',chunk=>{errors+=String(chunk);});
createInterface({input:child.stdout}).on('line',line=>{try {const data=JSON.parse(line);if(data.kind==='snapshot')latest=data;if(data.kind==='history')history=data;}catch{}});
const wait=async(predicate,label)=>{
  const end=Date.now()+30_000;
  while(Date.now()<end){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,150));}
  throw new Error(`${label} timed out: ${errors}`);
};
try {
  await wait(()=>latest?.state==='Running'&&latest.today.output===300,'two-home speed seed');
  assert.equal(latest.today.requests,2);assert.ok(Math.abs(latest.average-30)<.1);
  const active=Date.now();
  await appendFile(firstFile,line(active,'event_msg',{type:'task_started',turn_id:'two'})+'\n');
  await wait(()=>latest?.generating>0&&latest.live>0,'live estimated speed');
  assert.ok(latest.estimatedShare>0);
  child.stdin.write('history\n');
  await wait(()=>history?.state==='Ready','speed history');
  assert.equal(history.days.filter(day=>day.source==='Codex').reduce((sum,day)=>sum+day.totals.output,0),300);
  console.log(JSON.stringify({result:'passed',checks:'two Codex homes, measured average, live in-flight estimate and persisted history'}));
} finally {
  child.stdin.end();
  await new Promise(resolveExit=>{if(child.exitCode!==null)return resolveExit();child.once('exit',resolveExit);setTimeout(()=>{child.kill();resolveExit();},5000).unref();});
  assert.ok(resolve(directory).startsWith(resolve(root,'build')+sep));
  await rm(directory,{recursive:true,force:true});
}
