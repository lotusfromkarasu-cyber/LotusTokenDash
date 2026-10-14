// Publish a verified build. Replacing an existing version requires --replace.
import './network.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
const [directory,commit,notesFile,option]=process.argv.slice(2);
if(!directory||!commit||!notesFile||(option&&option!=='--replace'))throw new Error('Usage: node tools/release.mjs releases/vX.Y.Z <verified-commit> <release-notes.md> [--replace]');
const replace=option==='--replace';
const version=basename(directory);if(!/^v\d+\.\d+\.\d+$/.test(version))throw new Error('Release directory must identify the version');
const git=process.platform==='win32'?'C:/Program Files/Git/cmd/git.exe':'git';
const raw=execFileSync(git,['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
const fields=Object.fromEntries(raw.trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
const headers={Authorization:`Bearer ${fields.password}`,Accept:'application/vnd.github+json'};
const api='https://api.github.com/repos/lotusfromkarasu-cyber/LotusTokenDash';
async function githubJson(path,method,body) {
  const response=await fetch(`${api}${path}`,{method,headers:{...headers,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60_000)});
  if(!response.ok)throw new Error(`GitHub ${method} ${path}: ${response.status}`);
  return response.status===204?null:response.json();
}
const body={tag_name:version,target_commitish:commit,name:`LotusTokenDash ${version} — Windows`,draft:false,prerelease:false,body:await readFile(notesFile,'utf8')};
const response=await fetch('https://api.github.com/repos/lotusfromkarasu-cyber/LotusTokenDash/releases',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60_000)});
let release;
if(response.ok) release=await response.json();
else if(response.status===422) {
  const existing=await fetch(`https://api.github.com/repos/lotusfromkarasu-cyber/LotusTokenDash/releases/tags/${version}`,{headers,signal:AbortSignal.timeout(60_000)});
  if(!existing.ok) throw new Error(`Release ${response.status}: ${await response.text()}`);
  release=await existing.json();
  console.log(`Release ${version} already exists; ${replace?'replacing verified assets':'uploading missing assets'}`);
} else throw new Error(`Release ${response.status}: ${await response.text()}`);
const assets=new Map((release.assets??[]).map(asset=>[asset.name,asset]));
for(const name of await readdir(directory)) {
  if(!/\.(exe|zip|txt)$/.test(name))continue;
  // GitHub renamed the old non-ASCII instructions filename to default.txt.
  const existing=assets.get(name)??(name==='Instructions.txt'?assets.get('default.txt'):undefined);
  if(existing&&!replace){console.log(`Skipped ${name} (already on the release)`);continue;}
  const data=await readFile(join(directory,name));
  const digest=`sha256:${createHash('sha256').update(data).digest('hex')}`;
  if(existing?.digest===digest){
    if(existing.name!==name)await githubJson(`/releases/assets/${existing.id}`,'PATCH',{name});
    console.log(`Verified ${name} (already matches)`);continue;
  }
  // Keep the previous asset downloadable until its replacement has uploaded.
  const uploadName=existing?`${name}.replacement`:name;
  let replacement=assets.get(uploadName);
  if(replacement?.digest!==digest) {
    if(replacement)await githubJson(`/releases/assets/${replacement.id}`,'DELETE');
    const url=release.upload_url.replace(/\{.*$/,'')+`?name=${encodeURIComponent(uploadName)}`;
    const result=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:data,signal:AbortSignal.timeout(120_000)});
    if(!result.ok)throw new Error(`Upload ${name}: ${result.status}`);
    replacement=await result.json();
    if(replacement.digest&&replacement.digest!==digest)throw new Error(`Upload digest mismatch: ${name}`);
  }
  if(existing) {
    await githubJson(`/releases/assets/${existing.id}`,'DELETE');
    await githubJson(`/releases/assets/${replacement.id}`,'PATCH',{name});
  }
  console.log(`Published ${name}`);
}
if(replace) {
  await githubJson(`/git/refs/tags/${version}`,'PATCH',{sha:commit,force:true});
  await githubJson(`/releases/${release.id}`,'PATCH',body);
  console.log(`Updated ${version} to verified commit ${commit}`);
}
console.log(release.html_url);
