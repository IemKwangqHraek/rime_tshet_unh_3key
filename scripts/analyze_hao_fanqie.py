#!/usr/bin/env python3
"""核對豪等韻反切的唇音分群；只用 Python 標準庫，不據此推定元音音值。"""
import argparse
import csv
import hashlib
import io
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / '.cache/upstream/guangyun.csv')
    parser.add_argument('--check', action='store_true', help='只核對已提交的結果，不覆寫')
    args = parser.parse_args()
    sources = json.loads((ROOT / 'data/sources.json').read_text(encoding='utf-8'))
    info = sources['guangyun']
    raw = args.source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != info['source_sha256']:
        raise ValueError('原始資料 SHA-256 不符，請使用 data/sources.json 指定的固定版本')
    all_rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8'))))
    rows = [r for r in all_rows
            if r['音韻地位'] and r['字頭'] and not r['字頭'].startswith('｛')]
    original_positions = {r['音韻地位'] for r in rows}
    if (len(all_rows), len(rows), len(original_positions)) != (info['raw_entries'], info['retained_entries'], info['positions']):
        raise ValueError('來源條目／地位數與清單不一致')
    with (ROOT / 'data/positions.tsv').open(encoding='utf-8') as file:
        published = {r['音韻地位'] for r in csv.DictReader(file, delimiter='\t') if r['範圍'] != '本方案補充'}
    if original_positions != published - set(sources['scope']['current_only_positions']):
        raise ValueError('原始廣韻的地位集合與提交的聯集／差異清單不一致')
    labial = lambda p: '唇音' if p[0] in '幫滂並明' else '非唇音'
    output = ROOT / 'data/fanqie'
    output.mkdir(exist_ok=True)
    summaries, files = {}, {}
    for rhyme in ['豪', '唐', '寒', '談']:
        sub = [r for r in rows if r['音韻地位'][-2] == rhyme]
        heads = defaultdict(set)
        for row in sub:
            if len(row['字頭']) == 1:
                heads[row['字頭']].add(labial(row['音韻地位']))
        small_rhymes = {r['小韻號']: r for r in sub if r['小韻字號'] == '1'}
        counts, details = Counter(), []
        for row in small_rhymes.values():
            fan = row['反切']
            candidates = [fan[-1]] if len(fan) == 2 else []
            note = ''
            if fan == '博耗（秏）':
                candidates = ['耗', '秏']
                note = '明列兩個下字候選；僅在兩者均同群時歸類'
            categories = set().union(*(heads[c] for c in candidates)) if candidates else set()
            target = next(iter(categories)) if len(categories) == 1 and all(heads[c] for c in candidates) else '未定'
            own = labial(row['音韻地位'])
            counts[own + '→' + target] += 1
            details.append([row['小韻號'], row['字頭'], row['音韻地位'], fan,
                            own, '/'.join(candidates), target, note])
        summaries[rhyme] = {'small_rhymes': len(small_rhymes), 'links': dict(counts)}
        buffer = io.StringIO()
        writer = csv.writer(buffer, delimiter='\t', lineterminator='\n')
        writer.writerow(['小韻號', '字頭', '地位', '反切', '本字聲母群', '下字候選', '下字聲母群', '處理說明'])
        writer.writerows(details)
        files[rhyme + '-fanqie.tsv'] = buffer.getvalue()
    files['fanqie-summary.json'] = json.dumps(
        {'source_sha256': info['source_sha256'], 'rhymes': summaries}, ensure_ascii=False, indent=2) + '\n'
    for name, content in files.items():
        target = output / name
        if args.check:
            if target.read_text(encoding='utf-8') != content:
                raise ValueError(f'統計結果不一致：{target}')
        else:
            target.write_text(content, encoding='utf-8')
    print(json.dumps(summaries, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
