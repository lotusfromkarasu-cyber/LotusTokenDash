import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { codexSessionDirsForDataPath, getCodexHomes } from './codexDataSources.js';

let child: ChildProcessWithoutNullStreams | undefined;
let rootsKey = '';
let snapshot: unknown = null;
let history: unknown = null;
let historyRequested = false;
let failure = '';

function start(): void {
  const roots = getCodexHomes().flatMap(home=>codexSessionDirsForDataPath(home).filter(path=>basename(path)==='sessions'||basename(home)==='archived_sessions')).filter(existsSync);
  const key = JSON.stringify(roots);
  if (child && key === rootsKey) return;
  stopSpeedService();
  rootsKey = key;
  snapshot = null; history = null; historyRequested = false; failure = '';
  const directory = dirname(fileURLToPath(import.meta.url));
  const executable = process.env.LOTUS_SPEED_BRIDGE ?? join(directory, process.platform === 'win32' ? 'lotus-speed.exe' : 'lotus-speed');
  if (!existsSync(executable)) { failure = 'Speed monitor is unavailable'; return; }
  const running = spawn(executable, [], {
    windowsHide:true, stdio:['pipe','pipe','pipe'],
    env:{...process.env, LOTUS_SPEED_CODEX_ROOTS:key},
  });
  child = running;
  running.stderr.resume();
  createInterface({input:running.stdout}).on('line', line => {
    try {
      const message = JSON.parse(line) as {kind?:string};
      if (child !== running) return;
      if (message.kind === 'snapshot') snapshot = message;
      else if (message.kind === 'history') history = message;
    } catch { /* Ignore incomplete or diagnostic lines. */ }
  });
  running.on('error', () => { if (child === running) { failure = 'Speed monitor failed to start'; child = undefined; } });
  running.on('exit', () => { if (child === running) { failure = 'Speed monitor stopped'; child = undefined; } });
}

export function speedSnapshot() {
  start();
  return {available:!!child, error:failure || undefined, snapshot};
}

export function speedHistory(refresh = false) {
  start();
  if (child && (!historyRequested || refresh)) {
    child.stdin.write('history\n');
    historyRequested = true;
  }
  return {available:!!child, error:failure || undefined, history};
}

export function stopSpeedService(): void {
  const previous = child;
  child = undefined;
  if (previous) { previous.stdin.end(); previous.kill(); }
}
