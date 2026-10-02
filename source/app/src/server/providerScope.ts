import { AsyncLocalStorage } from 'node:async_hooks';

export const providerScope = new AsyncLocalStorage<string | undefined>();
/** Absent scope is used by upstream parser tests. Desktop requests always set a scope. */
export function currentProvider(): string | undefined { return providerScope.getStore(); }
export function providerId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'unknown';
  const id = value.trim();
  return id.toLowerCase() === 'openai' ? 'openai' : `custom:${id}`;
}
export function scopeKey(key: string): string { return `${currentProvider() ?? 'upstream'}::${key}`; }
export function selectProvider<T extends { provider?: string; tokenEvents: Array<{ provider?: string }> }>(sessions: T[], scope: string | null | undefined = currentProvider()): T[] {
  if (!scope) return sessions;
  return sessions.flatMap(session => {
    const events = session.tokenEvents.filter(event => (event.provider ?? session.provider ?? 'unknown') === scope);
    return events.length || (!session.tokenEvents.length && (session.provider ?? 'unknown') === scope)
      ? [{ ...session, provider: scope, tokenEvents: events }] : [];
  });
}
