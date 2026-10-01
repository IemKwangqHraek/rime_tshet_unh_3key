import fs from 'node:fs';
import path from 'node:path';
import { root, source as schemeSource } from './derive.mjs';
import { syllables, encodeLayout } from './build_rime.mjs';
import { hash, readJSON, writeJSON, keyboardModel, mixModels, identity, evaluate, optimize, toLayout } from './layout_model.mjs';

const args = process.argv.slice(2);
let iterations = 20000, seeds = [17, 29, 43, 71], out = path.join(root, '.cache/layout-analysis/base-search');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--iterations') iterations = Number(args[++i]);
  else if (args[i] === '--seeds') seeds = (args[++i] || '').split(',').map(Number);
  else if (args[i] === '--out') out = path.resolve(args[++i]);
  else throw new Error(`未知參數：${args[i]}`);
}
if (!Number.isInteger(iterations) || iterations <= 0 || !seeds.length || seeds.some(s => !Number.isInteger(s) || s <= 0 || s > 0xffffffff)) throw new Error('iterations 和 seeds 必須爲正整數，seed 不超過 2^32−1');
const base = readJSON(path.join(root, 'config/keyboards/baseline.json'));
const frequenciesPath = path.join(root, '.cache/layout-analysis/base-frequencies.json');
const frequencies = readJSON(frequenciesPath), profile = readJSON(path.join(root, 'config/keyboard-cost.json'));
if (frequencies.base_layout_sha256 !== hash(JSON.stringify(base)) || frequencies.scheme_sha256 !== hash(schemeSource) ||
    frequencies.manifest_sha256 !== hash(fs.readFileSync(path.join(root, 'config/layout-analysis-sources.json'))) ||
    frequencies.preparation_sha256 !== hash(fs.readFileSync(new URL('./prepare_layout_corpora.mjs', import.meta.url))) ||
    frequencies.model_code_sha256 !== hash(fs.readFileSync(new URL('./layout_model.mjs', import.meta.url)))) throw new Error('統計已過期，請重新執行 prepare:layouts');
const keyboard = keyboardModel(profile), rows = syllables();
const objectives = { classical: [1, 0], modern: [0, 1], mixed: [0.5, 0.5] };
const models = frequencies.models;
const candidates = [{ id: 'baseline', name: base.name, mapping: identity(), layout: base }];
const trials = [];
for (const [objective, weights] of Object.entries(objectives)) {
  const train = mixModels([models.classical.train, models.modern.train], weights);
  let chosen = null;
  for (const [i, seed] of seeds.entries()) {
    const trial = optimize(train, keyboard, { seed, iterations, shuffled: i > 0 });
    trials.push({ objective, ...trial });
    console.log(`${objective}, seed ${seed}: ${trial.cost.toFixed(6)}`);
    if (!chosen || trial.cost < chosen.cost) chosen = trial;
  }
  const layout = toLayout(base, chosen.mapping, `試驗候選 v1 · ${objective} · seed ${chosen.seed}`);
  encodeLayout(layout, rows);
  candidates.push({ id: objective, name: layout.name, mapping: chosen.mapping, layout, selected_seed: chosen.seed });
}
for (const candidate of candidates) {
  encodeLayout(candidate.layout, rows);
  candidate.layout_sha256 = hash(JSON.stringify(candidate.layout));
  candidate.evaluation = {};
  for (const split of ['train', 'dev', 'test']) {
    candidate.evaluation[split] = {};
    for (const [objective, weights] of Object.entries(objectives)) candidate.evaluation[split][objective] =
      evaluate(mixModels([models.classical[split], models.modern[split]], weights), candidate.mapping, keyboard, true);
  }
  // 在保留測試統計上更改代理係數，僅作穩健性報告，不反過來選種子。
  candidate.sensitivity = {};
  for (const factor of [0.5, 2]) {
    const alternative = { ...profile, same_finger_different: profile.same_finger_different * factor,
      same_finger_distance: profile.same_finger_distance * factor };
    candidate.sensitivity[`same_finger_x${factor}`] = evaluate(
      mixModels([models.classical.test, models.modern.test], objectives.mixed), candidate.mapping, keyboardModel(alternative));
  }
}
fs.mkdirSync(out, { recursive: true });
for (const candidate of candidates.filter(c => c.id !== 'baseline')) {
  writeJSON(path.join(out, `${candidate.id}.json`), candidate.layout);
  const table = [['按鍵', '第一段', '第二段', '第三段'], ...[...'abcdefghijklmnopqrstuvwxyz'].map(key => [key,
    ...['k1', 'k2', 'k3'].map(slot => Object.entries(candidate.layout.keys[slot]).filter(([, k]) => k === key)
      .map(([part]) => part || '∅').join(' / '))])];
  fs.writeFileSync(path.join(out, `${candidate.id}.keyboard.tsv`), table.map(row => row.join('\t')).join('\n') + '\n');
}
const report = { version: 1, frequency_sha256: hash(fs.readFileSync(frequenciesPath)),
  profile_sha256: hash(JSON.stringify(profile)), search_code_sha256: hash(fs.readFileSync(new URL(import.meta.url))),
  model_code_sha256: hash(fs.readFileSync(new URL('./layout_model.mjs', import.meta.url))),
  parameters: { iterations, seeds, objectives, selection: 'minimum training objective; dev/test not used in selection' },
  phonological_positions_verified: rows.length, profile, trials, candidates,
  coverage: Object.fromEntries(Object.entries(models).map(([c, splits]) => [c,
    Object.fromEntries(Object.entries(splits).map(([s, m]) => [s, m.stats]))])) };
