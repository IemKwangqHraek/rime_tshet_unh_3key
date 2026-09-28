// 共用全拼詞典，三拼只更換 prism；不從三段拼回全拼（爹等有例外）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { root, scheme, raw, source, TshetUinh } from './derive.mjs';

const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const stable = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const tsv = rows => rows.map(row => row.join('\t')).join('\n') + '\n';
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function syllables() {
  const sources = JSON.parse(read('data/sources.json'));
  const positions = new Map([...TshetUinh.資料.iter音韻地位()].map(p => [p.描述, p]));
  for (const d of sources.scope.legacy_only_positions) positions.set(d, TshetUinh.音韻地位.from描述(d));
  const full = scheme(), parts = scheme({ 輸出: '三段' });
  const rows = [...positions].map(([position, p]) => ({ position, full: full(p),
    parts: parts(p).split(' / ').map(s => s === '∅' ? '' : s) }));
  rows.push({ position: '補充：怎', full: raw({}, null, '怎'), parts: ['ts', 'v', 'mq'] });
  return rows.sort((a, b) => stable(a.full, b.full));
}

export function encodeLayout(layout, rows) {
  if (!object(layout) || layout.version !== 1 || typeof layout.name !== 'string' ||
      !layout.name.trim() || /[\r\n]/.test(layout.name) || !object(layout.keys)) fail('鍵位配置需有 version: 1、單行 name 及 keys');
  if (Object.keys(layout.keys).sort().join() !== 'k1,k2,k3') fail('keys 必須且只能包含 k1、k2、k3');
  for (const [i, name] of ['k1', 'k2', 'k3'].entries()) {
    const map = layout.keys[name];
    if (!object(map)) fail(`${name} 必須是「片段: 按鍵」物件`);
    const needed = new Set(rows.map(row => row.parts[i]));
    for (const part of needed) {
      if (!Object.hasOwn(map, part)) fail(`${name} 漏配片段「${part || '∅'}」`);
    }
    for (const [part, key] of Object.entries(map)) {
      if (!needed.has(part)) fail(`${name} 未知片段「${part || '∅'}」`);
      if (typeof key !== 'string' || !/^[a-z]$/.test(key)) fail(`${name}「${part || '∅'}」需配置單個小寫 a–z 按鍵`);
    }
  }
  const fulls = new Set(), codes = new Map();
  return rows.map(row => {
    if (!/^[a-z]+$/.test(row.full) || fulls.has(row.full)) fail(`全拼非法或重複：${row.full}`);
    fulls.add(row.full);
    const code = row.parts.map((s, i) => layout.keys[`k${i + 1}`][s]).join('');
    if (codes.has(code)) fail(`三拼碰撞 ${code}：${codes.get(code)}／${row.position} ${row.full}`);
    codes.set(code, `${row.position} ${row.full}`);
    return { ...row, code };
  });
}

export function dictionary(rows, phraseText) {
  const valid = new Set(rows.map(row => row.full));
  const full = scheme(), entries = new Map(), readings = new Map();
  let sourceEntries = 0;
  const skipped = [];
  function add(text, code, weight = 100) {
    if (!valid.has(code)) fail(`字典讀音未納入三拼：${text} ${code}`);
    entries.set(`${text}\t${code}`, [text, code, weight]);
    if (!readings.has(text)) readings.set(text, new Set());
    readings.get(text).add(code);
  }
  for (const entry of TshetUinh.資料.廣韻.iter條目()) {
    sourceEntries++;
    if (!entry.音韻地位) {
      skipped.push({ text: entry.字頭, reason: '上游無有效音韻地位', source: entry.來源 });
      continue;
    }
    if (!/^\p{Unified_Ideograph}$/u.test(entry.字頭)) fail(`未處理的上游字頭：${entry.字頭}`);
    add(entry.字頭, full(entry.音韻地位, entry.字頭));
  }
  add('怎', raw({}, null, '怎'));
  const characterEntries = entries.size;
  for (const [i, line] of phraseText.split(/\r?\n/).entries()) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [text, code, weight, ...extra] = line.split('\t');
    const syllables = code?.split(' ') || [];
    if (extra.length || !text || !/^[a-z]+(?: [a-z]+)+$/.test(code || '') ||
        !/^[1-9]\d*$/.test(weight || '') || !Number.isSafeInteger(Number(weight)) ||
        [...text].length !== syllables.length) fail(`phrases.tsv 第 ${i + 1} 行格式錯誤`);
    [...text].forEach((char, j) => {
      if (!readings.get(char)?.has(syllables[j])) fail(`phrases.tsv 第 ${i + 1} 行：${char} 沒有讀音 ${syllables[j]}`);
    });
    const id = `${text}\t${code}`;
    if (entries.has(id)) fail(`phrases.tsv 第 ${i + 1} 行重複：${id}`);
    entries.set(id, [text, code, Number(weight)]);
  }
  return { entries: [...entries.values()].sort((a, b) => stable(a[1], b[1]) || stable(a[0], b[0])),
    sourceEntries, skipped, characterEntries, phraseEntries: entries.size - characterEntries };
}

