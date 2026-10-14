import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codexHomesFromUserDataDirs, registerCodexProfileHomes } from '../../server/codexProfileDiscovery.js';
import { getCodexDataSourceRevision, getCodexHomes } from '../../server/codexDataSources.js';
import { readAppSettings, updateCodexCustomDataPaths } from '../../server/appSettings.js';
import { cache } from '../../server/cache.js';

const originalHome = process.env.CODEX_HOME;
const originalSettings = process.env.TOKENDASH_SETTINGS_FILE;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lotus-dual-profiles-'));
  process.env.CODEX_HOME = join(root, 'primary');
  process.env.TOKENDASH_SETTINGS_FILE = join(root, 'settings.json');
});
afterEach(() => {
  cache.clear();
  if (originalHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = originalHome;
  if (originalSettings === undefined) delete process.env.TOKENDASH_SETTINGS_FILE; else process.env.TOKENDASH_SETTINGS_FILE = originalSettings;
  rmSync(root, { recursive: true, force: true });
});
function profile(name: string, archive = false): string {
  const path = join(root, name);
  mkdirSync(join(path, archive ? 'archived_sessions' : 'sessions'), { recursive: true });
  writeFileSync(join(path, 'config.toml'), 'model_provider = "custom"');
  return path;
}
describe('Independent Codex desktop profiles', () => {
  it('finds a home from its user-data directory, including a path with spaces and nested web data', () => {
    const home = profile('second profile');
    expect(codexHomesFromUserDataDirs([join(home, 'user-data'), join(home, 'user-data', 'web', 'Codex')])).toEqual([home]);
  });
  it('does not add an ordinary browser directory or a backup config without transcripts', () => {
    const path = join(root, 'backup'); mkdirSync(path); writeFileSync(join(path, 'config.toml'), '');
    expect(codexHomesFromUserDataDirs([join(root, 'browser', 'user-data'), join(path, 'user-data')])).toEqual([]);
  });
  it('keeps manually added homes and persists detected profiles without duplicate registration', () => {
    const manual = profile('manual', true), second = profile('b');
    updateCodexCustomDataPaths([manual]);
    expect(registerCodexProfileHomes([second])).toBe(true);
    expect(registerCodexProfileHomes([second])).toBe(false);
    expect(readAppSettings().codex.customDataPaths).toEqual([manual, second]);
    expect(getCodexHomes()).toContain(second);
  });
  it('invalidates both memory and disk response caches as soon as a data path is added', () => {
    const initialRevision = getCodexDataSourceRevision();
    cache.set('dual-window', { tokens: 100 });
    registerCodexProfileHomes([profile('b')]);
    expect(getCodexDataSourceRevision()).not.toBe(initialRevision);
    expect(cache.get('dual-window')).toBeNull();
    expect(cache.getStale('dual-window')).toBeNull();
  });
});
