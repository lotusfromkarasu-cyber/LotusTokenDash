// Repository administration helper. Authentication stays in Git Credential Manager.
import './network.mjs';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const binary=process.platform==='win32'?'C:/Program Files/Git/cmd/git.exe':'git';
const raw=execFileSync(binary,['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
const fields=Object.fromEntries(raw.trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
const [method='GET',path='/user',file]=process.argv.slice(2);
const res=await fetch(`https://api.github.com${path}`,{method,headers:{Authorization:`Bearer ${fields.password}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(60_000)});
if(!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
if(file) {await writeFile(file,Buffer.from(await res.arrayBuffer()));console.log(`Saved ${file}`);}
else {const data=await res.json(); if(path==='/user')console.log(JSON.stringify({login:data.login,id:data.id}));
else if(data.workflow_runs)console.log(JSON.stringify(data.workflow_runs.map(({id,status,conclusion,head_sha,html_url})=>({id,status,conclusion,head_sha,html_url}))));
else if(data.jobs)console.log(JSON.stringify(data.jobs.map(({id,name,conclusion,steps})=>({id,name,conclusion,steps:steps?.filter(s=>s.conclusion==='failure'||s.status==='in_progress')}))));
else if(data.artifacts)console.log(JSON.stringify(data.artifacts.map(({id,name,size_in_bytes,archive_download_url})=>({id,name,size_in_bytes,archive_download_url}))));
else console.log(JSON.stringify(data));}
