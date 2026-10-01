import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, source as schemeSource } from './derive.mjs';
import { hash, readJSON, readingTable, countTexts, compileCounts } from './layout_model.mjs';
import { compileTrigrams } from './layout_trigrams.mjs';

const file = name => path.join(root, name);
const base = readJSON(file('config/keyboards/baseline.json'));
const old = readJSON(file('.cache/layout-analysis/base-frequencies.json'));
const manifest = readJSON(file('config/layout-analysis-sources.json'));
assert.equal(old.base_layout_sha256, hash(JSON.stringify(base)), '第一輪基準鍵表已變動');
assert.equal(old.scheme_sha256, hash(schemeSource), '第一輪拼音規則已變動');
assert.equal(old.manifest_sha256, hash(fs.readFileSync(file('config/layout-analysis-sources.json'))));
const sources = new Map();
for (const s of manifest.sources) {
  const raw = fs.readFileSync(file(`.cache/layout-corpora/${s.id}`));
  assert.equal(hash(raw), s.sha256, `語料校驗失敗：${s.id}`); sources.set(s.id, raw.toString('utf8'));
}
// 重用第一輪的確定性抽取政策，並逐集合驗證文本雜湊及全部一／二階統計完全相同。
const documents = { classical: { train: [], dev: [], test: [] }, modern: { train: [], dev: [], test: [] } };
const seen = new Set();
for (const id of manifest.corpora.classical.source_ids) for (const poem of JSON.parse(sources.get(id))) {
  const text = poem.paragraphs.join('\n'), digest = hash(text);
  if (seen.has(digest)) continue; seen.add(digest);
  const bucket = Number.parseInt(digest.slice(0, 8), 16) % 10;
  documents.classical[bucket === 0 ? 'test' : bucket === 1 ? 'dev' : 'train'].push(text);
}
for (const split of ['test', 'dev', 'train']) for (const line of sources.get(`gsd-${split}`).split(/\r?\n/)) {
  if (!line.startsWith('# text = ')) continue;
  const text = line.slice(9), digest = hash(text);
  if (seen.has(digest)) continue; seen.add(digest); documents.modern[split].push(text);
}
const readings = readingTable(base), trigrams = {};
assert.equal(old.reading_table_sha256, hash(JSON.stringify([...readings])), '字音表已變動');
for (const corpus of ['classical', 'modern']) {
  trigrams[corpus] = {};
  for (const split of ['train', 'dev', 'test']) {
    const texts = documents[corpus][split], previous = old.models[corpus][split];
    assert.equal(hash(JSON.stringify(texts)), previous.stats.text_sha256);
    const counts = countTexts(texts, readings), check = compileCounts(counts, readings);
    for (const key of ['single', 'within', 'boundary']) assert.deepEqual(check[key], previous[key]);
    const t = compileTrigrams(counts, readings);
    trigrams[corpus][split] = t;
    console.log(`${corpus}/${split}: ${Object.values(t).map(x => x.length).join('/')} 種三鍵窗口`);
  }
}
const result = { version: 1, base_frequency_sha256: hash(fs.readFileSync(file('.cache/layout-analysis/base-frequencies.json'))),
  preparation_sha256: hash(fs.readFileSync(new URL(import.meta.url))),
  trigram_code_sha256: hash(fs.readFileSync(new URL('./layout_trigrams.mjs', import.meta.url))), trigrams };
fs.mkdirSync(file('.cache/layout-analysis'), { recursive: true });
fs.writeFileSync(file('.cache/layout-analysis/trigram-frequencies.json'), JSON.stringify(result) + '\n');
