import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const testDir=join(root,'build/smoke-fixtures'); await mkdir(join(testDir,'sessions'),{recursive:true});
const stamp=new Date().toISOString();
function session(id,provider,input,cached) {return [{type:'session_meta',payload:{id,cwd:'K:\\project',model_provider:provider,timestamp:stamp}},{type:'turn_context',payload:{model:'same-model'}},{type:'event_msg',timestamp:stamp,payload:{type:'token_count',info:{total_token_usage:{input_tokens:input,cached_input_tokens:cached,output_tokens:10,total_tokens:input+10}}}}].map(x=>JSON.stringify(x)).join('\n');}
for(const [id,provider,input,cached] of [['official','openai',100,60],['proxy','proxy',300,30],['unknown',undefined,70,0]]) await writeFile(join(testDir,`sessions/rollout-${id}.jsonl`),session(id,provider,input,cached));
const child=spawn(process.execPath,[process.argv[2]??join(root,'build/service/desktop.mjs')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,CODEX_HOME:testDir,LOTUS_DATA_DIR:join(testDir,'app-data')}});
let errors='';child.stderr.on('data',chunk=>{errors+=chunk.toString();});
try {
  const address=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Startup timed out '+errors)),15_000);
    const lines=createInterface({input:child.stdout});lines.on('line',line=>{try{const value=JSON.parse(line);if(value.port){clearTimeout(timer);resolve(value);}}catch{}});
    child.on('exit',code=>{clearTimeout(timer);reject(new Error(`Service exited ${code}: ${errors}`));});
  });
  const request=async(path,source='openai')=>{const response=await fetch(`http://127.0.0.1:${address.port}/api/${path}`,{headers:{'X-Lotus-Token':address.token,'X-Lotus-Source':source},signal:AbortSignal.timeout(15_000)});assert.equal(response.status,200,`${path}: ${await response.clone().text()}`);return response.json();};
  const anonymous=await fetch(`http://127.0.0.1:${address.port}/api/lotus/sources`);assert.equal(anonymous.status,401);
  const groups=await request('lotus/sources');assert.deepEqual(groups.map(g=>g.id),['openai','custom:proxy','unknown']);
  const [official,custom,unknown]=await Promise.all(['openai','custom:proxy','unknown'].map(source=>request('lotus/today',source)));
  assert.equal(official.tokens,110);assert.equal(custom.tokens,310);assert.equal(unknown.tokens,80);assert.equal(official.cacheHitRate,60);assert.equal(custom.cacheHitRate,10);
  for(const source of ['openai','custom:proxy']) {
    const [daily,projects,blocks,sessions]=await Promise.all(['daily?agent=codex','projects?agent=codex','blocks?agent=codex','session-analytics?agent=codex&range=all'].map(path=>request(path,source)));
    assert.equal(daily.totals.totalTokens,source==='openai'?110:310);
    assert.equal(Object.keys(projects.projects).length,1); assert.ok(blocks.blocks.length);
    assert.equal(sessions.sessions.length,1);
  }
  console.log(JSON.stringify({result:'passed',checks:'bundled worker, API authorization, parallel provider isolation, today hit rates, daily/projects/blocks/session analytics'}));
} finally {child.stdin.end();await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill();resolve();},2000).unref();});await rm(testDir,{recursive:true,force:true});}
