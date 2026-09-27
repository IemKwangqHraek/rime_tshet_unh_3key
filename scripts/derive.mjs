// 本地查詢入口；同時供測試使用，推導器只需根目錄的 prengQvm.js。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import TshetUinh from 'tshet-uinh';
import { 推導方案 } from 'tshet-uinh-deriver-tools';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const source = fs.readFileSync(path.join(root, 'prengQvm.js'), 'utf8');
export const raw = new Function('選項', '音韻地位', '字頭', 'require', source);
export const scheme = new 推導方案(raw);
export { TshetUinh };

function main(args) {
  const [kind, ...queries] = args;
  if (!['--position', '--char'].includes(kind) || !queries.length) {
    throw new Error('用法：npm run derive -- --position 端一冬平；或 npm run derive -- --char 冬 豪 怎');
  }
  const full = scheme();
  const triple = scheme({ 輸出: '三拼' });
  const segments = scheme({ 輸出: '三段' });
  for (const query of queries) {
    if (kind === '--char' && query === '怎') {
      console.log(JSON.stringify({ 字頭: '怎', 來源: '本方案補充音節', 全拼: raw({}, null, '怎'),
        三段: raw({ 輸出: '三段' }, null, '怎'), 三拼: raw({ 輸出: '三拼' }, null, '怎') }));
      continue;
    }
    const entries = kind === '--position'
      ? [{ 音韻地位: TshetUinh.音韻地位.from描述(query), 字頭: null }]
      : TshetUinh.資料.query字頭(query);
    if (!entries.length) throw new Error(`內建資料沒有「${query}」`);
    for (const entry of entries) {
      const p = entry.音韻地位;
      console.log(JSON.stringify({ 字頭: entry.字頭, 地位: p.描述, 反切: entry.反切,
        全拼: full(p, entry.字頭), 三段: segments(p, entry.字頭), 三拼: triple(p, entry.字頭) }));
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
