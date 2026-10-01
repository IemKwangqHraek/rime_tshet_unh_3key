// 獨立擴充，保留第一輪模型及結果的可重現性。
import { increment, mixModels, evaluate, identity, random } from './layout_model.mjs';

export const windowNames = ['within', 'cross_231', 'cross_312'];
const tripleID = (a, b, c) => (a * 78 + b) * 78 + c;
const keyID = (a, b, c) => (a * 26 + b) * 26 + c;
const unpack = map => [...map].sort((a, b) => a[0] - b[0]).map(([id, w]) =>
  [Math.floor(id / 6084), Math.floor(id / 78) % 78, id % 78, w]);

export function compileTrigrams(counts, readings) {
  const within = new Map(), cross231 = new Map(), cross312 = new Map();
  const N = counts.stats.valid_characters;
  if (!N) throw new Error('語料沒有可映射的漢字');
  for (const [char, n] of counts.chars) {
    const rs = readings.get(char);
    for (const [a, b, c] of rs) increment(within, tripleID(a, b, c), n / rs.length / N);
  }
  for (const [pair, n] of counts.pairs) {
    const [x, y] = pair.split('\t'), left = readings.get(x), right = readings.get(y);
    const w = n / left.length / right.length / N;
    // 相同音節的兩段保持聯合分佈，不將各段的邊際概率相乘。
    for (const l of left) for (const r of right) {
      increment(cross231, tripleID(l[1], l[2], r[0]), w);
      increment(cross312, tripleID(l[2], r[0], r[1]), w);
    }
  }
  return { within: unpack(within), cross_231: unpack(cross231), cross_312: unpack(cross312) };
}

export function mixTrigramModels(models, weights) {
  const base = mixModels(models, weights), trigrams = {};
  for (const name of windowNames) {
    const map = new Map();
    models.forEach((m, i) => {
      if (!weights[i]) return;
      for (const [a, b, c, w] of m.trigrams[name]) increment(map, tripleID(a, b, c), w * weights[i]);
    });
    trigrams[name] = unpack(map);
  }
  return { ...base, trigrams };
}

export function classifyTriple(keys, a, b, c) {
  const x = keys[a], y = keys[b], z = keys[c];
  const fx = x.finger, fy = y.finger, fz = z.finger;
  const hx = Math.floor(fx / 4), hy = Math.floor(fy / 4), hz = Math.floor(fz / 4);
  const sameHand = hx === hy && hy === hz;
  const d1 = fy - fx, d2 = fz - fy;
  const redirect = sameHand && d1 * d2 < 0;
  const roll = sameHand && d1 * d2 > 0;
  const inward = roll && (hx === 0 ? d1 > 0 : d1 < 0);
  const skip = hx === hz && hx !== hy && fx === fz && a !== c;
  return { redirect, skip_same_finger: skip,
    skip_distance: skip ? Math.hypot(x.x - z.x, x.y - z.y) : 0,
    inward_roll: inward, outward_roll: roll && !inward,
    triple_same_finger: fx === fy && fy === fz };
}

export function trigramKeyboard(baseKeyboard, config, weight = config.weight) {
  for (const value of [weight, config.redirect, config.skip_same_finger, config.skip_distance]) {
    if (!Number.isFinite(value) || value < 0) throw new Error('三鍵係數須爲非負有限數');
  }
  const costs = new Float64Array(26 ** 3), features = [];
  for (let a = 0; a < 26; a++) for (let b = 0; b < 26; b++) for (let c = 0; c < 26; c++) {
    const id = keyID(a, b, c), f = classifyTriple(baseKeyboard.keys, a, b, c);
    features[id] = f;
    costs[id] = weight * (Number(f.redirect) * config.redirect +
      Number(f.skip_same_finger) * config.skip_same_finger + f.skip_distance * config.skip_distance);
  }
  return { ...baseKeyboard, triple: costs, triple_features: features, triple_weight: weight, triple_config: config };
}

export function evaluateTrigrams(model, mapping, keyboard, detail = false) {
  const base = evaluate(model, mapping, keyboard, detail);
  let tripleCost = 0;
  const windows = {};
  for (const name of windowNames) {
    let cost = 0, n = 0;
    const counts = { redirect: 0, skip_same_finger: 0, inward_roll: 0, outward_roll: 0, triple_same_finger: 0 };
    for (const [a, b, c, w] of model.trigrams[name]) {
      const id = keyID(mapping[a], mapping[b], mapping[c]);
      cost += w * keyboard.triple[id];
      if (detail) {
        n += w;
        for (const metric of Object.keys(counts)) counts[metric] += w * Number(keyboard.triple_features[id][metric]);
      }
    }
    tripleCost += cost;
    if (detail) windows[name] = { cost, windows_per_character: n, counts_per_character: counts,
      rates: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, n ? v / n : null])) };
  }
  if (!detail) return base + tripleCost;
  const all = { cost: tripleCost, windows_per_character: 0, counts_per_character: {}, rates: {} };
  for (const w of Object.values(windows)) {
    all.windows_per_character += w.windows_per_character;
    for (const [k, v] of Object.entries(w.counts_per_character)) all.counts_per_character[k] = (all.counts_per_character[k] || 0) + v;
  }
  for (const [k, v] of Object.entries(all.counts_per_character)) all.rates[k] = v / all.windows_per_character;
  return { ...base, pair_model_cost: base.cost, cost: base.cost + tripleCost,
    triple_cost: tripleCost, triple_metrics: { ...windows, all } };
}

