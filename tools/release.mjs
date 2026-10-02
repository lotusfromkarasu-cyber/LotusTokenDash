// Publish a version already verified by CI. Credentials stay in Git Credential Manager.
import './network.mjs';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const [directory,commit]=process.argv.slice(2);if(!directory||!commit)throw new Error('Usage: node tools/release.mjs releases/v0.1.0 <verified-commit>');
const git=process.platform==='win32'?'C:/Program Files/Git/cmd/git.exe':'git';
const raw=execFileSync(git,['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
const fields=Object.fromEntries(raw.trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
const headers={Authorization:`Bearer ${fields.password}`,Accept:'application/vnd.github+json'};
const body={tag_name:'v0.1.0',target_commitish:commit,name:'LotusTokenDash v0.1.0 — Windows',draft:false,prerelease:false,
  body:'Windows 首版：悬浮 HUD、顶部吸附细条和悬停展开；5h / 7day 配额；按来源切换今日 token 与缓存命中率；独立 TokenDash 分析窗口；OpenAI 官方与各 custom provider 分组。\n\n提供 Windows x64 安装包和免安装包。保留 macOS / Linux 构建流程。\n\n验证：190 项解析测试、49 项界面用例、打包服务接口与来源隔离、本机真实 Codex 配额读取、Windows 原生编译。桌面拖动及多显示器交互需实际使用确认。'};
const response=await fetch('https://api.github.com/repos/lotusfromkarasu-cyber/LotusTokenDash/releases',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60_000)});
if(!response.ok)throw new Error(`Release ${response.status}: ${await response.text()}`);
const release=await response.json();
for(const name of await readdir(directory)) {
  if(!/\.(exe|zip|txt)$/.test(name))continue;
  const data=await readFile(join(directory,name));
  const url=release.upload_url.replace(/\{.*$/,'')+`?name=${encodeURIComponent(name)}`;
  const result=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(data.length)},body:data,signal:AbortSignal.timeout(120_000)});
  if(!result.ok)throw new Error(`Upload ${name}: ${result.status}`);
  console.log(`Published ${name}`);
}
console.log(release.html_url);
