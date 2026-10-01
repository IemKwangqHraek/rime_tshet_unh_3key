import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './derive.mjs';
import { encodeLayout, syllables } from './build_rime.mjs';
import { alphabet, readJSON, hash, countTexts, compileCounts, keyboardModel, identity, evaluate, random, toLayout } from './layout_model.mjs';
import { windowNames, compileTrigrams, classifyTriple, trigramKeyboard, evaluateTrigrams, mixTrigramModels, swapScorer, optimizeTrigrams } from './layout_trigrams.mjs';

const file = name => path.join(root, name), near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const profile = readJSON(file('config/keyboard-cost.json')), config = readJSON(file('config/keyboard-trigram-cost.json'));
const baseKeyboard = keyboardModel(profile), keyboard = trigramKeyboard(baseKeyboard, config);
const features = text => classifyTriple(keyboard.keys, ...[...text].map(k => alphabet.indexOf(k)));
assert.ok(features('jkl').outward_roll); assert.ok(features('lkj').inward_roll);
assert.ok(features('asd').inward_roll); assert.ok(features('dsa').outward_roll);
assert.ok(features('jkj').redirect); assert.ok(!features('jjk').redirect);
assert.ok(features('fjr').skip_same_finger); assert.ok(!features('fjf').skip_same_finger);
assert.ok(!features('fgr').skip_same_finger); assert.ok(!features('ajf').skip_same_finger);
assert.ok(features('frv').triple_same_finger); assert.ok(!features('frv').redirect);
assert.throws(() => trigramKeyboard(baseKeyboard, config, -1), /非負/);
const readings = new Map([
  ['甲', [[0, 35, 57], [5, 42, 66]]],
  ['乙', [[9, 36, 61], [4, 29, 56], [7, 41, 71]]],
  ['𠀀', [[18, 26, 53]]],
]);
const texts = ['甲乙甲，乙𠀀 丙乙', '甲'];
const counts = countTexts(texts, readings), N = counts.stats.valid_characters, B = counts.stats.valid_pairs;
const trigrams = compileTrigrams(counts, readings), model = { ...compileCounts(counts, readings), trigrams };
near(trigrams.within.reduce((s, t) => s + t[3], 0), 1);
near(trigrams.cross_231.reduce((s, t) => s + t[3], 0), B / N);
near(trigrams.cross_312.reduce((s, t) => s + t[3], 0), B / N);
assert.equal(compileTrigrams(countTexts(['甲', '乙'], readings), readings).cross_231.length, 0);
assert.equal(compileTrigrams(countTexts(['甲丙乙'], readings), readings).cross_312.length, 0);
assert.throws(() => compileTrigrams(countTexts(['丙'], readings), readings), /沒有可映射/);
// 獨立枚舉完整短串的所有讀音，再以逐鍵滑動窗口核對每一個三鍵的頻率。
const direct = Object.fromEntries(windowNames.map(n => [n, new Map()]));
for (const segment of ['甲乙甲', '乙𠀀', '乙', '甲']) {
  let variants = [{ keys: [], p: 1 }];
  for (const char of segment) {
    const rs = readings.get(char);
    variants = variants.flatMap(v => rs.map(code => ({ keys: [...v.keys, ...code], p: v.p / rs.length })));
  }
  for (const { keys, p } of variants) for (let i = 0; i + 2 < keys.length; i++) {
    const name = windowNames[i % 3], id = keys.slice(i, i + 3).join(',');
    direct[name].set(id, (direct[name].get(id) || 0) + p / N);
  }
}
for (const name of windowNames) {
  assert.equal(trigrams[name].length, direct[name].size);
  for (const [a, b, c, w] of trigrams[name]) near(w, direct[name].get([a, b, c].join(',')));
}
const mapping = identity(), result = evaluateTrigrams(model, mapping, keyboard, true);
let directCost = 0;
for (const map of Object.values(direct)) for (const [id, w] of map) {
  const [a, b, c] = id.split(',').map(x => Number(x) % 26);
  directCost += w * keyboard.triple[(a * 26 + b) * 26 + c];
}
near(result.triple_cost, directCost);
near(result.triple_metrics.all.windows_per_character, 1 + 2 * B / N);
near(result.cost, evaluate(model, mapping, keyboard) + directCost);
near(evaluateTrigrams(model, mapping, trigramKeyboard(baseKeyboard, config, 0)), evaluate(model, mapping, keyboard));
near(evaluateTrigrams(mixTrigramModels([model, model], [0.25, 0.75]), mapping, keyboard), result.cost);
// 各槽連續接受多次交換，檢查增量與全量評分一致，且增量查詢不改動配鍵。
for (const weight of [0, 1]) {
  const k = trigramKeyboard(baseKeyboard, config, weight), delta = swapScorer(model, k), rng = random(917);
  const m = identity();
  for (let i = 0; i < 100; i++) {
    const slot = i % 3 * 26, a = slot + Math.floor(rng() * 26);
    const b = slot + (a - slot + 1 + Math.floor(rng() * 25)) % 26;
    const before = [...m], oldCost = evaluateTrigrams(model, m, k), d = delta(m, a, b);
    assert.deepEqual(m, before);
    [m[a], m[b]] = [m[b], m[a]];
    near(d, evaluateTrigrams(model, m, k) - oldCost);
  }
}
const trial = optimizeTrigrams(model, keyboard, { seed: 123, iterations: 100 });
assert.deepEqual(trial, optimizeTrigrams(model, keyboard, { seed: 123, iterations: 100 }));
assert.ok(trial.cost <= result.cost);
const base = readJSON(file('config/keyboards/baseline.json')), rows = syllables();
encodeLayout(toLayout(base, trial.mapping, 'test'), rows);