writeJSON(path.join(out, 'report.json'), report);
const pct = x => `${(100 * x).toFixed(2)}%`, num = x => x.toFixed(4);
const lines = ['# 首輪鍵位候選結果', '',
  '探索模型：固定共鍵組；中古讀音等概率；不計記憶成本。以下爲保留測試集結果，候選只按訓練成本選擇。成本是可配置的無單位代理量，不代表毫秒或提速百分比。', '',
  '古文爲前 2,000 首檔案中的唐詩子集；現代爲 GSD wiki 文本。詩作按文本雜湊分組，現代沿用上游切分，並排除精確重複。這不是跨作品／跨文章的嚴格泛化試驗；古文也不代表散文、史書等文體。', '',
  '| 鍵表 | 唐詩成本 | 現代成本 | 各半成本 | 各半相對現用下降 | 同指異鍵率 | 重按率 | 主行比例 | 左手比例 |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
const baseline = candidates[0].evaluation.test.mixed.cost;
for (const candidate of candidates) {
  const e = candidate.evaluation.test, m = e.mixed;
  lines.push(`| ${candidate.id} | ${num(e.classical.cost)} | ${num(e.modern.cost)} | ${num(m.cost)} | ${pct(1 - m.cost / baseline)} | ${pct(m.all_pair_metrics.same_finger_different_rate)} | ${pct(m.all_pair_metrics.repeat_rate)} | ${pct(m.home_share)} | ${pct(m.left_share)} |`);
}
lines.push('', '同指異鍵率、重按率均以混合後的有效相鄰鍵對數作分母。混合成本含按混合分佈計算的非線性指負荷懲罰，因此不一定恰等於兩個分語料總成本的平均。', '',
  '## 字內與跨字', '', '| 鍵表 | 字內同指異鍵率 | 跨字同指異鍵率 | 單鍵成本 | 字內銜接成本 | 跨字銜接成本 | 指負荷懲罰 |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const candidate of candidates) {
  const m = candidate.evaluation.test.mixed;
  lines.push(`| ${candidate.id} | ${pct(m.within_metrics.same_finger_different_rate)} | ${pct(m.boundary_metrics.same_finger_different_rate)} | ${num(m.single)} | ${num(m.within)} | ${num(m.boundary)} | ${num(m.overload)} |`);
}
lines.push('',
  '## 測試集覆蓋', '', '| 語料 | 有效字數 | 有效字對 | 字次覆蓋率 | 字對覆蓋率 | 多音字比例 |', '| --- | ---: | ---: | ---: | ---: | ---: |');
for (const corpus of ['classical', 'modern']) {
  const s = models[corpus].test.stats;
  lines.push(`| ${corpus} | ${s.valid_characters} | ${s.valid_pairs} | ${pct(s.character_coverage)} | ${pct(s.pair_coverage)} | ${pct(s.polyphonic_share)} |`);
}
lines.push('', `全部四個鍵表已通過 ${rows.length} 音節完整三鍵無碰撞驗證。用鍵數維持 24／23／21；JSON 可直接交給 build:rime。預設鍵表未變更。`, '',
  '## 候選檔案', '',
  '- 古文：[配置](classical.json)、[鍵表](classical.keyboard.tsv)。',
  '- 現代：[配置](modern.json)、[鍵表](modern.keyboard.tsv)。',
  '- 混合：[配置](mixed.json)、[鍵表](mixed.keyboard.tsv)。', '',
  '## 係數敏感度', '', '| 鍵表 | 同指係數 ×0.5 的混合成本 | 同指係數 ×2 的混合成本 |', '| --- | ---: | ---: |');
for (const candidate of candidates) lines.push(`| ${candidate.id} | ${num(candidate.sensitivity['same_finger_x0.5'])} | ${num(candidate.sensitivity.same_finger_x2)} |`);
lines.push('', '係數變動只作候選評估，未重新搜尋，也不以這些測試分數選種子。', '',
  '## 重現', '', '```sh', 'npm run fetch:layout-corpora', 'npm run prepare:layouts',
  `npm run search:layouts -- --iterations ${iterations} --seeds ${seeds.join(',')}`, 'npm run test:layouts',
  'npm run build:rime -- --layout .cache/layout-analysis/base-search/mixed.json --out dist/rime-mixed', '```', '',
  '完整分項、指負荷、train/dev/test 結果見 report.json；倉庫的 config/layout-analysis-sources.json 記錄來源與許可，base-frequencies.json 記錄矩陣及覆蓋率。成本設定在 config/keyboard-cost.json。', '',
  '來源：[chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)（倉庫 MIT）；[UD Chinese GSD](https://github.com/UniversalDependencies/UD_Chinese-GSD)（標註 CC BY-SA 4.0，原始內容權利另見來源說明）。只保存衍生統計，下載原文位於本地快取。', '',
  '尚未計入三鍵動作、真實選字／上屏、個人指法、按鍵時間實測。最優僅指本次各目標的有限種子搜尋結果。', '');
fs.writeFileSync(path.join(out, 'Report.md'), lines.join('\n'));
console.log(`候選與報告：${out}`);
