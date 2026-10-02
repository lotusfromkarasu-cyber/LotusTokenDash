import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const app=join(root,'source/app'); const runtime=join(root,'runtime/development');
function run(command,args,cwd=app) {
  const result=spawnSync(command,args,{cwd,stdio:'inherit',shell:process.platform==='win32'&&command.endsWith('.cmd'),windowsHide:true});
  if(result.status!==0) process.exit(result.status??1);
}
const task=process.argv[2];
if(task==='install') {
  mkdirSync(runtime,{recursive:true});
  for(const file of ['package.json','package-lock.json']) cpSync(join(app,file),join(runtime,file));
  run(process.platform==='win32'?'npm.cmd':'npm',['ci','--no-audit','--no-fund'],runtime);
  if(!existsSync(join(app,'node_modules'))) symlinkSync(join(runtime,'node_modules'),join(app,'node_modules'),process.platform==='win32'?'junction':'dir');
} else if(task==='test') {
  run(process.execPath,[join(app,'node_modules/typescript/bin/tsc'),'-p','tsconfig.json','--noEmit']);
  run(process.execPath,[join(app,'node_modules/typescript/bin/tsc'),'-p','tsconfig.frontend.json','--noEmit']);
  run(process.execPath,[join(app,'node_modules/vitest/vitest.mjs'),'run']);
} else if(task==='build') run(process.execPath,[join(root,'tools/build.mjs')],root);
else if(task==='desktop') {
  run(process.execPath,[join(app,'node_modules/@tauri-apps/cli/tauri.js'),'build',...process.argv.slice(3)],join(root,'source/desktop'));
} else { console.error('Usage: node tools/tasks.mjs install|test|build|desktop'); process.exit(1); }
