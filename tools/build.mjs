import { build as bundle } from '../source/app/node_modules/esbuild/lib/main.js';
import { build as vite } from '../source/app/node_modules/vite/dist/node/index.js';
import { cp, mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const app = join(root, 'source/app');
process.chdir(app);
await vite({ root: app, configFile: join(app, 'vite.config.ts') });
const common = { bundle: true, platform: 'node', target: 'node22', format: 'esm',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  packages: 'bundle', sourcemap: false };
await bundle({ ...common, entryPoints:[join(app,'src/server/desktop.ts')], outfile:join(root,'build/service/desktop.mjs') });
await bundle({ ...common, entryPoints:[join(app,'src/server/codexResponseWorker.ts')], outfile:join(root,'build/service/worker.mjs') });
await writeFile(join(root,'build/package.json'), JSON.stringify({ name:'lotus-token-dash',version:JSON.parse(await readFile(join(app,'package.json'),'utf8')).version,type:'module' }));
const platform = process.platform;
const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
const triple = platform==='win32' ? `${arch}-pc-windows-msvc` : platform==='darwin' ? `${arch}-apple-darwin` : `${arch}-unknown-linux-gnu`;
const binaries=join(root,'runtime/desktop'); await mkdir(binaries,{recursive:true});
const binary=join(binaries,`lotus-node-${triple}${platform==='win32'?'.exe':''}`);
await cp(process.execPath,binary); if(platform!=='win32') await chmod(binary,0o755);
console.log(`Frontend, data service and ${triple} runtime prepared.`);
await import('./notices.mjs');
