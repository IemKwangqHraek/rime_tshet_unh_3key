import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './derive.mjs';
import { syllables, encodeLayout } from './build_rime.mjs';
import { readJSON, hash, countTexts, compileCounts, keyboardModel, evaluate, identity, optimize, toLayout, mixModels } from './layout_model.mjs';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const readings = new Map([
  ['甲', [[0, 26, 52], [1, 27, 53]]],
  ['乙', [[2, 28, 54], [3, 29, 55], [4, 30, 56]]],
  ['𠀀', [[5, 31, 57]]],
]);
const counts = countTexts(['甲乙甲，乙𠀀 丙乙'], readings);
assert.equal(counts.stats.han_characters, 7);
assert.equal(counts.stats.valid_characters, 6);
assert.equal(counts.stats.valid_pairs, 3);
assert.equal(counts.stats.potential_pairs, 4);
assert.deepEqual(counts.stats.missing, [['丙', 1]]);
assert.deepEqual([...counts.pairs], [['甲\t乙', 1], ['乙\t甲', 1], ['乙\t𠀀', 1]]);
assert.equal(countTexts(['甲', '乙'], readings).pairs.size, 0);
assert.equal(countTexts(['甲丙乙'], readings).pairs.size, 0);
const model = compileCounts(counts, readings);
near(model.single.reduce((a, b) => a + b, 0), 3);
near(model.within.reduce((a, edge) => a + edge[2], 0), 2);
near(model.boundary.reduce((a, edge) => a + edge[2], 0), 0.5);
const repeatChar = compileCounts(countTexts(['甲甲'], readings), readings);
assert.equal(repeatChar.boundary.length, 4);
for (const [, , weight] of repeatChar.boundary) near(weight, 0.125);
assert.throws(() => compileCounts(countTexts(['丙'], readings), readings), /沒有可映射/);

const profile = readJSON(path.join(root, 'config/keyboard-cost.json')), keyboard = keyboardModel(profile);
const mapping = identity(), result = evaluate(model, mapping, keyboard, true);
// 直接枚舉每個已知字及有向字對的所有讀音，獨立核對矩陣實作的期望成本。
let single = 0, within = 0, boundary = 0;
for (const [char, count] of counts.chars) {
  const rs = readings.get(char);
  for (const code of rs) {
    const ks = code.map(x => x % 26), weight = count / rs.length / 6;
    single += weight * ks.reduce((s, k) => s + keyboard.single[k], 0);
    within += weight * (keyboard.pair[ks[0] * 26 + ks[1]] + keyboard.pair[ks[1] * 26 + ks[2]]);
  }
}
for (const [pair, count] of counts.pairs) {
  const [a, b] = pair.split('\t'), left = readings.get(a), right = readings.get(b);
  for (const l of left) for (const r of right) boundary += count / left.length / right.length / 6 *
    keyboard.pair[(l[2] % 26) * 26 + r[0] % 26];
}
near(result.single, single); near(result.within, within); near(result.boundary, boundary);
near(result.finger_loads.reduce((a, b) => a + b, 0), 1);
near(evaluate(mixModels([model, model], [0.2, 0.8]), mapping, keyboard), result.cost);
assert.throws(() => mixModels([model], [0.5]), /權重/);
const first = optimize(model, keyboard, { seed: 123, iterations: 100 });
assert.deepEqual(first, optimize(model, keyboard, { seed: 123, iterations: 100 }));
assert.ok(first.cost <= result.cost);
for (let slot = 0; slot < 78; slot += 26) assert.equal(new Set(first.mapping.slice(slot, slot + 26)).size, 26);
const base = readJSON(path.join(root, 'config/keyboards/baseline.json')), rows = syllables();
encodeLayout(toLayout(base, first.mapping, 'test'), rows);

const reportPath = path.join(root, '.cache/layout-analysis/base-search/report.json');
if (fs.existsSync(reportPath)) {
  const report = readJSON(reportPath), frequenciesPath = path.join(root, '.cache/layout-analysis/base-frequencies.json');
  const frequencies = readJSON(frequenciesPath);
  assert.equal(report.frequency_sha256, hash(fs.readFileSync(frequenciesPath)));
  assert.equal(report.profile_sha256, hash(JSON.stringify(profile)));
  assert.equal(report.search_code_sha256, hash(fs.readFileSync(new URL('./search_layouts.mjs', import.meta.url))));
  assert.equal(report.model_code_sha256, hash(fs.readFileSync(new URL('./layout_model.mjs', import.meta.url))));
  for (const candidate of report.candidates) {
    encodeLayout(candidate.layout, rows);
    assert.equal(candidate.layout_sha256, hash(JSON.stringify(candidate.layout)));
    assert.deepEqual(candidate.layout, toLayout(base, candidate.mapping, candidate.name));
    for (const split of ['train', 'dev', 'test']) for (const [objective, weights] of Object.entries(report.parameters.objectives)) {
      const m = mixModels([frequencies.models.classical[split], frequencies.models.modern[split]], weights);
      near(candidate.evaluation[split][objective].cost, evaluate(m, candidate.mapping, keyboard));
    }
    if (candidate.id !== 'baseline') {
      assert.deepEqual(candidate.layout, readJSON(path.join(root, `.cache/layout-analysis/base-search/${candidate.id}.json`)));
      const trials = report.trials.filter(t => t.objective === candidate.id);
      near(candidate.evaluation.train[candidate.id].cost, Math.min(...trials.map(t => t.cost)));
    }
  }
}
console.log('已核對等概率字音／字對、碼點及邊界、頻率守恆、直接枚舉成本、搜尋重現性與候選合法性。');
