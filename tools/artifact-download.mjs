// Bounded range downloads survive proxies that close long artifact transfers.
import { open, stat, rename, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function downloadArtifact(apiUrl, file, headers) {
  const metadataResponse = await fetch(apiUrl.replace(/\/zip$/, ''), { headers, signal: AbortSignal.timeout(60_000) });
  if (!metadataResponse.ok) throw new Error(`Artifact metadata HTTP ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  let signedUrl;
  const sign = async () => {
    const response = await fetch(apiUrl, { headers, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
    const location = response.headers.get('location');
    if (response.status !== 302 || !location?.startsWith('https://')) throw new Error(`Artifact redirect HTTP ${response.status}`);
    signedUrl = location;
  };
  await sign();
  const range = async (start, end) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(signedUrl, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(60_000) });
        if (response.status === 403) { await sign(); continue; }
        if (response.status !== 206) throw new Error(`Artifact range HTTP ${response.status}`);
        const contentRange = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (!contentRange || Number(contentRange[1]) !== start || Number(contentRange[2]) !== end) throw new Error('Unexpected artifact range');
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length !== end - start + 1) throw new Error('Incomplete artifact range');
        return { buffer, total: Number(contentRange[3]) };
      } catch (error) { if (attempt === 3) throw error; }
    }
    throw new Error('Artifact range unavailable');
  };
  const { total } = await range(0, 0);
  const partial = `${file}.part`;
  let offset = (await stat(partial).catch(() => null))?.size ?? 0;
  if (offset > total) throw new Error('Existing artifact partial is too large');
  const handle = await open(partial, 'a');
  try {
    const chunkSize = 1024 * 1024;
    while (offset < total) {
      const jobs = [];
      for (let i = 0; i < 4 && offset + i * chunkSize < total; i++) {
        const start = offset + i * chunkSize;
        jobs.push(range(start, Math.min(start + chunkSize - 1, total - 1)));
      }
      const chunks = await Promise.all(jobs);
      for (const { buffer } of chunks) { await handle.write(buffer); offset += buffer.length; }
      console.log(`Artifact ${metadata.id}: ${Math.round(offset / total * 100)}%`);
    }
  } finally { await handle.close(); }
  if (metadata.digest?.startsWith('sha256:')) {
    const actual = createHash('sha256').update(await readFile(partial)).digest('hex');
    if (actual !== metadata.digest.slice(7)) throw new Error('Artifact SHA256 mismatch');
  }
  await rename(partial, file);
  console.log(`Saved ${file}`);
}
