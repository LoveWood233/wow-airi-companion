"""Source-index integrity regressions; fixture PNG headers are not artwork."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('verify_source', Path(__file__).with_name('verify-source.py'))
verify_source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_source)


class SourceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='dafeiyu-source-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        project = Path(__file__).resolve().parent.parent
        shutil.copytree(project / 'manifests', self.root / 'manifests')
        shutil.copyfile(project / 'source/action-plan.json', self.source / 'action-plan.json')
        self.index = {'finalAtlases': 144, 'files': [], 'baseKeyframes': [], 'expressions': []}
        for section, directory, per_class in [('files', 'sheets', 18), ('baseKeyframes', 'base-keyframes', 16)]:
            for class_id in verify_source.checks.CLASSES:
                for i in range(per_class):
                    self.index[section].append(self.png(f'{directory}/{class_id}/frame-{i:02d}.png'))
        self.index['expressions'].append(self.png('expressions/warrior/happy-face.png'))
        self.write_index()

    def png(self, relative):
        path = self.source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        data = verify_source.PNG + relative.encode('utf-8')
        path.write_bytes(data)
        return {'path': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

    def write_index(self):
        (self.source / 'source-index.json').write_text(json.dumps(self.index))

    def verify(self):
        return verify_source.verify(self.root)

    def test_expression_adds_to_all_272_original_sources(self):
        report = self.verify()
        self.assertEqual(report['sourceHashes']['files']['files'], 144)
        self.assertEqual(report['sourceHashes']['baseKeyframes']['files'], 128)
        self.assertEqual(report['sourceHashes']['expressions']['files'], 1)
        self.assertEqual(report['manifests'], 8)

    def test_extra_unindexed_png_is_rejected(self):
        self.png('expressions/warrior/unlisted.png')
        with self.assertRaisesRegex(ValueError, 'Source PNG file set differs'):
            self.verify()

    def test_changed_expression_pixels_fail_hash_check(self):
        path = self.source / 'expressions/warrior/happy-face.png'
        path.write_bytes(path.read_bytes() + b'changed')
        with self.assertRaisesRegex(ValueError, 'Source SHA256 mismatch'):
            self.verify()

    def test_duplicate_expression_is_rejected(self):
        self.index['expressions'] *= 2
        self.write_index()
        with self.assertRaisesRegex(ValueError, 'Duplicate source index path'):
            self.verify()

    def test_expression_traversal_is_rejected(self):
        self.index['expressions'][0]['path'] = 'expressions/warrior/../../escape.png'
        self.write_index()
        with self.assertRaisesRegex(ValueError, 'Unsafe relative path'):
            self.verify()

    def test_expression_cannot_replace_a_required_base_keyframe(self):
        self.index['baseKeyframes'].pop()
        self.index['expressions'].append(self.png('expressions/warrior/another-face.png'))
        self.write_index()
        with self.assertRaisesRegex(ValueError, 'Expected 128 source entries'):
            self.verify()

    def test_required_expression_cannot_be_omitted_or_renamed(self):
        self.index['expressions'] = []
        self.write_index()
        with self.assertRaisesRegex(ValueError, 'must list expression PNG'):
            self.verify()
        self.index['expressions'].append(self.png('expressions/warrior/another-face.png'))
        self.write_index()
        with self.assertRaisesRegex(ValueError, 'Missing required warrior'):
            self.verify()

    def test_expression_symlink_is_rejected(self):
        path = self.source / 'expressions/warrior/happy-face.png'
        target = self.root / 'outside.png'
        target.write_bytes(path.read_bytes())
        path.unlink()
        try:
            path.symlink_to(target)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f'Symlink creation is unavailable: {error}')
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
