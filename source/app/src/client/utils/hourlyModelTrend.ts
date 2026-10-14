import type { BlockEntry } from '../../shared/types.js';
import { shortModelName } from './modelNames.js';

export interface HourlyModelBucket {
  hour: string;
  [model: string]: string | number;
}

export function buildHourlyModelTrend(
  blocks: BlockEntry[],
  metric: 'tokens' | 'usd',
  now = new Date(),
): HourlyModelBucket[] {
  const buckets: HourlyModelBucket[] = Array.from({ length: now.getHours() + 1 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, '0')}:00`,
  }));

  for (const block of blocks) {
    if (block.isGap) continue;
    const start = new Date(block.startTime);
    if (start.toDateString() !== now.toDateString() || start.getHours() > now.getHours()) continue;
    const bucket = buckets[start.getHours()];
    const add = (model: string, value: number) => {
      const name = shortModelName(model);
      bucket[name] = Number(bucket[name] ?? 0) + value;
    };

    if (block.modelBreakdowns?.length) {
      for (const model of block.modelBreakdowns) {
        add(model.modelName, metric === 'tokens' ? model.totalTokens : model.costUSD);
      }
    } else {
      // A legacy multi-model total cannot be attributed without event data.
      add(block.models.length === 1 ? block.models[0] : 'Other', metric === 'tokens' ? block.totalTokens : block.costUSD);
    }
  }

  return buckets;
}
