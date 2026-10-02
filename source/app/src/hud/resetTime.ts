/** Compact local date/time with a full, localized tooltip. No guessed reset dates. */
export function resetTime(value: string | undefined, language: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const pad = (number: number) => String(number).padStart(2, '0');
  return {
    dateTime: date.toISOString(),
    compact: `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
    full: new Intl.DateTimeFormat(language, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
    }).format(date),
  };
}
