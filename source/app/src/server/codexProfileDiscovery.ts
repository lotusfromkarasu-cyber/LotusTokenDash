import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { getCodexHomes } from './codexDataSources.js';
import { normalizeDataPathList, readAppSettings, updateCodexCustomDataPaths } from './appSettings.js';

const DISCOVERY_COOLDOWN_MS = 60_000;
let lastCheck = 0;
let pending: Promise<boolean> | undefined;

/** The process query exports only user-data paths, never credentials or chat text. */
const WINDOWS_PROFILE_QUERY = String.raw`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$profileDirs = @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe' OR Name = 'Codex.exe'" | ForEach-Object {
  if ($_.ExecutablePath -match '(?i)(OpenAI\.Codex_|[\\/]OpenAI[\\/]Codex[\\/])') {
    $profileMatch = [regex]::Match($_.CommandLine, '(?i)(?:^|\s)--user-data-dir(?:=|\s+)(?:"([^"]+)"|([^\s]+))')
    if ($profileMatch.Success) {
      if ($profileMatch.Groups[1].Success) { $profileMatch.Groups[1].Value } else { $profileMatch.Groups[2].Value }
    }
  }
} | Select-Object -Unique)
ConvertTo-Json -InputObject $profileDirs -Compress
`;

export function runningCodexUserDataDirs(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROFILE_QUERY],
      { windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 }, (error, output) => {
        if (error) { resolve([]); return; }
        try {
          const paths: unknown = JSON.parse(output.trim().replace(/^\uFEFF/, ''));
          resolve(Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : []);
        } catch { resolve([]); }
      });
  });
}

/** The documented launcher keeps user-data below its isolated CODEX_HOME. */
export function codexHomesFromUserDataDirs(paths: string[]): string[] {
  const result: string[] = [];
  for (const path of paths) {
    let candidate = resolve(path);
    for (let depth = 0; depth < 4; depth++) {
      if (existsSync(join(candidate, 'config.toml'))
        && (existsSync(join(candidate, 'sessions')) || existsSync(join(candidate, 'archived_sessions')))) {
        result.push(candidate);
        break;
      }
      const parent = dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
  }
  return normalizeDataPathList(result);
}

/** Persist found homes so a closed second window's usage remains included. */
export function registerCodexProfileHomes(paths: string[]): boolean {
  const known = new Set(getCodexHomes().map(path => process.platform === 'win32' ? path.toLowerCase() : path));
  const added = paths.filter(path => !known.has(process.platform === 'win32' ? path.toLowerCase() : path));
  if (!added.length) return false;
  const current = readAppSettings().codex.customDataPaths;
  updateCodexCustomDataPaths([...current, ...added]);
  return true;
}

/** One coalesced, bounded query at startup and at most once per minute on refresh. */
export function refreshCodexProfileHomes(force = false): Promise<boolean> {
  if (process.env.TOKENDASH_DISABLE_PROFILE_DISCOVERY === '1' || process.platform !== 'win32') return Promise.resolve(false);
  if (pending) return pending;
  if (!force && Date.now() - lastCheck < DISCOVERY_COOLDOWN_MS) return Promise.resolve(false);
  lastCheck = Date.now();
  pending = runningCodexUserDataDirs()
    .then(paths => {
      // Keep the default instance when TokenDash inherited another CODEX_HOME.
      const candidates = [...paths, join(homedir(), '.codex')];
      return registerCodexProfileHomes(codexHomesFromUserDataDirs(candidates));
    })
    .catch(() => false)
    .finally(() => { pending = undefined; });
  return pending;
}
