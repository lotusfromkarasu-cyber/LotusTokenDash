import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCodexSession, getCodexResponses, getProviderGroups } from '../../server/codexParser.js';
import { providerScope, selectProvider } from '../../server/providerScope.js';
import { cache } from '../../server/cache.js';
import { clearUsageFileIndexMemory } from '../../server/usageFileIndex.js';
import { cacheHitRate } from '../../client/utils/cacheCalculations.js';

const dirs:string[]=[];
const original={...process.env};
afterEach(()=> { process.env.CODEX_HOME=original.CODEX_HOME; process.env.TOKENDASH_SETTINGS_FILE=original.TOKENDASH_SETTINGS_FILE; process.env.TOKENDASH_USAGE_INDEX_DIR=original.TOKENDASH_USAGE_INDEX_DIR; clearUsageFileIndexMemory(); cache.clear(); for(const dir of dirs.splice(0)) rmSync(dir,{recursive:true,force:true}); });
function usage(n:number, cached:number, timestamp:string) { return { type:'event_msg',timestamp,payload:{type:'token_count',info:{total_token_usage:{input_tokens:n,cached_input_tokens:cached,output_tokens:10,total_tokens:n+10}}}}; }
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'lotus-provider-')); dirs.push(root);
  process.env.CODEX_HOME=root; process.env.TOKENDASH_SETTINGS_FILE=join(root,'settings.json'); process.env.TOKENDASH_USAGE_INDEX_DIR=join(root,'index');
  mkdirSync(join(root,'sessions')); const path=join(root,'sessions','mixed.jsonl');
  writeFileSync(path,[{type:'session_meta',payload:{id:'mixed',cwd:'K:\\research\\paper',model_provider:'openai',timestamp:'2026-10-02T01:00:00Z'}},
    {type:'turn_context',payload:{model:'same-model'}},usage(100,60,'2026-10-02T01:00:01Z'),
    {type:'turn_context',payload:{model:'same-model',model_provider:'proxy'}},usage(300,80,'2026-10-02T01:00:02Z')].map(x=>JSON.stringify(x)).join('\n'));
  return path;
}
describe('Lotus provider isolation',()=> {
  it('splits a provider change within one conversation without re-counting cumulative usage',()=> {
    const session=parseCodexSession(fixture())!;
    const official=selectProvider([session],'openai')[0]; const custom=selectProvider([session],'custom:proxy')[0];
    expect(official.tokenEvents[0].inputTokens).toBe(100);
    expect(custom.tokenEvents[0].inputTokens).toBe(200);
    expect(custom.tokenEvents[0].cachedInputTokens).toBe(20);
    expect(official.tokenEvents).toHaveLength(1); expect(custom.tokenEvents).toHaveLength(1);
  });
  it('keeps daily, projects and blocks cached under the selected provider',()=> {
    fixture();
    const official=providerScope.run('openai',()=>getCodexResponses());
    const custom=providerScope.run('custom:proxy',()=>getCodexResponses());
    const again=providerScope.run('openai',()=>getCodexResponses());
    expect(official.daily.totals.totalTokens).toBe(110); expect(custom.daily.totals.totalTokens).toBe(200);
    expect(again).toEqual(official); expect(Object.keys(custom.projects.projects)).toEqual(['paper']);
    expect(custom.blocks.blocks.reduce((sum,b)=>sum+b.totalTokens,0)).toBe(200);
    expect(providerScope.run('openai',()=>getProviderGroups()).map(group=>group.id)).toEqual(['openai','custom:proxy']);
  });
  it('never infers official usage from a model name, and uses weighted input hit rate',()=> {
    const session=parseCodexSession(fixture())!; delete session.provider; for(const event of session.tokenEvents) delete event.provider;
    expect(selectProvider([session],'openai')).toEqual([]); expect(selectProvider([session],'unknown')).toHaveLength(1);
    expect(cacheHitRate(80,220)).toBeCloseTo(26.666666);
  });
  it('isolates concurrent HTTP cache scopes',async()=> {
    await Promise.all(['openai','custom:proxy'].map(source=>providerScope.run(source,async()=>{
      cache.set('daily:codex',{source}); await new Promise(resolve=>setTimeout(resolve,2)); expect(cache.get('daily:codex')).toEqual({source});
    })));
  });
});
