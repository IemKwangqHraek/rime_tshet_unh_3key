import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root } from './derive.mjs';
import { syllables, encodeLayout } from './build_rime.mjs';
import { readJSON, writeJSON, hash, keyboardModel, identity, toLayout } from './layout_model.mjs';
import { mixTrigramModels, trigramKeyboard, evaluateTrigrams, optimizeTrigrams } from './layout_trigrams.mjs';

const file = name => path.join(root, name);
const args = process.argv.slice(2);
let iterations = 20000, seeds = [17, 29, 43, 71], out = file('.cache/layout-analysis/trigram-search');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--iterations') iterations = Number(args[++i]);
  else if (args[i] === '--seeds') seeds = (args[++i] || '').split(',').map(Number);
  else if (args[i] === '--out') out = path.resolve(args[++i]);
  else throw new Error(`未知參數：${args[i]}`);
}
assert.ok(Number.isInteger(iterations) && iterations > 0);
assert.ok(seeds.length && seeds.every(s => Number.isInteger(s) && s > 0 && s <= 0xffffffff));
const frequencies = readJSON(file('.cache/layout-analysis/base-frequencies.json'));
const triples = readJSON(file('.cache/layout-analysis/trigram-frequencies.json'));
const previous = readJSON(file('.cache/layout-analysis/base-search/report.json'));
assert.equal(triples.base_frequency_sha256, hash(fs.readFileSync(file('.cache/layout-analysis/base-frequencies.json'))));
assert.equal(triples.preparation_sha256, hash(fs.readFileSync(new URL('./prepare_layout_trigrams.mjs', import.meta.url))));
assert.equal(triples.trigram_code_sha256, hash(fs.readFileSync(new URL('./layout_trigrams.mjs', import.meta.url))));
assert.equal(previous.frequency_sha256, triples.base_frequency_sha256);
const base = readJSON(file('config/keyboards/baseline.json'));
const profile = readJSON(file('config/keyboard-cost.json')), config = readJSON(file('config/keyboard-trigram-cost.json'));
assert.equal(frequencies.base_layout_sha256, hash(JSON.stringify(base)));
assert.equal(previous.profile_sha256, hash(JSON.stringify(profile)));
const baseKeyboard = keyboardModel(profile), keyboard = trigramKeyboard(baseKeyboard, config);
const objectives = { classical: [1, 0], modern: [0, 1], mixed: [0.5, 0.5] };
const models = {};
for (const split of ['train', 'dev', 'test']) {
  models[split] = {};
  for (const [objective, weights] of Object.entries(objectives)) models[split][objective] = mixTrigramModels(
    ['classical', 'modern'].map(c => ({ ...frequencies.models[c][split], trigrams: triples.trigrams[c][split] })), weights);
}
const rows = syllables();
const candidates = previous.candidates.map(c => ({ id: c.id === 'baseline' ? 'baseline' : `previous-${c.id}`,
  family: 'previous', objective: c.id, name: c.name, layout: c.layout, mapping: c.mapping }));
