import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './derive.mjs';
import { build, encodeLayout, syllables } from './build_rime.mjs';

const layout = JSON.parse(fs.readFileSync(path.join(root, 'config/keyboards/default.json'), 'utf8'));
const original = build(layout);
assert.equal(original.stats.syllables, 3809);
assert.equal(original.stats.character_entries, 25304);
assert.ok(original.stats.phrase_entries >= 5);
assert.equal(original.stats.skipped_entries.length, 4);
assert.deepEqual(build(layout).files, original.files, '生成須逐位元可重現');
const publishedCodes = new Map(fs.readFileSync(path.join(root, 'data/positions.tsv'), 'utf8')
  .trim().split('\n').slice(1).map(line => line.split('\t')).map(row => [row[1], row[5]]));
for (const row of original.rows) assert.equal(row.code.toUpperCase(), publishedCodes.get(row.full),
  `Rime 預設鍵表與推導器鍵表不一致：${row.full}`);

// 使用獨立的簡化 Rime 規則解譯器逐條執行，防止大小寫中介結果被後續規則重寫。
function compileAlgebra(algebra) {
  return algebra.map(rule => {
    const [kind, pattern, replacement] = rule.split('/');
    if (kind === 'xform') {
      const re = new RegExp(pattern);
      return text => text.replace(re, replacement);
    }
    assert.equal(kind, 'xlit');
    return text => [...text].map(c => pattern.includes(c) ? replacement[pattern.indexOf(c)] : c).join('');
  });
}
const rules = compileAlgebra(original.algebra);
for (const row of original.rows) {
  assert.equal(rules.reduce((text, apply) => apply(text), row.full), row.code, row.full);
}
assert.match(original.files['preng.dict.yaml'], /\n爹\ttiae\t100\n/);
assert.match(original.files['preng.dict.yaml'], /\n怎\ttsvmq\t100\n/);
assert.match(original.files['preng.dict.yaml'], /\n中古漢語\ttrung koq hanh ngvoq\t100\n/);

// 對所有按鍵作置換仍無碰撞；字典、全拼 schema 必須完全不受鍵位影響。
const changed = structuredClone(layout);
for (const map of Object.values(changed.keys)) {
  for (const part of Object.keys(map)) map[part] = String.fromCharCode(97 + (map[part].charCodeAt(0) - 96) % 26);
}
const alternate = build(changed);
for (const name of ['preng.dict.yaml', 'preng.schema.yaml']) assert.equal(alternate.files[name], original.files[name]);
assert.notEqual(alternate.files['preng_sp.schema.yaml'], original.files['preng_sp.schema.yaml']);
for (let i = 0; i < original.rows.length; i++) assert.notEqual(alternate.rows[i].code, original.rows[i].code);

const rows = syllables();
for (const [mutate, error] of [
  [l => { delete l.keys.k2.wu; }, /漏配.*wu/],
  [l => { l.keys.k1.p = 'pp'; }, /單個小寫/],
  [l => { l.keys.k1.p = 'P'; }, /單個小寫/],
  [l => { l.keys.k1.p = ';'; }, /單個小寫/],
  [l => { l.keys.k2.typo = 'a'; }, /未知片段/],
  [l => { l.keys.k4 = {}; }, /只能包含/],
  [l => { l.keys.k2.ia = l.keys.k2.rae; }, /三拼碰撞/],
  [l => { delete l.keys.k1['']; }, /漏配.*∅/],
]) {
  const invalid = structuredClone(layout);
  mutate(invalid);
  assert.throws(() => encodeLayout(invalid, rows), error);
}
assert.throws(() => build(layout, '中古\ttrung nope\t100\n'), /古 沒有讀音/);
assert.throws(() => build(layout, '中古\ttrung\t100\n'), /格式錯誤/);

// 真正走 CLI，檢查外部配置與輸出目錄，以及失敗時保留上一次輸出。
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'preng-rime-'));
try {
  const config = path.join(temp, 'layout.json'), out = path.join(temp, 'rime');
  fs.writeFileSync(config, JSON.stringify(changed));
  const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/build_rime.mjs'), '--layout', config, '--out', out], { encoding: 'utf8' });
  const good = run();
  assert.equal(good.status, 0, good.stderr);
  for (const [name, content] of Object.entries(alternate.files)) assert.equal(fs.readFileSync(path.join(out, name), 'utf8'), content);
  delete changed.keys.k2.wu;
  fs.writeFileSync(config, JSON.stringify(changed));
  const bad = run();
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /漏配/);
  for (const [name, content] of Object.entries(alternate.files)) assert.equal(fs.readFileSync(path.join(out, name), 'utf8'), content);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('已核對 Rime 全音節轉換、字詞典、改鍵重建、配置錯誤及可重現性。');
