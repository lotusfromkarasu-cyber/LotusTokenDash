// Publish a version already verified by CI; re-runs only upload missing assets. Credentials stay in Git Credential Manager.
import './network.mjs';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
const [directory,commit,notesFile]=process.argv.slice(2);
if(!directory||!commit||!notesFile)throw new Error('Usage: node tools/release.mjs releases/vX.Y.Z <verified-commit> <release-notes.md>');
const version=basename(directory);if(!/^v\d+\.\d+\.\d+$/.test(version))throw new Error('Release directory must identify the version');
const git=process.platform==='win32'?'C:/Program Files/Git/cmd/git.exe':'git';
const raw=execFileSync(git,['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
const fields=Object.fromEntries(raw.trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
const headers={Authorization:`Bearer ${fields.password}`,Accept:'application/vnd.github+json'};
const body={tag_name:version,target_commitish:commit,name:`LotusTokenDash ${version} — Windows`,draft:false,prerelease:false,body:await readFile(notesFile,'utf8')};
const response=await fetch('https://api.github.com/repos/lotusfromkarasu-cyber/LotusTokenDash/releases',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60_000)});
let release;
if(response.ok) release=await response.json();
else if(response.status===422) {
  const existing=await fetch(`https://api.github.com/repos/lotusfromkarasu-cyber/LotusTokenDash/releases/tags/${version}`,{headers,signal:AbortSignal.timeout(60_000)});
  if(!existing.ok) throw new Error(`Release ${response.status}: ${await response.text()}`);
  release=await existing.json();
  console.log(`Release ${version} already exists; uploading missing assets`);
} else throw new Error(`Release ${response.status}: ${await response.text()}`);
const uploaded=new Set((release.assets??[]).map(asset=>asset.name));
for(const name of await readdir(directory)) {
  if(!/\.(exe|zip|txt)$/.test(name))continue;
  if(uploaded.has(name)){console.log(`Skipped ${name} (already on the release)`);continue;}
  const data=await readFile(join(directory,name));
  const url=release.upload_url.replace(/\{.*$/,'')+`?name=${encodeURIComponent(name)}`;
  const result=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:data,signal:AbortSignal.timeout(120_000)});
  if(!result.ok)throw new Error(`Upload ${name}: ${result.status}`);
  console.log(`Published ${name}`);
}
console.log(release.html_url);
