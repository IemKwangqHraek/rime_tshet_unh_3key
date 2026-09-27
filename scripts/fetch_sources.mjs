// 上游副本只存入已忽略的 .cache，不執行下載的 JavaScript。
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sources = JSON.parse(await fs.readFile(path.join(root, 'data/sources.json'), 'utf8'));
const cache = path.join(root, '.cache/upstream');
await fs.mkdir(cache, { recursive: true });
const sha256 = data => createHash('sha256').update(data).digest('hex');
for (const info of [sources.guangyun, sources.original_scheme]) {
  const url = info.source_url || info.download_url;
  const expected = info.source_sha256 || info.sha256;
  const target = path.join(cache, info.cache_file);
  let cached;
  try { cached = await fs.readFile(target); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (cached) {
    if (sha256(cached) !== expected) throw new Error(`${info.cache_file} 快取校驗失敗，請檢查後移開該檔再重試`);
    console.log(`已校驗快取：${info.cache_file}`);
    continue;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`下載失敗 ${response.status}：${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== expected) throw new Error(`SHA-256 不符：${url}`);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  console.log(`已下載並校驗：${info.cache_file}`);
}
