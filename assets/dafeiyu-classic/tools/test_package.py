"""Standard-library safety regressions using tiny, non-playable EBML fixtures."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock
import zipfile

import package
from build_state import INCOMPLETE, build_lock


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='dafeiyu-package-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.asset = self.root / 'asset'
        self.source = self.asset / 'source'
        self.source.mkdir(parents=True)
        project = Path(__file__).resolve().parent.parent
        shutil.copytree(project / 'manifests', self.asset / 'manifests')
        shutil.copyfile(project / 'source/action-plan.json', self.source / 'action-plan.json')
        for name in ('IMPORT.txt', 'ATTRIBUTION.txt'):
            (self.asset / name).write_text('Temporary packaging test document.\n', encoding='utf-8')
        self.manifests = package.validate_manifests(self.asset)
        self.packs = self.root / 'packs'
        directory = self.packs / 'warrior'
        directory.mkdir(parents=True)
        self.index = {'version': package.VERSION, 'files': []}
        for class_id, item in self.manifests.items():
            for name in item['manifest']['files']:
                content = package.EBML + f'{class_id}/{name}'.encode('utf-8')
                self.index['files'].append({
                    'path': f'packs/{class_id}/{name}', 'bytes': len(content),
                    'sha256': hashlib.sha256(content).hexdigest(),
                })
                if class_id == 'warrior':
                    (directory / name).write_bytes(content)
        (directory / 'pack.json').write_bytes(self.manifests['warrior']['raw'])
        self.write_index()
        self.media = directory / self.manifests['warrior']['manifest']['files'][0]
        self.output = self.root / 'test.zip'

    def write_index(self):
        (self.source / 'media-index.json').write_text(json.dumps(self.index), encoding='utf-8')

    def verified(self, **kwargs):
        return package.verify_media(self.asset, self.packs, ('warrior',), **kwargs)

    def archive(self, records=None, overwrite=False):
        manifests, docs, current, _ = self.verified()
        return package.create_archive(self.output, ('warrior',), manifests, docs,
                                      current if records is None else records, overwrite)

    def test_crc_contents_and_explicit_overwrite(self):
        result = self.archive()
        self.assertEqual(result['entries'], 123)
        self.assertTrue(result['crcVerified'])
        with zipfile.ZipFile(self.output) as archive:
            self.assertIsNone(archive.testzip())
            names = archive.namelist()
            self.assertEqual(sum(name.endswith('.webm') for name in names), 120)
            self.assertEqual(sum(name.endswith('/pack.json') for name in names), 1)
            self.assertFalse(any('/source/' in name for name in names))
        original = self.output.read_bytes()
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.archive()
        self.assertEqual(self.output.read_bytes(), original)
        self.archive(overwrite=True)
        self.assertTrue(zipfile.is_zipfile(self.output))
        self.assertEqual(list(self.root.glob('.dafeiyu-*.partial.zip')), [])

    def test_failed_atomic_overwrite_preserves_existing_archive(self):
        self.archive()
        original = self.output.read_bytes()
        records = self.verified()[2]
        records[0] = dict(records[0], sha256='0' * 64)
        with self.assertRaisesRegex(ValueError, 'changed after verification'):
            self.archive(records=records, overwrite=True)
        self.assertEqual(self.output.read_bytes(), original)
        self.assertEqual(list(self.root.glob('.dafeiyu-*.partial.zip')), [])

    def test_insufficient_disk_space_creates_no_archive(self):
        usage = shutil.disk_usage(self.root)._replace(free=1)
        with mock.patch.object(package.shutil, 'disk_usage', return_value=usage):
            with self.assertRaisesRegex(ValueError, 'Insufficient free disk'):
                self.archive()
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.glob('.dafeiyu-*.partial.zip')), [])

    def test_default_accepts_new_hash_but_release_mode_requires_exact_bytes(self):
        original = self.media.read_bytes()
        self.media.write_bytes(original + b'changed-container-metadata')
        report = self.verified()[3]
        self.assertTrue(report['mediaIndexCoverageVerified'])
        self.assertFalse(report['pinnedMediaHashesVerified'])
        with self.assertRaisesRegex(ValueError, 'Media index mismatch'):
            self.verified(release_hashes=True)
        self.media.write_bytes(original)
        self.assertTrue(self.verified(release_hashes=True)[3]['pinnedMediaHashesVerified'])

    def test_traversal_and_windows_path_forms_are_rejected(self):
        for relative in ('../escape', '/absolute', 'a/../../x', 'a\\b', 'a/C:drive', 'a//b', './file'):
            with self.subTest(relative=relative):
                with self.assertRaisesRegex(ValueError, 'relative path'):
                    package.safe_child(self.asset, relative)

    def test_media_index_traversal_and_missing_entries_are_rejected(self):
        self.index['files'][0]['path'] = 'packs/warrior/../escape.webm'
        self.write_index()
        with self.assertRaisesRegex(ValueError, 'Unsafe relative path'):
            self.verified()
        self.index['files'].pop(0)
        self.write_index()
        with self.assertRaisesRegex(ValueError, 'exactly all 960'):
            self.verified()

    def test_bad_signature_and_unlisted_files_are_rejected(self):
        original = self.media.read_bytes()
        self.media.write_bytes(b'not-ebml')
        with self.assertRaisesRegex(ValueError, 'Invalid file signature'):
            self.verified()
        self.media.write_bytes(original)
        (self.media.parent / 'unlisted.webm').write_bytes(package.EBML)
        with self.assertRaisesRegex(ValueError, 'Unexpected or missing pack files'):
            self.verified()

    def test_failed_render_is_not_packaged_even_without_a_manifest(self):
        (self.media.parent / INCOMPLETE).write_text('{}', encoding='utf-8')
        (self.media.parent / 'pack.json').unlink()
        with self.assertRaisesRegex(ValueError, 'Incomplete render'):
            self.archive()
        self.assertFalse(self.output.exists())

    def test_cli_cannot_package_during_a_render(self):
        with build_lock(self.packs.parent):
            result = package.main(['--asset-root', str(self.asset), '--packs', str(self.packs),
                                   '--class', 'warrior', '--output', str(self.output)])
        self.assertEqual(result, 1)
        self.assertFalse(self.output.exists())

    def test_media_symlinks_are_rejected(self):
        target = self.root / 'target.webm'
        target.write_bytes(self.media.read_bytes())
        self.media.unlink()
        try:
            self.media.symlink_to(target)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f'Symlink creation is unavailable: {error}')
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            self.verified()

    def test_old_release_plan_or_manifest_cannot_be_relabelled_by_packaging(self):
        plan_path = self.source / 'action-plan.json'
        plan = json.loads(plan_path.read_text())
        plan['releaseVersion'] = '0.3.1'
        plan_path.write_text(json.dumps(plan))
        with self.assertRaisesRegex(ValueError, 'Action plan release version'):
            package.validate_manifests(self.asset)
        plan['releaseVersion'] = package.VERSION
        plan_path.write_text(json.dumps(plan))
        manifest_path = self.asset / 'manifests/warrior/pack.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['id'] = 'dafeiyu-classic-warrior-full-v031'
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'Manifest identity differs'):
            package.validate_manifests(self.asset)
        manifest['id'] = f'dafeiyu-classic-warrior-full-v{package.VERSION.replace(".", "")}'
        manifest['name'] = manifest['name'].replace(package.VERSION, '0.3.1')
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'Manifest display name differs'):
            package.validate_manifests(self.asset)


if __name__ == '__main__':
    unittest.main()
