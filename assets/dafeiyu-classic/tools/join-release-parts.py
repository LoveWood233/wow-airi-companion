#!/usr/bin/env python3
"""Reassemble a release ZIP from verified byte parts using Python's standard library.

Example (run in the downloaded-parts directory):
    python join-release-parts.py example.zip --manifest release-assets.json

Parts are read in manifest order. No archive is extracted and existing output
is never overwritten. Publication uses an atomic hard link from a temporary
file in the output directory; the output filesystem must support hard links
(for example NTFS, APFS, or ext4). Unsupported filesystems fail without an
unsafe overwrite fallback.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

CHUNK_BYTES = 8 * 1024 * 1024
DEFAULT_MANIFEST = Path(__file__).resolve().parent.parent / 'release-assets.json'
SHA256 = re.compile(r'[0-9a-fA-F]{64}\Z')
WINDOWS_RESERVED = re.compile(r'(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)', re.I)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_basename(name):
    require(isinstance(name, str) and bool(name), 'File name must be a nonempty string')
    require(name not in ('.', '..') and not name.endswith((' ', '.')),
            f'Unsafe file name: {name!r}')
    require(not any(c in '<>:"/\\|?*' or ord(c) < 32 for c in name),
            f'Unsafe file name: {name!r}')
    require(not WINDOWS_RESERVED.match(name), f'Reserved file name: {name!r}')
    return name


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f'Duplicate JSON key: {key!r}')
        result[key] = value
    return result


def validate_file_record(record, keys):
    require(isinstance(record, dict) and set(record) == keys,
            f'File record must contain exactly {sorted(keys)}')
    safe_basename(record['name'])
    require(type(record['bytes']) is int and record['bytes'] >= 0,
            f'Invalid byte count: {record["name"]}')
    require(isinstance(record['sha256'], str) and SHA256.fullmatch(record['sha256']),
            f'Invalid SHA-256: {record["name"]}')


def load_manifest(path):
    with path.open('rb') as handle:
        raw = handle.read(8 * 1024 * 1024 + 1)
    require(len(raw) <= 8 * 1024 * 1024, 'Manifest exceeds 8 MiB')
    data = json.loads(raw, object_pairs_hook=unique_object)
    require(isinstance(data, dict) and set(data) == {'schema', 'assets'},
            'Manifest must contain exactly schema and assets')
    require(type(data['schema']) is int and data['schema'] == 1,
            'Only release-assets.json schema 1 is supported')
    require(isinstance(data['assets'], list) and bool(data['assets']),
            'Manifest assets must be a nonempty list')
    asset_names = set()
    for asset in data['assets']:
        validate_file_record(asset, {'name', 'bytes', 'sha256', 'parts'})
        key = asset['name'].casefold()
        require(key not in asset_names, f'Duplicate asset name: {asset["name"]}')
        asset_names.add(key)
        require(isinstance(asset['parts'], list) and bool(asset['parts']),
                f'Asset must have at least one part: {asset["name"]}')
        part_names = set()
        for part in asset['parts']:
            validate_file_record(part, {'name', 'bytes', 'sha256'})
            key = part['name'].casefold()
            require(key not in part_names and key != asset['name'].casefold(),
                    f'Duplicate or conflicting part name: {part["name"]}')
            part_names.add(key)
        require(sum(p['bytes'] for p in asset['parts']) == asset['bytes'],
                f'Part sizes do not sum to asset size: {asset["name"]}')
    return data


def join_asset(asset, parts_dir, output):
    require(parts_dir.is_dir(), f'Parts directory does not exist: {parts_dir}')
    require(output.parent.is_dir(), f'Output directory does not exist: {output.parent}')
    if os.path.lexists(output):
        raise FileExistsError(f'Output already exists; refusing to overwrite: {output}')
    # Fail early for missing parts. Hashes are checked on the bytes actually copied.
    for part in asset['parts']:
        path = parts_dir / part['name']
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode), f'Part is not a regular file: {path}')
        require(info.st_size == part['bytes'], f'Part size mismatch: {path.name}')

    temporary = None
    total = 0
    whole_hash = hashlib.sha256()
    try:
        with tempfile.NamedTemporaryFile(mode='wb', prefix='.join-release-',
                                         suffix='.tmp', dir=output.parent,
                                         delete=False) as destination:
            temporary = Path(destination.name)
            for part in asset['parts']:
                path = parts_dir / part['name']
                part_hash = hashlib.sha256()
                count = 0
                with path.open('rb') as source:
                    require(stat.S_ISREG(os.fstat(source.fileno()).st_mode),
                            f'Part is not a regular file: {path.name}')
                    while chunk := source.read(CHUNK_BYTES):
                        count += len(chunk)
                        require(count <= part['bytes'], f'Part grew while reading: {path.name}')
                        part_hash.update(chunk)
                        whole_hash.update(chunk)
                        destination.write(chunk)
                require(count == part['bytes'], f'Part size mismatch: {path.name}')
                require(part_hash.hexdigest() == part['sha256'].lower(),
                        f'Part SHA-256 mismatch: {path.name}')
                total += count
                print(f'Verified {part["name"]} ({count:,} bytes)', flush=True)
            require(total == asset['bytes'], 'Combined byte count mismatch')
            require(whole_hash.hexdigest() == asset['sha256'].lower(),
                    'Combined SHA-256 mismatch')
            destination.flush()
            os.fsync(destination.fileno())
        # Unlike os.replace, link creation atomically refuses an existing target,
        # including one created after the initial existence check. Same-directory
        # staging keeps both names on one filesystem. No incomplete output name
        # is exposed; interrupted runs can leave only an identifiable temp file.
        os.link(temporary, output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {'name': asset['name'], 'output': str(output), 'bytes': total,
            'sha256': whole_hash.hexdigest(), 'parts': len(asset['parts'])}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('name', metavar='NAME', help='Original asset name from release-assets.json')
    parser.add_argument('--manifest', type=Path, default=DEFAULT_MANIFEST,
                        help='Manifest path (default: release-assets.json beside the tools directory)')
    parser.add_argument('--parts-dir', type=Path, default=Path.cwd(),
                        help='Downloaded-parts directory (default: current directory)')
    parser.add_argument('--output', type=Path,
                        help='New output file (default: current directory / NAME; never overwritten)')
    args = parser.parse_args(argv)
    try:
        safe_basename(args.name)
        manifest = load_manifest(args.manifest.expanduser())
        asset = next((a for a in manifest['assets'] if a['name'] == args.name), None)
        require(asset is not None, f'Asset not found in manifest: {args.name}')
        output = (args.output or Path.cwd() / args.name).expanduser().absolute()
        result = join_asset(asset, args.parts_dir.expanduser().absolute(), output)
    except (OSError, ValueError) as exc:
        print(f'Error: {exc}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('Interrupted; incomplete output was discarded.', file=sys.stderr)
        return 130
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
