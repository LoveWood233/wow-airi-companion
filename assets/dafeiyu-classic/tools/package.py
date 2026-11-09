#!/usr/bin/env python3
"""Verify or package the eight class packs without changing source assets.

Uses only the Python standard library. Full codec/alpha decoding and the pinned
native importer checks are separate validation steps; an EBML signature alone
does not establish playable VP9 media.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import zipfile

CLASSES = ('warrior', 'hunter', 'mage', 'rogue', 'paladin', 'warlock', 'priest', 'druid')
VERSION = '0.3.2'
DEFAULT_ROOT = Path(__file__).resolve().parent.parent
FILE_LIMIT = 32 * 1024**2
PACK_LIMIT = 512 * 1024**2
EBML = b'\x1a\x45\xdf\xa3'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def root_directory(path):
    path = Path(path).expanduser().absolute()
    require(not path.is_symlink() and path.is_dir(), f'Not a real directory: {path.name}')
    return path.resolve(strict=True)


def safe_child(root, relative):
    require(isinstance(relative, str) and relative and '\\' not in relative and '\0' not in relative,
            'Invalid relative path')
    parts = relative.split('/')
    require(all(part not in ('', '.', '..') and ':' not in part for part in parts),
            f'Unsafe relative path: {relative}')
    path = root
    for part in parts:
        path = path / part
        require(not path.is_symlink(), f'Symlink is not allowed: {relative}')
    return path


def reject_symlinks(root):
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            require(not (Path(directory) / name).is_symlink(), f'Symlink is not allowed: {name}')


def stable_file(path, consume):
    initial = path.lstat()
    require(stat.S_ISREG(initial.st_mode), f'Not a regular file: {path.name}')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0)
    with os.fdopen(os.open(path, flags), 'rb') as handle:
        before = os.fstat(handle.fileno())
        require(stat.S_ISREG(before.st_mode), f'Not a regular file: {path.name}')
        value = consume(handle)
        after = os.fstat(handle.fileno())
    current = path.lstat()
    signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    require(signature(initial) == signature(before) == signature(after) == signature(current), f'File changed while reading: {path.name}')
    return value, before.st_size


def read_bytes(path, limit=1024**2):
    def read(handle):
        data = handle.read(limit + 1)
        require(len(data) <= limit, f'File exceeds read limit: {path.name}')
        return data
    return stable_file(path, read)[0]


def _object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f'Duplicate JSON key: {key}')
        result[key] = value
    return result


def parse_json(data):
    def invalid_constant(value):
        raise ValueError(f'Invalid JSON constant: {value}')
    return json.loads(data, object_pairs_hook=_object, parse_constant=invalid_constant)


def read_json(path, limit=8 * 1024**2):
    return parse_json(read_bytes(path, limit))


def sha_file(path, *, signature=None, max_bytes=None):
    def digest(handle):
        if max_bytes is not None:
            require(os.fstat(handle.fileno()).st_size < max_bytes, f'File exceeds size limit: {path.name}')
        if signature is not None:
            require(handle.read(len(signature)) == signature, f'Invalid file signature: {path.name}')
            handle.seek(0)
        hasher = hashlib.sha256()
        for chunk in iter(lambda: handle.read(1024**2), b''):
            hasher.update(chunk)
        return hasher.hexdigest()
    digest, size = stable_file(path, digest)
    return {'sha256': digest, 'bytes': size}


def validate_manifests(asset_root):
    """Check plan agreement; historical interface preservation is checked separately."""
    plan = read_json(safe_child(asset_root, 'source/action-plan.json'))
    require(plan.get('releaseVersion') == VERSION, 'Action plan release version differs from package version')
    actions = plan['actions']
    require(len(actions) == 120 and len({a['name'] for a in actions}) == 120, 'Action plan must have 120 unique actions')
    require(sum(a['origin'] == 'original' for a in actions) == 114 and sum(a['origin'] == 'new' for a in actions) == 6,
            'Action plan must have 114 original and 6 added actions')
    expected = set()
    for action in actions:
        filename = action['file']
        require(filename == action['name'] + '.webm' and '/' not in filename, 'Invalid action filename')
        safe_child(asset_root, filename)
        expected.add(filename)
    require(len(plan['classes']) == 8 and {c['id'] for c in plan['classes']} == set(CLASSES), 'Action plan must name the eight supported classes')
    characters = {c['id']: c for c in plan['classes']}
    manifest_root = root_directory(safe_child(asset_root, 'manifests'))
    reject_symlinks(manifest_root)
    actual = {p.relative_to(manifest_root).as_posix() for p in manifest_root.rglob('*') if p.is_file()}
    require(actual == {f'{c}/pack.json' for c in CLASSES}, 'Manifest directory must contain exactly eight pack.json files')
    manifests = {}
    reference_mapping = None
    ids = set()
    new_names = {a['name'] for a in actions if a['origin'] == 'new'}
    for class_id in CLASSES:
        path = safe_child(manifest_root, f'{class_id}/pack.json')
        raw = read_bytes(path, 128 * 1024)
        manifest = parse_json(raw)
        require(manifest.get('version') == 1, f'Wrong manifest version: {class_id}')
        files = manifest['files']
        require(len(files) == len(set(files)) == 120 and set(files) == expected, f'Manifest action set differs from plan: {class_id}')
        require(isinstance(manifest.get('id'), str) and manifest['id'] and manifest['id'] not in ids, 'Manifest IDs must be unique')
        ids.add(manifest['id'])
        require(isinstance(manifest.get('name'), str) and manifest['name'], f'Missing pack name: {class_id}')
        character = characters[class_id]
        require(manifest['id'] == f'dafeiyu-classic-{class_id}-full-v{VERSION.replace(".", "")}',
                f'Manifest identity differs from release: {class_id}')
        require(manifest['name'] == f'大肥鱼·{character["label"]}·{character["set"]}（120动作 60fps v{VERSION}）',
                f'Manifest display name differs from release: {class_id}')
        categories = manifest['animations']['categories']
        emotions = [c for c in categories if c['id'] == '情绪']
        require(len(emotions) == 1 and len(emotions[0]['actions']) == 6 and set(emotions[0]['actions']) == new_names,
                f'Added emotion category differs from plan: {class_id}')
        animations = manifest['animations']
        mapped = [name for key in ('idle', 'turn', 'drag', 'clicks', 'baifan') for name in animations[key]]
        mapped += [name for category in categories for name in category['actions']]
        mapped += [name for states in animations['events'].values() for name in states]
        mapped += [name for cycle in animations['sleep'] for key in ('start', 'loop', 'end') for name in cycle[key]]
        mapped += [action['name'] for action in animations['moves']['actions']]
        known_names = {filename[:-5] for filename in files}
        require(set(mapped) == known_names,
                f'Mapped action names differ from manifest files: {class_id}')
        mapping = (manifest['animations'], manifest['animationWeights'])
        if reference_mapping is None:
            reference_mapping = mapping
        require(mapping == reference_mapping, f'Class animation mappings differ: {class_id}')
        manifests[class_id] = {'manifest': manifest, 'raw': raw}
    return manifests


def load_media_index(asset_root, supplied=None):
    path = Path(supplied).expanduser().absolute() if supplied else safe_child(asset_root, 'source/media-index.json')
    if not path.exists() and not supplied:
        return None
    require(not path.is_symlink(), 'Media index cannot be a symlink')
    data = read_json(path)
    require(data.get('version') == VERSION, 'Media index version differs from release')
    result = {}
    for entry in data['files']:
        relative = entry['path']
        safe_child(asset_root, relative)
        parts = relative.split('/')
        require(len(parts) == 3 and parts[0] == 'packs' and parts[1] in CLASSES and parts[2].endswith('.webm'), 'Invalid media index path')
        require(relative not in result, f'Duplicate media index entry: {relative}')
        require(isinstance(entry['bytes'], int) and 4 <= entry['bytes'] < FILE_LIMIT, 'Invalid media index file size')
        require(isinstance(entry['sha256'], str) and len(entry['sha256']) == 64 and all(c in '0123456789abcdef' for c in entry['sha256']), 'Invalid SHA256 in media index')
        result[relative] = entry
    return result


def verify_media(asset_root, packs_root, selected, index_path=None, release_hashes=False):
    manifests = validate_manifests(asset_root)
    for entry in packs_root.iterdir():
        require(entry.name in CLASSES and not entry.is_symlink() and entry.is_dir(), 'Packs root may contain only class directories')
    media_index = load_media_index(asset_root, index_path)
    require(not release_hashes or media_index is not None, '--release-hashes requires a media index')
    expected_index = {f'packs/{c}/{name}' for c, item in manifests.items() for name in item['manifest']['files']}
    if media_index is not None:
        require(set(media_index) == expected_index, 'Media index must cover exactly all 960 manifest files')
    records = []
    totals = []
    for class_id in selected:
        directory = root_directory(safe_child(packs_root, class_id))
        reject_symlinks(directory)
        item = manifests[class_id]
        filenames = item['manifest']['files']
        actual = {p.name for p in directory.iterdir()}
        require(actual in (set(filenames), set(filenames) | {'pack.json'}), f'Unexpected or missing pack files: {class_id}')
        if 'pack.json' in actual:
            require(read_json(safe_child(directory, 'pack.json'), 128 * 1024) == item['manifest'], f'Input pack.json differs from committed manifest: {class_id}')
        total = 0
        for name in filenames:
            path = safe_child(directory, name)
            info = sha_file(path, signature=EBML, max_bytes=FILE_LIMIT)
            require(4 <= info['bytes'] < FILE_LIMIT, f'Media exceeds native file limit: {class_id}/{name}')
            relative = f'packs/{class_id}/{name}'
            if release_hashes:
                require(all(info[k] == media_index[relative][k] for k in ('sha256', 'bytes')), f'Media index mismatch: {relative}')
            records.append({'path': path, 'relative': relative, **info})
            total += info['bytes']
        require(total < PACK_LIMIT, f'Pack exceeds native total limit: {class_id}')
        totals.append({'class': class_id, 'files': len(filenames), 'bytes': total})
    docs = {name: read_bytes(safe_child(asset_root, name)) for name in ('IMPORT.txt', 'ATTRIBUTION.txt')}
    require(all(docs.values()), 'Import and attribution documents must not be empty')
    report = {'status': 'media_verified', 'version': VERSION, 'classes': totals, 'mediaFiles': len(records),
              'mediaBytes': sum(r['bytes'] for r in records), 'mediaIndexCoverageVerified': media_index is not None,
              'pinnedMediaHashesVerified': release_hashes,
              'validationScope': 'Manifest and action-plan agreement, exact file sets, EBML signatures, size limits and SHA256; codec decoding and native importer execution are separate checks.'}
    return manifests, docs, records, report


def is_within(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def output_target(value, selected):
    path = Path(value).expanduser().absolute()
    if path.is_dir() or path.suffix.lower() != '.zip':
        suffix = selected[0] if len(selected) == 1 else 'eight-classes'
        path = path / f'dafeiyu-classic-v{VERSION}-{suffix}.zip'
    require(not path.is_symlink(), 'Archive output cannot be a symlink')
    return path


def create_archive(output, selected, manifests, docs, records, overwrite=False):
    require(not output.exists() or overwrite, 'Archive already exists; choose a new output or use --overwrite')
    require(not output.is_symlink() and (not output.exists() or output.is_file()), 'Invalid archive output')
    output.parent.mkdir(parents=True, exist_ok=True)
    estimated = sum(r['bytes'] for r in records) + sum(len(manifests[c]['raw']) for c in selected) + sum(map(len, docs.values()))
    require(shutil.disk_usage(output.parent).free >= estimated + 64 * 1024**2, 'Insufficient free disk space for a complete temporary archive plus 64 MiB reserve')
    prefix = f'dafeiyu-classic-v{VERSION}/'
    expected = {prefix + r['relative'] for r in records} | {prefix + f'packs/{c}/pack.json' for c in selected} | {prefix + n for n in docs}
    fd, name = tempfile.mkstemp(prefix='.dafeiyu-', suffix='.partial.zip', dir=output.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            for class_id in selected:
                archive.writestr(prefix + f'packs/{class_id}/pack.json', manifests[class_id]['raw'])
            for filename, content in docs.items():
                archive.writestr(prefix + filename, content)
            for record in records:
                def copy(handle):
                    hasher = hashlib.sha256()
                    with archive.open(prefix + record['relative'], 'w', force_zip64=True) as destination:
                        for chunk in iter(lambda: handle.read(1024**2), b''):
                            hasher.update(chunk)
                            destination.write(chunk)
                    return hasher.hexdigest()
                digest, size = stable_file(record['path'], copy)
                require(digest == record['sha256'] and size == record['bytes'], f'Media changed after verification: {record["relative"]}')
        with zipfile.ZipFile(temporary) as archive:
            names = archive.namelist()
            require(len(names) == len(set(names)) and set(names) == expected, 'Archive entries differ from validated inputs')
            require(archive.testzip() is None, 'Archive CRC verification failed')
        info = sha_file(temporary)
        with temporary.open('rb') as handle:
            os.fsync(handle.fileno())
        require(not output.is_symlink(), 'Archive output became a symlink')
        if overwrite:
            os.replace(temporary, output)
        else:
            # Atomic creation without a check-then-rename overwrite race.
            os.link(temporary, output)
            temporary.unlink()
        return {'name': output.name, **info, 'entries': len(expected), 'crcVerified': True}
    finally:
        if temporary.exists():
            temporary.unlink()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--asset-root', type=Path, default=DEFAULT_ROOT)
    parser.add_argument('--packs', type=Path, required=True, help='Directory containing class media directories')
    parser.add_argument('--output', type=Path, help='ZIP path or output directory; required unless --verify-only')
    parser.add_argument('--class', dest='class_id', choices=CLASSES, help='Verify/package one class for debugging')
    parser.add_argument('--media-index', type=Path, help='Override source/media-index.json')
    parser.add_argument('--release-hashes', action='store_true', help='Require exact original delivery bytes and SHA256; rebuilt WebM container metadata may differ')
    parser.add_argument('--verify-only', action='store_true', help='Validate inputs without creating any archive')
    parser.add_argument('--overwrite', action='store_true', help='Explicitly allow atomic replacement of the selected archive')
    args = parser.parse_args(argv)
    try:
        require(args.verify_only or args.output is not None, '--output is required when creating an archive')
        asset_root = root_directory(args.asset_root)
        packs_root = root_directory(args.packs)
        selected = (args.class_id,) if args.class_id else CLASSES
        output = output_target(args.output, selected) if args.output else None
        if output is not None:
            resolved_output = output.resolve(strict=False)
            require(not any(is_within(resolved_output, root) for root in (packs_root, asset_root / 'source', asset_root / 'manifests')),
                    'Archive output cannot be inside an input directory')
            if not args.verify_only:
                require(not output.exists() or args.overwrite, 'Archive already exists; choose a new output or use --overwrite')
        manifests, docs, records, report = verify_media(asset_root, packs_root, selected, args.media_index, args.release_hashes)
        if not args.verify_only:
            report['archive'] = create_archive(output, selected, manifests, docs, records, args.overwrite)
            report['status'] = 'archive_created_and_verified'
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError, AttributeError, zipfile.BadZipFile) as error:
        print(json.dumps({'status': 'failed', 'error': str(error)}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
