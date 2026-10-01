import fs from 'node:fs';
import path from 'node:path';
import { root, source as schemeSource } from './derive.mjs';
import { hash, readJSON, writeJSON, readingTable, countTexts, compileCounts } from './layout_model.mjs';

const manifestPath = path.join(root, 'config/layout-analysis-sources.json');
const manifest = readJSON(manifestPath), base = readJSON(path.join(root, 'config/keyboards/baseline.json'));
const sourceFiles = new Map();
for (const source of manifest.sources) {
  const raw = fs.readFileSync(path.join(root, '.cache/layout-corpora', source.id));
  if (hash(raw) !== source.sha256) throw new Error(`來源校驗失敗：${source.id}`);
  sourceFiles.set(source.id, raw.toString('utf8'));
}
const readings = readingTable(base);
const documents = { classical: { train: [], dev: [], test: [] }, modern: { train: [], dev: [], test: [] } };
const seen = new Set(), duplicates = { classical: 0, modern: 0 };
for (const id of manifest.corpora.classical.source_ids) {
  for (const poem of JSON.parse(sourceFiles.get(id))) {
    if (!Array.isArray(poem.paragraphs) || !poem.paragraphs.every(p => typeof p === 'string')) throw new Error(`唐詩格式不符：${id}`);
    const text = poem.paragraphs.join('\n'), digest = hash(text);
    if (seen.has(digest)) { duplicates.classical++; continue; }
    seen.add(digest);
    const bucket = Number.parseInt(digest.slice(0, 8), 16) % 10;
    documents.classical[bucket === 0 ? 'test' : bucket === 1 ? 'dev' : 'train'].push(text);
  }
}
for (const split of ['test', 'dev', 'train']) {
  for (const line of sourceFiles.get(`gsd-${split}`).split(/\r?\n/)) {
    if (!line.startsWith('# text = ')) continue;
    const text = line.slice(9), digest = hash(text);
    if (seen.has(digest)) { duplicates.modern++; continue; }
    seen.add(digest); documents.modern[split].push(text);
  }
}
const models = {};
for (const corpus of ['classical', 'modern']) {
  models[corpus] = {};
  for (const split of ['train', 'dev', 'test']) {
    const texts = documents[corpus][split];
    if (!texts.length) throw new Error(`沒有文本：${corpus}/${split}`);
    const counted = countTexts(texts, readings);
    const model = compileCounts(counted, readings);
    model.stats.text_sha256 = hash(JSON.stringify(texts));
    model.stats.top_characters = [...counted.chars].sort((a, b) => b[1] - a[1]).slice(0, 30);
    model.stats.top_pairs = [...counted.pairs].sort((a, b) => b[1] - a[1]).slice(0, 30);
    models[corpus][split] = model;
    console.log(`${corpus}/${split}: ${model.stats.valid_characters} 字，${model.stats.valid_pairs} 字對，字次覆蓋 ${(100 * model.stats.character_coverage).toFixed(2)}%`);
  }
}
const result = { version: 1, manifest_sha256: hash(fs.readFileSync(manifestPath)),
  base_layout_sha256: hash(JSON.stringify(base)), scheme_sha256: hash(schemeSource),
  reading_table_sha256: hash(JSON.stringify([...readings])),
  preparation_sha256: hash(fs.readFileSync(new URL(import.meta.url))),
  model_code_sha256: hash(fs.readFileSync(new URL('./layout_model.mjs', import.meta.url))),
  duplicates_removed: duplicates, models };
fs.mkdirSync(path.join(root, '.cache/layout-analysis'), { recursive: true });
writeJSON(path.join(root, '.cache/layout-analysis/base-frequencies.json'), result);