const trials = [];
for (const [family, weight] of [['control', 0], ['trigram', config.weight]]) {
  const searchKeyboard = trigramKeyboard(baseKeyboard, config, weight);
  for (const objective of Object.keys(objectives)) {
    const old = previous.candidates.find(c => c.id === objective);
    let chosen = null;
    for (const [i, seed] of seeds.entries()) {
      const initial = i === 0 ? old.mapping : identity();
      const trial = optimizeTrigrams(models.train[objective], searchKeyboard, { seed, iterations, initial, shuffled: i >= 2 });
      const entry = { family, objective, weight, initial: i === 0 ? `previous-${objective}` : i === 1 ? 'baseline' : 'shuffled-baseline', ...trial };
      trials.push(entry);
      console.log(`${family}/${objective}, seed ${seed}: ${trial.cost.toFixed(6)}`);
      if (!chosen || trial.cost < chosen.cost) chosen = entry;
    }
    const layout = toLayout(base, chosen.mapping, `三鍵試驗 · ${family} · ${objective} · seed ${chosen.seed}`);
    encodeLayout(layout, rows);
    candidates.push({ id: `${family}-${objective}`, family, objective, name: layout.name,
      layout, mapping: chosen.mapping, selected_seed: chosen.seed, training_search_cost: chosen.cost });
  }
}
for (const candidate of candidates) {
  encodeLayout(candidate.layout, rows);
  candidate.layout_sha256 = hash(JSON.stringify(candidate.layout));
  candidate.evaluation = {};
  for (const split of ['train', 'dev', 'test']) {
    candidate.evaluation[split] = {};
    for (const objective of Object.keys(objectives)) candidate.evaluation[split][objective] = evaluateTrigrams(models[split][objective], candidate.mapping, keyboard, true);
  }
  candidate.sensitivity = {};
  for (const weight of [0, 0.5, 1, 2]) {
    const k = trigramKeyboard(baseKeyboard, config, weight);
    candidate.sensitivity[weight] = Object.fromEntries(Object.keys(objectives).map(o => [o,
      evaluateTrigrams(models.test[o], candidate.mapping, k)]));
  }
}
fs.mkdirSync(out, { recursive: true });
for (const c of candidates.filter(c => c.family !== 'previous')) {
  writeJSON(path.join(out, `${c.id}.json`), c.layout);
  const table = [['按鍵', '第一段', '第二段', '第三段'], ...[...'abcdefghijklmnopqrstuvwxyz'].map(key => [key,
    ...['k1', 'k2', 'k3'].map(slot => Object.entries(c.layout.keys[slot]).filter(([, k]) => k === key)
      .map(([p]) => p || '∅').join(' / '))])];
  fs.writeFileSync(path.join(out, `${c.id}.keyboard.tsv`), table.map(row => row.join('\t')).join('\n') + '\n');
}
const report = { version: 1, date: '2026-10-01',
  frequency_sha256: hash(fs.readFileSync(file('.cache/layout-analysis/trigram-frequencies.json'))),
  previous_report_sha256: hash(fs.readFileSync(file('.cache/layout-analysis/base-search/report.json'))),
  search_code_sha256: hash(fs.readFileSync(new URL(import.meta.url))),
  trigram_code_sha256: hash(fs.readFileSync(new URL('./layout_trigrams.mjs', import.meta.url))),
  base_model_code_sha256: hash(fs.readFileSync(new URL('./layout_model.mjs', import.meta.url))),
  base_profile: profile, trigram_config: config,
  parameters: { iterations, seeds, objectives, selection: 'training cost only; equal proposal counts and starting schedules for control and trigram; local descent to convergence, not equal wall time',
    warm_start: 'first seed previous corresponding candidate; second baseline; remaining shuffled baseline' },
  syllables_verified: rows.length, candidates, trials };
