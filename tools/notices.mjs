import { readFileSync, existsSync } from 'node:fs';
import './network.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const app=join(root,'source/app');const modules=join(app,'node_modules');
const seen=new Set();let text='# Third-party notices\n\nLotusTokenDash incorporates TokenDash under the MIT license.\n\n';
text+=readFileSync(join(app,'LICENSE'),'utf8')+'\n\n';
function collect(name,parent=app) {
  let directory=join(parent,'node_modules',name);
  if(!existsSync(join(directory,'package.json'))) directory=join(modules,name);
  if(!existsSync(join(directory,'package.json')))return;
  const pkg=JSON.parse(readFileSync(join(directory,'package.json'),'utf8'));
  const id=`${pkg.name}@${pkg.version}`;if(seen.has(id))return;seen.add(id);
  text+=`\n---\n\n## ${id}\n\nLicense: ${pkg.license??'See upstream notice'}\n\n`;
  for(const filename of ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md','COPYING']) {
    if(existsSync(join(directory,filename))){text+=readFileSync(join(directory,filename),'utf8')+'\n';break;}
  }
  for(const dependency of Object.keys(pkg.dependencies??{}))collect(dependency,directory);
}
for(const name of Object.keys(JSON.parse(readFileSync(join(app,'package.json'),'utf8')).dependencies))collect(name);
const response=await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,{signal:AbortSignal.timeout(45_000)});
if(!response.ok)throw new Error(`Node license: ${response.status}`);
text+=`\n---\n\n## Node.js ${process.version}\n\n${await response.text()}`;
const out=join(root,'source/desktop/resources/service');await mkdir(out,{recursive:true});
await writeFile(join(out,'THIRD_PARTY_NOTICES.md'),text);
console.log(`Included notices for ${seen.size} packages and Node.js.`);
