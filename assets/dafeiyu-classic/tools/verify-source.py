#!/usr/bin/env python3
"""Read-only verification of source PNG hashes and eight class manifests."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
import package as checks

PNG = b'\x89PNG\r\n\x1a\n'
REQUIRED_EXPRESSIONS = {'expressions/warrior/happy-face.png'}


def verify(asset_root):
    root = checks.root_directory(asset_root)
    source = checks.root_directory(checks.safe_child(root, 'source'))
    checks.reject_symlinks(source)
    index = checks.read_json(checks.safe_child(source, 'source-index.json'))
    checks.require(index.get('finalAtlases') == 144, 'Source index must declare 144 final atlases')
    expected = set()
    totals = {}
    for section, count, directory in [('files', 144, 'sheets'), ('baseKeyframes', 128, 'base-keyframes')]:
        rows = index[section]
        checks.require(len(rows) == count, f'Expected {count} source entries in {section}')
        per_class = {class_id: 0 for class_id in checks.CLASSES}
        total = 0
        for row in rows:
            relative = row['path']
            path = checks.safe_child(source, relative)
            parts = relative.split('/')
            checks.require(len(parts) == 3 and parts[0] == directory and parts[1] in checks.CLASSES and parts[2].endswith('.png'),
                           f'Invalid indexed PNG path: {relative}')
            checks.require(relative not in expected, f'Duplicate source index path: {relative}')
            expected.add(relative)
            actual = checks.sha_file(path, signature=PNG)
            checks.require(actual['sha256'] == row['sha256'], f'Source SHA256 mismatch: {relative}')
            if 'bytes' in row:
                checks.require(actual['bytes'] == row['bytes'], f'Source size mismatch: {relative}')
            total += actual['bytes']
            per_class[parts[1]] += 1
        checks.require(all(n == count // 8 for n in per_class.values()), f'Uneven per-class sources in {section}')
        totals[section] = {'files': count, 'bytes': total}
    # Expressions are additional immutable image inputs. They do not replace
    # or relax the existing 144-atlas / 128-keyframe integrity checks.
    expressions = index.get('expressions')
    checks.require(isinstance(expressions, list) and expressions,
                   'Source index must list expression PNG inputs')
    expression_paths = set()
    expression_bytes = 0
    for row in expressions:
        relative = row['path']
        path = checks.safe_child(source, relative)
        parts = relative.split('/')
        checks.require(len(parts) == 3 and parts[0] == 'expressions' and parts[1] in checks.CLASSES
                       and parts[2].endswith('.png'), f'Invalid expression PNG path: {relative}')
        checks.require(relative not in expected, f'Duplicate source index path: {relative}')
        expected.add(relative)
        expression_paths.add(relative)
        actual = checks.sha_file(path, signature=PNG)
        checks.require(actual['sha256'] == row['sha256'], f'Source SHA256 mismatch: {relative}')
        checks.require(actual['bytes'] == row['bytes'], f'Source size mismatch: {relative}')
        expression_bytes += actual['bytes']
    checks.require(REQUIRED_EXPRESSIONS <= expression_paths,
                   'Missing required warrior happy-face expression input')
    totals['expressions'] = {'files': len(expressions), 'bytes': expression_bytes}
    actual_pngs = {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file() and p.suffix.lower() == '.png'}
    checks.require(actual_pngs == expected, 'Source PNG file set differs from source-index.json')
    manifests = checks.validate_manifests(root)
    return {'status': 'source_verified', 'version': checks.VERSION, 'sourceHashes': totals,
            'manifests': len(manifests), 'actionsPerClass': 120, 'originalActionNames': 114, 'addedActionNames': 6,
            'validationScope': 'PNG signatures, exact source file sets, SHA256, eight manifests and action-plan agreement; historical runtime interface validation is a separate check.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--asset-root', type=Path, default=checks.DEFAULT_ROOT)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(verify(args.asset_root), ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(json.dumps({'status': 'failed', 'error': str(error)}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
