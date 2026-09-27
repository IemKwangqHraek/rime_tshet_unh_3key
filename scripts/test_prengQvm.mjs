// 用官方執行器核對完整樣本；--write 明確更新本方案的輸出快照。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root, scheme, raw, source, TshetUinh } from './derive.mjs';

const write = process.argv.includes('--write');
assert.ok(process.argv.slice(2).every(arg => arg === '--write'), '只接受 --write 選項');
const data = path.join(root, 'data');
const sources = JSON.parse(fs.readFileSync(path.join(data, 'sources.json'), 'utf8'));
const { scope } = sources;
const full = scheme();
const triple = scheme({ 輸出: '三拼' });
const parts = scheme({ 輸出: '三段' });
const both = scheme({ 輸出: '全拼及三拼' });
assert.equal(scheme.方案設定().選項.輸出, '全拼');
const current = [...TshetUinh.資料.iter音韻地位()];
assert.equal(current.length, scope.current_positions);
const currentDescriptions = new Set(current.map(p => p.描述));
const positions = new Map(current.map(p => [p.描述, p]));
for (const description of scope.legacy_only_positions) {
  assert.ok(!currentDescriptions.has(description), `兼容地位已回到上游，請重新核對來源：${description}`);
  positions.set(description, TshetUinh.音韻地位.from描述(description));
}
assert.equal(positions.size, scope.union_positions);
for (const description of scope.current_only_positions) assert.ok(currentDescriptions.has(description));
assert.equal(positions.size - scope.current_only_positions.length, scope.original_positions);

const fulls = new Map(), codes = new Map();
const fragmentKeys = [new Map(), new Map(), new Map()];
const contract = s => s.replaceAll('ii', 'i').replaceAll('yy', 'y').replaceAll('rr', 'r').replaceAll('jj', 'j');
const records = [];
function record(description, f, c, segments, origin) {
  assert.match(f, /^[a-z]+$/);
  assert.match(c, /^[A-Z]{3}$/);
  assert.equal(segments.length, 3);
  assert.ok(!fulls.has(f), `全拼衝突：${description} / ${fulls.get(f)} / ${f}`);
  assert.ok(!codes.has(c), `三拼衝突：${description} / ${codes.get(c)} / ${c}`);
  fulls.set(f, description); codes.set(c, description);
  for (let i = 0; i < 3; i++) {
    if (fragmentKeys[i].has(segments[i])) {
      assert.equal(fragmentKeys[i].get(segments[i]), c[i], `同片段異鍵：${description}`);
    }
    fragmentKeys[i].set(segments[i], c[i]);
  }
  if (description === '端開四麻平') assert.equal(contract(segments.join('')), 'tva');
  else assert.equal(contract(segments.join('')), f, description);
  records.push([description, f, ...segments, c, origin]);
}
for (const p of positions.values()) {
  const f = full(p), c = triple(p);
  const segments = parts(p).split(' / ').map(s => s === '∅' ? '' : s);
  record(p.描述, f, c, segments, currentDescriptions.has(p.描述) ? '當前內建' : '原固定樣本');
  assert.equal(both(p), `${f}〔${c}〕`);
}
assert.equal(raw({}, null, '怎'), 'tsvmq');
assert.equal(raw({ 輸出: '三拼' }, null, '怎'), 'FNV');
assert.equal(raw({ 輸出: '三段' }, null, '怎'), 'ts / v / mq');
record('補充：怎', 'tsvmq', 'FNV', ['ts', 'v', 'mq'], '本方案補充');