const reportPath = file('.cache/layout-analysis/trigram-search/report.json');
if (fs.existsSync(reportPath)) {
  const report = readJSON(reportPath), frequencies = readJSON(file('.cache/layout-analysis/base-frequencies.json'));
  const tf = readJSON(file('.cache/layout-analysis/trigram-frequencies.json'));
  assert.equal(report.frequency_sha256, hash(fs.readFileSync(file('.cache/layout-analysis/trigram-frequencies.json'))));
  assert.equal(report.previous_report_sha256, hash(fs.readFileSync(file('.cache/layout-analysis/base-search/report.json'))));
  assert.equal(report.search_code_sha256, hash(fs.readFileSync(new URL('./search_layout_trigrams.mjs', import.meta.url))));
  assert.equal(report.trigram_code_sha256, hash(fs.readFileSync(new URL('./layout_trigrams.mjs', import.meta.url))));
  assert.equal(report.base_model_code_sha256, hash(fs.readFileSync(new URL('./layout_model.mjs', import.meta.url))));
  assert.equal(tf.trigram_code_sha256, report.trigram_code_sha256);
  assert.equal(tf.base_frequency_sha256, hash(fs.readFileSync(file('.cache/layout-analysis/base-frequencies.json'))));
  assert.equal(tf.preparation_sha256, hash(fs.readFileSync(new URL('./prepare_layout_trigrams.mjs', import.meta.url))));
  assert.deepEqual(report.trigram_config, config); assert.deepEqual(report.base_profile, profile);
  for (const corpus of ['classical', 'modern']) for (const split of ['train', 'dev', 'test']) {
    const stats = frequencies.models[corpus][split].stats, t = tf.trigrams[corpus][split];
    near(t.within.reduce((sum, x) => sum + x[3], 0), 1);
    for (const name of ['cross_231', 'cross_312']) near(t[name].reduce((sum, x) => sum + x[3], 0), stats.valid_pairs / stats.valid_characters);
  }
  for (const c of report.candidates) {
    encodeLayout(c.layout, rows);
    assert.equal(c.layout_sha256, hash(JSON.stringify(c.layout)));
    assert.deepEqual(c.layout, toLayout(base, c.mapping, c.name));
    for (const split of ['train', 'dev', 'test']) for (const [objective, weights] of Object.entries(report.parameters.objectives)) {
      const m = mixTrigramModels(['classical', 'modern'].map(corpus =>
        ({ ...frequencies.models[corpus][split], trigrams: tf.trigrams[corpus][split] })), weights);
      const e = evaluateTrigrams(m, c.mapping, keyboard, true);
      near(c.evaluation[split][objective].cost, e.cost);
      near(c.evaluation[split][objective].triple_cost, e.triple_cost);
      if (split === 'test') for (const w of [0, 0.5, 1, 2]) near(c.sensitivity[w][objective],
        evaluateTrigrams(m, c.mapping, trigramKeyboard(baseKeyboard, config, w)));
    }
    if (c.family !== 'previous') {
      assert.deepEqual(c.layout, readJSON(file(`.cache/layout-analysis/trigram-search/${c.id}.json`)));
      const selected = report.trials.filter(t => t.family === c.family && t.objective === c.objective);
      near(c.training_search_cost, Math.min(...selected.map(t => t.cost)));
      const actual = c.evaluation.train[c.objective];
      near(c.training_search_cost, c.family === 'control' ? actual.pair_model_cost : actual.cost);
    }
  }
  const selected = report.candidates.find(c => c.id === 'control-mixed');
  const finalLayout = readJSON(file('config/keyboards/default.json'));
  assert.ok(selected, '缺少最終 control-mixed 候選');
  assert.deepEqual(finalLayout.keys, selected.layout.keys, '最終預設鍵表與重現候選不一致');
  assert.equal(finalLayout.name, '古今混合頻率優化 v1');
}
console.log('已核對三鍵分類、完整短串枚舉、窗口守恆、跨字與讀音聯合分佈、增量評分、零權重回歸、重現性及候選結果。');
