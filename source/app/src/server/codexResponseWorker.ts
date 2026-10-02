import { parentPort } from 'node:worker_threads';
import * as parser from './codexParser.js';
import { providerScope } from './providerScope.js';
import type { AggregateOptions } from './codexParser.js';
import { type BlockGranularity } from './claudeJsonlParser.js';

type CodexParserModule = typeof import('./codexParser.js');

interface SerializedAggregateOptions {
  groupBy?: AggregateOptions['groupBy'];
  project?: string | null;
  since?: string | null;
  until?: string | null;
  timezone?: string;
  granularity?: BlockGranularity;
}

type WorkerRequest = { provider?: string } & (
  | { id: number; kind: 'bundle'; options?: SerializedAggregateOptions }
  | { id: number; kind: 'daily'; options?: SerializedAggregateOptions }
  | { id: number; kind: 'projects'; options?: SerializedAggregateOptions }
  | { id: number; kind: 'blocks'; options?: SerializedAggregateOptions }
  | { id: number; kind: 'groups'; options?: SerializedAggregateOptions });

function deserializeOptions(options?: SerializedAggregateOptions): Partial<AggregateOptions> & { granularity?: BlockGranularity } | undefined {
  if (!options) return undefined;
  return {
    groupBy: options.groupBy,
    project: options.project,
    since: options.since == null ? options.since : new Date(options.since),
    until: options.until == null ? options.until : new Date(options.until),
    timezone: options.timezone,
    granularity: options.granularity,
  };
}

async function run(request: WorkerRequest): Promise<unknown> {
  const options = deserializeOptions(request.options);
  switch (request.kind) {
    case 'groups': return parser.getProviderGroups();
    case 'daily':
      return parser.getDailyResponse(options);
    case 'projects':
      return parser.getProjectsResponse(options);
    case 'blocks':
      return parser.getBlocksResponse(options);
    case 'bundle':
      return parser.getCodexResponses(options);
  }
}

parentPort?.on('message', (request: WorkerRequest) => {
  void providerScope.run(request.provider, () => run(request))
    .then(data => parentPort?.postMessage({ id: request.id, ok: true, data }))
    .catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      parentPort?.postMessage({ id: request.id, ok: false, error: message, stack });
    });
});
