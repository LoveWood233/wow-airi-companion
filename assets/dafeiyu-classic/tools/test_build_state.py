"""Failure/coordination regressions; no image processing or video subprocesses."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from build_state import INCOMPLETE, atomic_bytes, build_lock, temporary_path

spec = importlib.util.spec_from_file_location('transaction_render', Path(__file__).with_name('render.py'))
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)


class BuildStateTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.pack = self.root / 'packs' / 'warrior'
        self.pack.mkdir(parents=True)
        self.selected = [t for t in render.tasks() if t['class'] == 'warrior']
        self.manifests = render.complete_manifests(self.selected)
        (self.pack / 'pack.json').write_bytes(self.manifests['warrior'])
        for task in self.selected:
            (self.pack / (task['name'] + '.webm')).write_bytes(b'old media fixture')

    def test_overlapping_build_rejected_and_lock_reusable(self):
        with build_lock(self.root):
            with self.assertRaises(OSError):
                with build_lock(self.root):
                    self.fail('overlapping build acquired lock')
        with build_lock(self.root):
            self.assertTrue((self.root / '.render.lock').is_file())

    def test_orphan_worker_cannot_publish_into_a_later_build(self):
        parent = Mock()
        parent.is_alive.return_value = False
        with patch.object(render.multiprocessing, 'parent_process', return_value=parent):
            with self.assertRaisesRegex(RuntimeError, 'owner exited'):
                render.ensure_owner_alive()

    def test_unique_temporary_files_do_not_truncate_each_other(self):
        target = self.pack / 'same.webm'
        target.write_bytes(b'published')
        with temporary_path(target) as first:
            first.write_bytes(b'first writer')
            with temporary_path(target) as second:
                second.write_bytes(b'second writer')
                self.assertNotEqual(first, second)
                self.assertEqual(first.read_bytes(), b'first writer')
            self.assertTrue(first.exists())
        self.assertFalse(first.exists())
        self.assertFalse(second.exists())
        self.assertEqual(target.read_bytes(), b'published')

    def test_failed_or_partial_rebuild_is_not_importable(self):
        for selected, failures in ((self.selected, [('warrior', self.selected[-1]['name'])]),
                                   (self.selected[:1], [])):
            with self.subTest(actions=len(selected)):
                render.begin_render(self.root, selected)
                self.assertFalse((self.pack / 'pack.json').exists())
                (self.pack / (selected[0]['name'] + '.webm')).write_bytes(b'new fixture')
                manifests = render.complete_manifests(selected)
                render.publish_manifests(self.root, selected, failures, manifests)
                self.assertTrue((self.pack / INCOMPLETE).is_file())
                self.assertFalse((self.pack / 'pack.json').exists())

    def test_complete_success_restores_manifest_and_clears_marker(self):
        render.begin_render(self.root, self.selected)
        result = render.publish_manifests(self.root, self.selected, [], self.manifests)
        self.assertEqual(result[0]['manifest_status'], 'written')
        self.assertEqual((self.pack / 'pack.json').read_bytes(), self.manifests['warrior'])
        self.assertFalse((self.pack / INCOMPLETE).exists())

    def test_failed_publication_keeps_marker_and_no_manifest(self):
        render.begin_render(self.root, self.selected)
        with patch.object(render, 'atomic_bytes', side_effect=OSError('disk full')):
            with self.assertRaisesRegex(OSError, 'disk full'):
                render.publish_manifests(self.root, self.selected, [], self.manifests)
        self.assertTrue((self.pack / INCOMPLETE).exists())
        self.assertFalse((self.pack / 'pack.json').exists())

    def test_marker_removal_failure_revokes_the_new_manifest(self):
        render.begin_render(self.root, self.selected)
        original_unlink = Path.unlink
        def deny_marker_removal(path, *args, **kwargs):
            if path.name == INCOMPLETE:
                raise OSError('marker removal failed')
            return original_unlink(path, *args, **kwargs)
        with patch.object(Path, 'unlink', deny_marker_removal):
            with self.assertRaisesRegex(OSError, 'marker removal failed'):
                render.publish_manifests(self.root, self.selected, [], self.manifests)
        self.assertTrue((self.pack / INCOMPLETE).exists())
        self.assertFalse((self.pack / 'pack.json').exists())

    def test_missing_media_prevents_publication(self):
        render.begin_render(self.root, self.selected)
        (self.pack / (self.selected[-1]['name'] + '.webm')).unlink()
        with self.assertRaisesRegex(RuntimeError, 'WebM is missing'):
            render.publish_manifests(self.root, self.selected, [], self.manifests)
        self.assertTrue((self.pack / INCOMPLETE).exists())
        self.assertFalse((self.pack / 'pack.json').exists())

    def test_atomic_write_failure_preserves_old_record(self):
        target = self.root / 'record.json'
        target.write_bytes(b'old record')
        with patch('build_state.os.replace', side_effect=OSError('replace failed')):
            with self.assertRaises(OSError):
                atomic_bytes(target, json.dumps({'status': 'new'}).encode('utf-8'))
        self.assertEqual(target.read_bytes(), b'old record')
        self.assertEqual(list(self.root.glob('.record-*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
