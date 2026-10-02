// Run the packaged native WebView2/IPC/service chain without desktop automation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, rm, mkdtemp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const executable=resolve(process.argv[2]??'');
assert.ok(process.argv[2],'Usage: node tools/native-smoke.mjs <packaged executable>');
const directory=await mkdtemp(join(root,'build/native-smoke-'));
await mkdir(join(directory,'sessions'),{recursive:true});
const timestamp=new Date().toISOString();
await writeFile(join(directory,'sessions/rollout-native.jsonl'),[
  {type:'session_meta',payload:{id:'native-test',cwd:'K:\\native-test',model_provider:'openai',timestamp}},
  {type:'turn_context',payload:{model:'test-model'}},
  {type:'event_msg',timestamp,payload:{type:'token_count',info:{total_token_usage:{input_tokens:100,cached_input_tokens:60,output_tokens:10,total_tokens:110}}}},
].map(value=>JSON.stringify(value)).join('\n'));
try {
  // Second cold launch keeps the same test profile to exercise persisted state.
  for(let launch=1;launch<=2;launch++) {
    const data=join(directory,'app-data');
    await rm(join(data,'native-result.json'),{force:true});
    const child=spawn(executable,['--self-test'],{windowsHide:true,stdio:'ignore',env:{...process.env,CODEX_HOME:directory,LOTUS_TEST_DATA_DIR:data}});
    const exit=await new Promise((accept,reject)=>{
      const timer=setTimeout(()=>{child.kill();reject(new Error('Native smoke test timed out'));},90_000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);accept(code);});
    });
    let result;
    try {result=JSON.parse(await readFile(join(data,'native-result.json'),'utf8'));}
    catch {throw new Error(`Native launch ${launch} exited ${exit} without results. ${await readFile(join(data,'desktop.log'),'utf8').catch(()=>'No startup log')}`);}
    assert.equal(result.passed,true,result.message);
    assert.equal(exit,0);
    console.log(JSON.stringify({launch,...result}));
  }
} finally {
  assert.ok(directory.startsWith(join(root,'build/native-smoke-')));
  await rm(directory,{recursive:true,force:true});
}