// 固定例字保護音系取捨；完整快照則保護全部既有拼式與鍵位。
const fixtures = {
  端一冬平: 'towng', 端開一登平: 'tong', 端一東平: 'twung',
  見開一豪平: 'koaw', 端一侯平: 'twu', 生開三庚平: 'sriaeng',
  章開三蒸平: 'tjvng', 幫三B蒸平: 'pring', 見開三B侵平: 'kvm',
  莊開三侵平: 'tsrim', 見開三B支平: 'kve', 知開三支平: 'trie',
  曉合三A支平: 'xye', 定開二佳上: 'greq', 端開二庚上: 'taengq',
  來開二庚上: 'laengq', 定開四脂去: 'dih', 端開四麻平: 'tiae',
  並三A陽上: 'biangq', 溪開三B幽平: 'khriw', 匣開四先平: 'ghen',
  云合三C廢上: 'uoiq',
};
for (const [d, f] of Object.entries(fixtures)) assert.equal(full(TshetUinh.音韻地位.from描述(d)), f, d);
assert.equal(triple(TshetUinh.音韻地位.from描述('並三A陽上')), 'BJF');
assert.equal(triple(TshetUinh.音韻地位.from描述('並二庚上')), 'BAF');
assert.equal(fragmentKeys[1].get('ia'), 'J');
assert.equal(fragmentKeys[1].get('rae'), 'A');
for (const char of ['打', '冷', '爹', '倄', '侑', '礥', '𠁫', '𩦠', '箉', '地']) {
  const entries = TshetUinh.資料.query字頭(char);
  assert.ok(entries.length);
  for (const entry of entries) assert.equal(full(entry.音韻地位, char), full(entry.音韻地位), `字頭不應覆寫其他讀音：${char}`);
}
assert.notEqual(full(TshetUinh.音韻地位.from描述('端開四青上'), '打'), 'taengq');
assert.notEqual(full(TshetUinh.音韻地位.from描述('定開一歌上'), '爹'), 'tiae');
assert.deepEqual(fragmentKeys.map(map => new Set(map.values()).size), [24, 23, 21]);
assert.equal(fragmentKeys[1].size, 52);
assert.equal(records.length, 3809);

const fields = ['音韻地位', '全拼', '第一段', '第二段', '第三段', '三拼', '範圍'];
const stableOrder = (a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
records.sort(stableOrder);
const keyRows = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', key => [key, ...fragmentKeys.map(map =>
  [...map].filter(([, k]) => k === key).map(([s]) => s).sort().map(s => s || '∅').join(' / '))]);
const asTSV = rows => rows.map(row => row.join('\t')).join('\n') + '\n';
const summary = {
  tshet_uinh: sources.runtime['tshet-uinh'],
  deriver_tools: sources.runtime['tshet-uinh-deriver-tools'],
  script_sha256: createHash('sha256').update(source).digest('hex'),
  original_positions: scope.original_positions,
  current_positions: current.length,
  current_only_positions: scope.current_only_positions,
  legacy_only_positions: scope.legacy_only_positions,
  union_positions: positions.size, supplemental_syllables: 1,
  full_spelling_collisions: 0, three_key_collisions: 0,
  key_counts: [24, 23, 21], second_segments: fragmentKeys[1].size,
  reconstruction_exception: '端開四麻平：全拼 tiae；三段 t / va / ∅',
  layout_revision: 'ia 從 A 移至 J，避免 biangq 與 braengq 同爲 BAF',
  fixed_spelling_checks: Object.keys(fixtures).length,
};
const generated = {
  'positions.tsv': asTSV([fields, ...records]),
  'keyboard.tsv': asTSV([['按鍵', '第一段', '第二段', '第三段'], ...keyRows]),
  'check.json': JSON.stringify(summary, null, 2) + '\n',
};
if (write) {
  for (const [name, content] of Object.entries(generated)) fs.writeFileSync(path.join(data, name), content);
} else {
  for (const [name, expected] of Object.entries(generated)) {
    assert.equal(fs.readFileSync(path.join(data, name), 'utf8'), expected,
      `${name} 與目前推導不一致；確認變更後用 npm run build:data 更新並審核差異`);
  }
}
console.log(`${write ? '已生成' : '已核對'} ${records.length} 條全拼、三段、三鍵；無碰撞，24／23／21 鍵。`);