writeJSON(path.join(out, 'report.json'), report);
const n = v => v.toFixed(4), p = v => `${(100 * v).toFixed(2)}%`;
const lines = ['# 三鍵動作評分試驗', '',
  '固定第一輪語料、切分、等概率讀音、共鍵組和二鍵係數，只加入三鍵附加項。不計記憶成本。所有新候選只按訓練成本選種子；test 是沿用第一輪已檢視過的探索性保留集，並非全新盲測。', '',
  `附加項：三鍵同手、相鄰均換指而方向折返，每次 ${config.redirect}；隔一個異手鍵後首末同指異鍵，每次 ${config.skip_same_finger} + ${config.skip_distance}×首末鍵距離。總附加權重 λ=${config.weight}。兩項互斥。內滾／外滾只統計，不給獎勵。係數爲未經實測的啓發式假設；成本不代表時間或提速。`, '',
  '窗口包含字內 123 及跨字 231、312；其每字頻率總和分別爲 1、B/N、B/N。各比例以有效三鍵窗口總量爲分母。', '',
  '## 同一新模型下的混合測試集比較', '',
  '| 鍵表 | 原二鍵模型部分 | 三鍵附加 | 新總成本 | 折返率 | 隔鍵同指異鍵率 | 二鍵同指異鍵率 |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
for (const c of candidates) {
  const e = c.evaluation.test.mixed, rates = e.triple_metrics.all.rates;
  lines.push(`| ${c.id} | ${n(e.pair_model_cost)} | ${n(e.triple_cost)} | ${n(e.cost)} | ${p(rates.redirect)} | ${p(rates.skip_same_finger)} | ${p(e.all_pair_metrics.same_finger_different_rate)} |`);
}
lines.push('', 'previous 是第一輪候選；control 是三鍵權重爲零的同預算重搜；trigram 是加入三鍵項後重搜。兩組使用相同種子、起點政策及退火步數，各自下降至無單次槽內交換可改進，實際耗時及局部下降步數不強制相同。所有表均在同一新模型下評分，不能將不同模型總分直接比較。', '',
  '## 三個混合候選的跨語料成本', '', '| 鍵表 | 唐詩 test | 現代 test | 混合 train | 混合 dev | 混合 test |', '| --- | ---: | ---: | ---: | ---: | ---: |');
const selected = ['previous-mixed', 'control-mixed', 'trigram-mixed'].map(id => candidates.find(c => c.id === id));
for (const c of selected) lines.push(`| ${c.id} | ${n(c.evaluation.test.classical.cost)} | ${n(c.evaluation.test.modern.cost)} | ${n(c.evaluation.train.mixed.cost)} | ${n(c.evaluation.dev.mixed.cost)} | ${n(c.evaluation.test.mixed.cost)} |`);
const [oldMixed, controlMixed, newMixed] = selected.map(c => c.evaluation.test.mixed);
lines.push('', `相對第一輪混合候選，新三鍵混合候選的同模型成本下降 ${p(1 - newMixed.cost / oldMixed.cost)}；相對本次零權重重搜對照，成本變化爲 ${p(newMixed.cost / controlMixed.cost - 1)}（正值表示更差）。原二鍵模型部分相對第一輪變化 ${p(newMixed.pair_model_cost / oldMixed.pair_model_cost - 1)}。`, '',
  '這區分了「三鍵動作的改變」與「額外搜尋帶來的改變」。有限種子存在局部最優，不應由一次搜尋聲稱三鍵模型必然更好；尤其當重搜對照的總成本更低時，需如實保留此結果。');
lines.push('', '## 混合候選的三鍵權重敏感度', '', '| 鍵表 | λ=0 | λ=0.5 | λ=1 | λ=2 |', '| --- | ---: | ---: | ---: | ---: |');
for (const c of selected) lines.push(`| ${c.id} | ${[0, 0.5, 1, 2].map(w => n(c.sensitivity[w].mixed)).join(' | ')} |`);
lines.push('', '這是固定候選的重新評分，不是針對每個 λ 都重搜。λ=0 恢復原模型。新候選的選擇不使用此表。', '',
  '## 字內／跨字三鍵模式', '', '| 鍵表 | 窗口 | 折返率 | 隔鍵同指異鍵率 | 內滾率 | 外滾率 |', '| --- | --- | ---: | ---: | ---: | ---: |');
for (const c of selected) for (const name of ['within', 'cross_231', 'cross_312']) {
  const r = c.evaluation.test.mixed.triple_metrics[name].rates;
  lines.push(`| ${c.id} | ${name} | ${p(r.redirect)} | ${p(r.skip_same_finger)} | ${p(r.inward_roll)} | ${p(r.outward_roll)} |`);
}
lines.push('', '## 候選與重現', '',
  '- [混合三鍵候選](trigram-mixed.json)、[鍵表](trigram-mixed.keyboard.tsv)。',
  '- [古文三鍵候選](trigram-classical.json)、[現代三鍵候選](trigram-modern.json)。',
  '- [零權重混合對照](control-mixed.json)。',
  '- [完整結果](report.json)、[三鍵係數](../../../config/keyboard-trigram-cost.json)、[語料來源](../../../config/layout-analysis-sources.json)。', '',
  '```sh', 'npm run fetch:layout-corpora', 'npm run prepare:trigrams',
  `npm run search:trigrams -- --iterations ${iterations} --seeds ${seeds.join(',')}`, 'npm test',
  'npm run build:rime -- --layout .cache/layout-analysis/trigram-search/trigram-mixed.json --out dist/rime-trigram-mixed', '```', '',
  `全部 ${candidates.length} 個比較鍵表已通過 ${rows.length} 音節無碰撞驗證。既有預設及第一輪候選保持原樣。`, '',
  '限制：語料仍爲唐詩子集和 GSD wiki；未計真實選字／上屏、個人指法、按鍵時間。新增懲罰可能改善代理分數而未改善實際手感，需實打驗證。', '');
fs.writeFileSync(path.join(out, 'Report.md'), lines.join('\n'));
console.log(`已生成 ${out}`);
