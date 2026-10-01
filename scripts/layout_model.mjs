// 固定共鍵組：以「槽位 * 26 + 基準鍵索引」標識組，配鍵可作任意槽內排列。
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dictionary, syllables, encodeLayout } from './build_rime.mjs';

export const alphabet = 'abcdefghijklmnopqrstuvwxyz';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const writeJSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
export const increment = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);
export const han = c => /^\p{Unified_Ideograph}$/u.test(c);

export function readingTable(base) {
  const rows = syllables();
  const codes = new Map(encodeLayout(base, rows).map(r => [r.full,
    [...r.code].map((key, slot) => slot * 26 + alphabet.indexOf(key))]));
  const readings = new Map();
  for (const [char, full] of dictionary(rows, '').entries) {
    if (!readings.has(char)) readings.set(char, new Map());
    readings.get(char).set(full, codes.get(full));
  }
  return new Map([...readings].map(([char, rs]) => [char, [...rs.values()]]));
}

export function countTexts(texts, readings) {
  const chars = new Map(), pairs = new Map(), missing = new Map(), allTypes = new Set();
  let total = 0, potentialPairs = 0;
  for (const text of texts) {
    let prev = null, prevHan = false;
    for (const char of text) {
      const isHan = han(char);
      if (isHan) { total++; allTypes.add(char); if (prevHan) potentialPairs++; }
      prevHan = isHan;
      if (!isHan || !readings.has(char)) {
        if (isHan) increment(missing, char);
        prev = null;
        continue;
      }
      increment(chars, char);
      if (prev !== null) increment(pairs, `${prev}\t${char}`);
      prev = char;
    }
  }
  const N = [...chars.values()].reduce((a, b) => a + b, 0);
  const B = [...pairs.values()].reduce((a, b) => a + b, 0);
  const poly = [...chars].reduce((sum, [c, n]) => sum + (readings.get(c).length > 1 ? n : 0), 0);
  return { chars, pairs, stats: {
    documents: texts.length, han_characters: total, valid_characters: N, valid_pairs: B,
    potential_pairs: potentialPairs, character_coverage: total ? N / total : 0,
    type_coverage: allTypes.size ? chars.size / allTypes.size : 0,
    pair_coverage: potentialPairs ? B / potentialPairs : 0,
    polyphonic_share: N ? poly / N : 0,
    missing: [...missing].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  } };
}

export function compileCounts(counts, readings) {
  const single = new Float64Array(78), within = new Map(), boundary = new Map();
  const { valid_characters: N } = counts.stats;
  if (!N) throw new Error('語料沒有可映射的漢字');
  for (const [char, count] of counts.chars) {
    const rs = readings.get(char), weight = count / rs.length / N;
    for (const code of rs) {
      for (const group of code) single[group] += weight;
      increment(within, code[0] * 78 + code[1], weight);
      increment(within, code[1] * 78 + code[2], weight);
    }
  }
  for (const [pair, count] of counts.pairs) {
    const [a, b] = pair.split('\t'), left = readings.get(a), right = readings.get(b);
    const weight = count / left.length / right.length / N;
    for (const l of left) for (const r of right) increment(boundary, l[2] * 78 + r[0], weight);
  }
  const edges = map => [...map].sort((a, b) => a[0] - b[0]).map(([id, w]) => [Math.floor(id / 78), id % 78, w]);
  return { single: [...single], within: edges(within), boundary: edges(boundary), stats: counts.stats };
}

export function mixModels(models, weights) {
  if (models.length !== weights.length || weights.some(w => !Number.isFinite(w) || w < 0) ||
      Math.abs(weights.reduce((a, b) => a + b, 0) - 1) > 1e-9) throw new Error('語料權重需非負且總和爲 1');
  const single = new Float64Array(78), within = new Map(), boundary = new Map();
  models.forEach((model, i) => {
    for (let g = 0; g < 78; g++) single[g] += model.single[g] * weights[i];
    for (const [a, b, w] of model.within) increment(within, a * 78 + b, w * weights[i]);
    for (const [a, b, w] of model.boundary) increment(boundary, a * 78 + b, w * weights[i]);
  });
  const edges = map => [...map].map(([id, w]) => [Math.floor(id / 78), id % 78, w]);
  return { single: [...single], within: edges(within), boundary: edges(boundary) };
}

