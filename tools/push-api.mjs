// Push verified Git trees through REST when Git HTTPS is unavailable. GitHub normalizes dates to UTC.
import { execFileSync } from 'node:child_process';
const git=process.platform==='win32'?'C:/Program Files/Git/cmd/git.exe':'git';
const run=(...args)=>execFileSync(git,args,{windowsHide:true});
const string=(...args)=>run(...args).toString('utf8').trim();
const raw=execFileSync(git,['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
const fields=Object.fromEntries(raw.trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
const repo='/repos/lotusfromkarasu-cyber/LotusTokenDash';
async function api(path,method='GET',body) {
  const res=await fetch(`https://api.github.com${repo}${path}`,{method,headers:{Authorization:`Bearer ${fields.password}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60_000)});
  if(!res.ok)throw new Error(`${path}: ${res.status} ${await res.text()}`);return res.json();
}
const remote=await api('/git/ref/heads/main');
const commits=string('rev-list','--reverse',`${remote.object.sha}..HEAD`).split('\n').filter(Boolean);
const originalHead=string('rev-parse','HEAD'); const uploaded=new Map();
for(const sha of commits) {
  const parent=string('rev-parse',`${sha}^`);const parentTree=string('rev-parse',`${parent}^{tree}`);
  const changed=string('diff-tree','--no-commit-id','--name-only','-r','--no-renames',sha).split('\n').filter(Boolean);
  const tree=[];
  for(const path of changed) {
    const entry=string('ls-tree',sha,'--',path);
    if(!entry) {tree.push({path,mode:'100644',type:'blob',sha:null});continue;}
    const [mode,type,blob]=entry.split(/\s+/);
    const result=await api('/git/blobs','POST',{content:run('cat-file','blob',blob).toString('base64'),encoding:'base64'});
    if(result.sha!==blob)throw new Error(`Blob mismatch: ${path}`);
    tree.push({path,mode,type,sha:blob});
  }
  const createdTree=await api('/git/trees','POST',{base_tree:parentTree,tree});
  if(createdTree.sha!==string('rev-parse',`${sha}^{tree}`))throw new Error('Tree mismatch');
  const identity=string('show','-s','--format=%an%n%ae%n%aI%n%cn%n%ce%n%cI',sha).split('\n');
  const message=run('show','-s','--format=%B',sha).toString('utf8').trimEnd();
  const remoteParent=uploaded.get(parent)??parent;
  const commit=await api('/git/commits','POST',{message,tree:createdTree.sha,parents:[remoteParent],author:{name:identity[0],email:identity[1],date:identity[2]},committer:{name:identity[3],email:identity[4],date:identity[5]}});
  const author=commit.author; const committer=commit.committer;
  const object=`tree ${createdTree.sha}\nparent ${remoteParent}\nauthor ${author.name} <${author.email}> ${Date.parse(author.date)/1000} +0000\ncommitter ${committer.name} <${committer.email}> ${Date.parse(committer.date)/1000} +0000\n\n${message}\n`;
  const local=execFileSync(git,['hash-object','-t','commit','-w','--stdin'],{input:object,encoding:'utf8',windowsHide:true}).trim();
  if(local!==commit.sha)throw new Error('Git commit verification mismatch');
  uploaded.set(sha,commit.sha);console.log(`Uploaded verified commit ${commit.sha.slice(0,8)}`);
}
const head=uploaded.get(originalHead)??originalHead;await api('/git/refs/heads/main','PATCH',{sha:head,force:false});
run('update-ref','refs/heads/main',head,originalHead);run('update-ref','refs/remotes/origin/main',head);console.log(`main synchronized: ${head}`);