export function build(layout, phraseText = read('rime/phrases.tsv')) {
  const rows = encodeLayout(layout, syllables());
  const dict = dictionary(rows, phraseText);
  const layoutHash = sha256(JSON.stringify(layout));
  const dictBody = tsv(dict.entries);
  const template = read('rime/templates/schema.yaml');
  // 小寫全拼先逐條轉爲大寫三鍵，最後統一轉小寫，防止輸出再次匹配另一條規則。
  const algebra = rows.map(row => `xform/^${row.full}$/${row.code.toUpperCase()}/`);
  algebra.push('xlit/ABCDEFGHIJKLMNOPQRSTUVWXYZ/abcdefghijklmnopqrstuvwxyz/');
  const render = (id, name, speller, version, layoutName) => template.replace(/\{\{(\w+)\}\}/g,
    (_, token) => ({ ID: id, NAME: JSON.stringify(name), VERSION: JSON.stringify(version),
      LAYOUT: layoutName, SPELLER: speller })[token] ?? fail(`未知模板欄位 ${token}`));
  const keyboardRows = [...'abcdefghijklmnopqrstuvwxyz'].map(key => [key, ...['k1', 'k2', 'k3'].map(name =>
    Object.entries(layout.keys[name]).filter(([, k]) => k === key).map(([s]) => s).sort().map(s => s || '∅').join(' / '))]);
  const stats = { format_version: 1, layout: layout.name, layout_sha256: layoutHash,
    scheme_sha256: sha256(source), dictionary_sha256: sha256(dictBody),
    runtime: JSON.parse(read('data/sources.json')).runtime,
    syllables: rows.length, three_key_collisions: 0,
    key_counts: ['k1', 'k2', 'k3'].map(name => new Set(Object.values(layout.keys[name])).size),
    source_entries: dict.sourceEntries, skipped_entries: dict.skipped,
    character_entries: dict.characterEntries, phrase_entries: dict.phraseEntries };
  const files = {
    'preng.schema.yaml': render('preng', '中古漢語·全拼', '  algebra: []', '1', '不適用（全拼）'),
    'preng_sp.schema.yaml': render('preng_sp', '中古漢語·三拼',
      '  algebra:\n' + algebra.map(rule => `    - ${JSON.stringify(rule)}`).join('\n'), `1.${layoutHash.slice(0, 12)}`, layout.name),
    'preng.dict.yaml': '# Rime dictionary\n# encoding: utf-8\n# 字音來源：tshet-uinh 0.15.4（MIT），另補「怎」；詳見 SOURCES.txt。\n---\nname: preng\n' +
      `version: "1.${sha256(dictBody).slice(0, 12)}"\nsort: by_weight\nuse_preset_vocabulary: false\ncolumns: [text, code, weight]\n...\n` + dictBody,
    'default.custom.yaml.example': 'patch:\n  schema_list:\n    - schema: preng\n    - schema: preng_sp\n',
    'codes.tsv': tsv([['音韻地位', '全拼', '第一段', '第二段', '第三段', '三拼'],
      ...rows.map(row => [row.position, row.full, ...row.parts, row.code])]),
    'keyboard.tsv': tsv([['按鍵', '第一段', '第二段', '第三段'], ...keyboardRows]),
    'build.json': json(stats),
    'SOURCES.txt': read('rime/SOURCES.txt') + '\n\n--- tshet-uinh LICENSE ---\n' + read('node_modules/tshet-uinh/LICENSE'),
  };
  return { files, rows, algebra, stats };
}

function main(args) {
  let layoutPath = path.join(root, 'config/keyboards/default.json');
  let out = path.join(root, 'dist/rime');
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') {
      console.log('npm run build:rime -- [--layout config/keyboards/default.json] [--out dist/rime]');
      return;
    }
    if (!['--layout', '--out'].includes(arg) || !args[i + 1] || args[i + 1].startsWith('--')) fail(`未知或缺少值的參數：${arg}`);
    if (arg === '--layout') layoutPath = path.resolve(args[++i]);
    else out = path.resolve(args[++i]);
  }
  const { files, stats } = build(JSON.parse(fs.readFileSync(layoutPath, 'utf8')));
  // 所有驗證完成才寫檔，無效鍵表不覆寫上次可用的輸出。
  fs.mkdirSync(out, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(out, name), content);
  console.log(`已生成 ${out}：${stats.syllables} 音節、${stats.character_entries} 字音、${stats.phrase_entries} 詞條；三拼無碰撞。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
