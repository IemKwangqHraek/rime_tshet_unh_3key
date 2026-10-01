"""Fetch pinned public corpus files; verify every byte against the source manifest."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def main():
    manifest = json.loads((ROOT / 'config/layout-analysis-sources.json').read_text())
    cache = ROOT / '.cache/layout-corpora'
    cache.mkdir(parents=True, exist_ok=True)
    for source in manifest['sources']:
        target = cache / source['id']
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == source['sha256']:
            print(f"verified {source['id']}")
            continue
        for attempt in range(4):
            try:
                with urllib.request.urlopen(source['url'], timeout=45) as response:
                    raw = response.read()
                if hashlib.sha256(raw).hexdigest() != source['sha256']:
                    raise ValueError(f"SHA-256 mismatch: {source['id']}")
                break
            except Exception:
                if attempt == 3:
                    raise
        temporary = target.with_suffix('.tmp')
        temporary.write_bytes(raw)
        temporary.replace(target)
        print(f"downloaded {source['id']}: {len(raw)} bytes")


if __name__ == '__main__':
    main()
