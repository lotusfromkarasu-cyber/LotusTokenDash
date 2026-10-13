import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });
const output = join(root, 'build/macos-release');
await mkdir(output, { recursive: true });
const app = join(root, 'build/universal/LotusTokenDash.app');
const arm = join(root, 'build/inputs/arm64/LotusTokenDash.app');
const intel = join(root, 'build/inputs/x64/LotusTokenDash.app');
run('ditto', [arm, app]);
for (const name of ['lotus-token-dash', 'lotus-node']) {
  const relative = `Contents/MacOS/${name}`;
  run('lipo', ['-create', join(arm, relative), join(intel, relative), '-output', join(app, relative)]);
  run('lipo', [join(app, relative), '-verify_arch', 'arm64', 'x86_64']);
  run('codesign', ['--force', '--sign', '-', join(app, relative)]);
}
const resources = 'Contents/Resources/service';
for (const name of await readdir(join(arm, resources))) {
  const [a, b] = await Promise.all([readFile(join(arm, resources, name)), readFile(join(intel, resources, name))]);
  assert.ok(a.equals(b), `Architecture-dependent service resource: ${name}`);
}
run('codesign', ['--force', '--deep', '--sign', '-', app]);
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
run(process.execPath, ['tools/native-smoke.mjs', join(app, 'Contents/MacOS/lotus-token-dash')]);
const dmgRoot = join(root, 'build/dmg-root');
await mkdir(dmgRoot, { recursive: true });
run('ditto', [app, join(dmgRoot, 'LotusTokenDash.app')]);
run('ln', ['-s', '/Applications', join(dmgRoot, 'Applications')]);
const prefix = 'LotusTokenDash-0.1.6-macOS-universal';
run('hdiutil', ['create', '-volname', 'LotusTokenDash', '-srcfolder', dmgRoot, '-format', 'UDZO', join(output, `${prefix}.dmg`)]);
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, join(output, `${prefix}.zip`)]);
const metadata = {
  version: '0.1.6',
  originalSourceCommit: process.env.LOTUS_BASE_COMMIT,
  macOSBuildCommit: process.env.GITHUB_SHA,
  workflowRun: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  minimumMacOS: '13.5',
  architectures: ['arm64', 'x86_64'],
  signing: 'ad-hoc; not Apple notarized',
  checks: ['217 unit tests and TypeScript checks on both architectures', 'packaged service checks on both architectures', 'two native cold launches on each architecture', 'universal executable and Node runtime architecture checks', 'universal bundle signature verification', 'two universal native cold launches on Apple Silicon'],
};
await writeFile(join(output, 'BUILD.json'), `${JSON.stringify(metadata, null, 2)}\n`);
const readme = `LotusTokenDash 0.1.6 — macOS\n\n支持 macOS 13.5 及更新版本；同一安装包兼容 Apple 芯片（M1/M2/M3/M4 等）和 Intel Mac。\n已包含 Node 运行环境，无需另装 Node。\n\n安装：打开 DMG，将 LotusTokenDash.app 拖到 Applications（应用程序）文件夹，再从该文件夹启动。\n也可以解压 ZIP，将里面的 LotusTokenDash.app 放入 Applications。\n不要在安装镜像中直接运行，以便正常保存和更新。\n\n这是本地编译版，采用临时签名，未进行 Apple 公证。首次打开若被系统阻止，请在“系统设置 → 隐私与安全性”中选择“仍要打开”，并确认启动。\n\n首次运行读取这台 Mac 的会话目录和 Codex 登录状态；不会带入 Windows 电脑上的个人数据。\nCodex 未登录时，请先在 Mac 上安装并登录 Codex。来源不显示时，可在分析窗口的数据路径设置中指定本机目录。\n\n点击顶部菜单栏中的 LotusTokenDash 图标，可显示/隐藏 HUD、打开详细分析或退出。\n日志和窗口设置位于 ~/Library/Application Support/com.lotus.tokendash/。\n\n详细构建来源与检查记录见 BUILD.json。\n`;
await writeFile(join(output, '使用说明.txt'), readme);
const hashes = [];
for (const name of (await readdir(output)).sort()) {
  if (name === 'SHA256SUMS.txt') continue;
  const data = await readFile(join(output, name));
  hashes.push(`${createHash('sha256').update(data).digest('hex')}  ${name}`);
}
await writeFile(join(output, 'SHA256SUMS.txt'), `${hashes.join('\n')}\n`);