export function keyboardModel(profile) {
  const keys = Array(26);
  profile.rows.forEach((row, y) => [...row].forEach((key, x) => {
    keys[alphabet.indexOf(key)] = { x: x + profile.row_offsets[y], y, finger: profile.fingers[y][x] };
  }));
  if (keys.filter(Boolean).length !== 26) throw new Error('鍵盤模型必須包含 26 個鍵');
  const homes = [...profile.home_keys].map((key, i) => key === ';'
    ? { x: 9.25, y: 1 } : keys[alphabet.indexOf(key)]);
  const single = keys.map(k => profile.finger_cost[k.finger] + profile.row_cost[k.y] +
    profile.reach_cost * Math.hypot(k.x - homes[k.finger].x, k.y - homes[k.finger].y));
  const pair = new Float64Array(26 * 26), sfb = new Uint8Array(26 * 26), repeat = new Uint8Array(26 * 26);
  for (let a = 0; a < 26; a++) for (let b = 0; b < 26; b++) {
    const k = keys[a], l = keys[b], id = a * 26 + b;
    sfb[id] = a !== b && k.finger === l.finger ? 1 : 0;
    repeat[id] = a === b ? 1 : 0;
    pair[id] = sfb[id] * (profile.same_finger_different + profile.same_finger_distance * Math.hypot(k.x - l.x, k.y - l.y)) +
      repeat[id] * profile.repeat + (Math.floor(k.finger / 4) === Math.floor(l.finger / 4)
        ? Math.abs(k.y - l.y) * profile.same_hand_row_distance : 0);
  }
  return { keys, single, pair, sfb, repeat, profile };
}

export const identity = () => Array.from({ length: 78 }, (_, i) => i % 26);

export function evaluate(model, mapping, keyboard, detail = false) {
  const loads = new Float64Array(8);
  let single = 0, within = 0, boundary = 0, home = 0;
  for (let g = 0; g < 78; g++) {
    const k = mapping[g], w = model.single[g];
    single += w * keyboard.single[k];
    loads[keyboard.keys[k].finger] += w / 3;
    if (detail && keyboard.keys[k].y === 1) home += w / 3;
  }
  for (const [a, b, w] of model.within) within += w * keyboard.pair[mapping[a] * 26 + mapping[b]];
  for (const [a, b, w] of model.boundary) boundary += w * keyboard.pair[mapping[a] * 26 + mapping[b]];
  const overload = keyboard.profile.overload_weight * loads.reduce((s, v, i) =>
    s + Math.max(0, v - keyboard.profile.load_targets[i]) ** 2, 0);
  const cost = single + within + boundary + overload;
  if (!detail) return cost;
  const metrics = edges => {
    let n = 0, sfb = 0, repeat = 0;
    for (const [a, b, w] of edges) {
      const id = mapping[a] * 26 + mapping[b];
      n += w; sfb += w * keyboard.sfb[id]; repeat += w * keyboard.repeat[id];
    }
    return { pairs_per_character: n, same_finger_different_rate: n ? sfb / n : null, repeat_rate: n ? repeat / n : null };
  };
  return { cost, single, within, boundary, overload, finger_loads: [...loads],
    left_share: loads.slice(0, 4).reduce((a, b) => a + b, 0), home_share: home,
    within_metrics: metrics(model.within), boundary_metrics: metrics(model.boundary),
    all_pair_metrics: metrics([...model.within, ...model.boundary]) };
}

export function toLayout(base, mapping, name) {
  return { version: 1, name, keys: Object.fromEntries(['k1', 'k2', 'k3'].map((slot, i) => [slot,
    Object.fromEntries(Object.entries(base.keys[slot]).map(([part, key]) =>
      [part, alphabet[mapping[i * 26 + alphabet.indexOf(key)]]]))])) };
}

export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function optimize(model, keyboard, { seed = 1, iterations = 20000, shuffled = false } = {}) {
  const rng = random(seed), mapping = identity();
  if (shuffled) for (let slot = 0; slot < 3; slot++) for (let i = 25; i > 0; i--) {
    const a = slot * 26 + i, b = slot * 26 + Math.floor(rng() * (i + 1));
    [mapping[a], mapping[b]] = [mapping[b], mapping[a]];
  }
  let current = evaluate(model, mapping, keyboard), bestCost = current, best = [...mapping];
  for (let step = 0; step < iterations; step++) {
    const slot = Math.floor(rng() * 3) * 26, a = slot + Math.floor(rng() * 26);
    let b = slot + Math.floor(rng() * 25); if (b >= a) b++;
    [mapping[a], mapping[b]] = [mapping[b], mapping[a]];
    const next = evaluate(model, mapping, keyboard);
    const temperature = 0.06 * (0.0001 / 0.06) ** (step / iterations);
    if (next <= current || rng() < Math.exp((current - next) / temperature)) current = next;
    else [mapping[a], mapping[b]] = [mapping[b], mapping[a]];
    if (current < bestCost) { bestCost = current; best = [...mapping]; }
  }
  // 退火後作確定性 best-improvement，直至沒有單次槽內交換可改進。
  let passes = 0;
  while (true) {
    let chosen = null, nextCost = bestCost;
    for (let slot = 0; slot < 78; slot += 26) for (let a = slot; a < slot + 25; a++) for (let b = a + 1; b < slot + 26; b++) {
      [best[a], best[b]] = [best[b], best[a]];
      const score = evaluate(model, best, keyboard);
      [best[a], best[b]] = [best[b], best[a]];
      if (score < nextCost - 1e-12) { chosen = [a, b]; nextCost = score; }
    }
    if (!chosen) break;
    const [a, b] = chosen; [best[a], best[b]] = [best[b], best[a]];
    bestCost = nextCost; passes++;
  }
  return { mapping: best, cost: bestCost, seed, iterations, local_passes: passes };
}
