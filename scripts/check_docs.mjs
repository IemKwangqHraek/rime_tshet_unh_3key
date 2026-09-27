// 防止發佈時相對連結失效、文檔鍵表或例字與已驗證碼表脫節。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './derive.mjs';

const readTSV = file => fs.readFileSync(path.join(root, file), 'utf8')
  .split('\n').filter(Boolean).map(line => line.split('\t'));
const [, ...positions] = readTSV('data/positions.tsv');
const byCode = new Map(positions.map(row => [row[5], row]));
const [, ...keyboard] = readTSV('data/keyboard.tsv');
const files = ['ReadMe.md', ...fs.readdirSync(path.join(root, 'docs'))
  .filter(name => name.endsWith('.md')).map(name => `docs/${name}`)];
let links = 0, examples = 0;
for (const file of files) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [, url] of content.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(url)) continue;
    const target = path.resolve(root, path.dirname(file), decodeURIComponent(url.split('#')[0]));
    assert.ok(target.startsWith(root), `連結超出倉庫：${file} → ${url}`);
    assert.ok(!target.includes('/local-history/') && !target.includes('/.cache/'), `連到未發佈內容：${file} → ${url}`);
    assert.ok(fs.existsSync(target), `失效連結：${file} → ${url}`);
    links++;
  }
  for (const line of content.split('\n').filter(line => line.startsWith('|'))) {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    const code = cells.find(cell => /^`[A-Z]{3}`$/.test(cell))?.slice(1, -1);
    if (!code) continue;
    const expected = byCode.get(code);
    assert.ok(expected, `未知三鍵：${file} / ${code}`);
    const full = cells.find(cell => /^`[a-z]+`$/.test(cell))?.slice(1, -1);
    if (full) assert.equal(full, expected[1], `${file} / ${code}`);
    const partCell = cells.find(cell => /^`[a-z∅]+ \/ [a-z∅]+ \/ [a-z∅]+`$/.test(cell));
    if (partCell) assert.deepEqual(partCell.slice(1, -1).split(' / ').map(s => s === '∅' ? '' : s), expected.slice(2, 5), `${file} / ${code}`);
    examples++;
  }
}
const guide = fs.readFileSync(path.join(root, 'docs/全拼與三拼方案.md'), 'utf8');
const table = guide.split('<!-- keyboard:start -->')[1]?.split('<!-- keyboard:end -->')[0];
assert.ok(table, '文檔缺少鍵表標記');
const actual = table.split('\n').filter(line => /^\| [A-Z] \|/.test(line)).map(line => {
  const cells = line.split('|').slice(1, -1).map(s => s.trim());
  return [cells[0], ...cells.slice(1).map(cell => [...cell.matchAll(/`([^`]+)`/g)].map(m => m[1]).join(' / '))];
});
assert.deepEqual(actual, keyboard, '文檔鍵表與 data/keyboard.tsv 不一致');
assert.ok(examples >= 20);
console.log(`已核對 ${files.length} 份文檔、${links} 個本地連結、${examples} 個例字及完整鍵表。`);