// 增量評分：交換同槽兩組只重算含其中任一組的二鍵／三鍵項，以及 78 組單鍵負荷。
export function swapScorer(model, keyboard) {
  const terms = [...model.within, ...model.boundary].filter(t => t[2] > 0).map(([a, b, w]) => [a, b, -1, w]);
  if (keyboard.triple_weight) for (const name of windowNames) terms.push(...model.trigrams[name]);
  const incident = Array.from({ length: 78 }, () => []);
  terms.forEach((term, id) => {
    for (const g of new Set(term.slice(0, 3).filter(x => x >= 0))) incident[g].push(id);
  });
  const affected = new Map();
  for (let slot = 0; slot < 78; slot += 26) for (let a = slot; a < slot + 25; a++) for (let b = a + 1; b < slot + 26; b++) {
    affected.set(a * 78 + b, [...new Set([...incident[a], ...incident[b]])]);
  }
  const termValue = (mapping, id) => {
    const [a, b, c, w] = terms[id];
    return w * (c < 0 ? keyboard.pair[mapping[a] * 26 + mapping[b]] : keyboard.triple[keyID(mapping[a], mapping[b], mapping[c])]);
  };
  const singleAndLoad = mapping => {
    const loads = new Float64Array(8); let cost = 0;
    for (let g = 0; g < 78; g++) {
      const k = mapping[g], w = model.single[g];
      cost += w * keyboard.single[k]; loads[keyboard.keys[k].finger] += w / 3;
    }
    for (let f = 0; f < 8; f++) cost += keyboard.profile.overload_weight * Math.max(0, loads[f] - keyboard.profile.load_targets[f]) ** 2;
    return cost;
  };
  return (mapping, a, b) => {
    if (a === b || Math.floor(a / 26) !== Math.floor(b / 26)) throw new Error('交換須爲同槽不同組');
    if (a > b) [a, b] = [b, a];
    const ids = affected.get(a * 78 + b);
    let before = singleAndLoad(mapping);
    for (const id of ids) before += termValue(mapping, id);
    [mapping[a], mapping[b]] = [mapping[b], mapping[a]];
    let after = singleAndLoad(mapping);
    for (const id of ids) after += termValue(mapping, id);
    [mapping[a], mapping[b]] = [mapping[b], mapping[a]];
    return after - before;
  };
}

export function optimizeTrigrams(model, keyboard, { seed = 1, iterations = 20000, initial = identity(), shuffled = false } = {}) {
  const rng = random(seed), mapping = [...initial], delta = swapScorer(model, keyboard);
  for (let slot = 0; slot < 78; slot += 26) {
    if (mapping.slice(slot, slot + 26).sort((a, b) => a - b).join(',') !== identity().slice(0, 26).join(',')) throw new Error('初始配鍵非槽內排列');
  }
  if (shuffled) for (let slot = 0; slot < 78; slot += 26) for (let i = 25; i > 0; i--) {
    const a = slot + i, b = slot + Math.floor(rng() * (i + 1)); [mapping[a], mapping[b]] = [mapping[b], mapping[a]];
  }
  let current = evaluateTrigrams(model, mapping, keyboard), bestCost = current, best = [...mapping];
  for (let step = 0; step < iterations; step++) {
    const slot = Math.floor(rng() * 3) * 26, a = slot + Math.floor(rng() * 26);
    let b = slot + Math.floor(rng() * 25); if (b >= a) b++;
    const change = delta(mapping, a, b), temperature = 0.06 * (0.0001 / 0.06) ** (step / iterations);
    if (change <= 0 || rng() < Math.exp(-change / temperature)) {
      [mapping[a], mapping[b]] = [mapping[b], mapping[a]]; current += change;
      if (current < bestCost - 1e-12) { bestCost = current; best = [...mapping]; }
    }
    if (step % 1000 === 999) current = evaluateTrigrams(model, mapping, keyboard);
  }
  bestCost = evaluateTrigrams(model, best, keyboard);
  let passes = 0;
  while (true) {
    let chosen = null, change = -1e-11;
    for (let slot = 0; slot < 78; slot += 26) for (let a = slot; a < slot + 25; a++) for (let b = a + 1; b < slot + 26; b++) {
      const d = delta(best, a, b);
      if (d < change) { chosen = [a, b]; change = d; }
    }
    if (!chosen) break;
    const [a, b] = chosen; [best[a], best[b]] = [best[b], best[a]]; passes++;
  }
  return { mapping: best, cost: evaluateTrigrams(model, best, keyboard), seed, iterations, local_passes: passes };
}
