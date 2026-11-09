"""Regressions for the warrior jump's fixed equipment and continuous motion.

These tests use the checked-in artwork. They protect source identity and numeric
motion properties; they do not replace the separate full-frame visual review.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

import cv2
import numpy as np


TOOLS = Path(__file__).resolve().parent
SOURCE = TOOLS.parent / 'source'


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


motion = load_module('identity_motion_test_target', TOOLS / 'identity-motion.py')
render = load_module('identity_render_test_target', TOOLS / 'render.py')


class FixedEquipmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = motion.read_rgba(SOURCE / 'base-keyframes/warrior/frame-00.png')
        cls.generated = motion.read_rgba(SOURCE / 'expressions/warrior/happy-face.png')
        cls.config = json.loads((SOURCE / 'expressions/warrior/happy-face.json').read_text())
        cls.rig = motion.WarriorHappyJump(cls.base, cls.generated, cls.config)

    def test_expression_cannot_change_equipment_or_alpha(self):
        before = self.base.copy()
        edit, mask = motion.face_components(self.base, self.generated, self.config)
        self.assertGreater(np.count_nonzero(mask), 500)
        # All equipment is outside this tight face-only rectangle, including
        # the tiara above it and shoulder armor beside/below it.
        allowed = np.zeros(mask.shape, dtype=bool)
        allowed[140:196, 280:371] = True
        self.assertFalse(np.any(mask[~allowed]))
        for strength in (0, .25, .5, .75, 1):
            with self.subTest(strength=strength):
                result = motion.apply_face(self.base, edit, mask, strength)
                self.assertTrue(np.array_equal(result[mask == 0], self.base[mask == 0]))
                self.assertTrue(np.array_equal(result[~allowed], self.base[~allowed]))
                self.assertTrue(np.array_equal(result[200:], self.base[200:]))
                self.assertTrue(np.array_equal(result[:, :, 3], self.base[:, :, 3]))
                if strength == 0:
                    self.assertTrue(np.array_equal(result, self.base))
                else:
                    self.assertGreater(np.count_nonzero(result != self.base), 100)
        self.assertTrue(np.array_equal(self.base, before))

    def test_first_last_and_loop_endpoint_are_exact_master(self):
        for time in (0, 479 / 60, 8):
            with self.subTest(time=time):
                frame = self.rig.frame(time)
                self.assertTrue(np.array_equal(frame, self.base))
                self.assertFalse(np.shares_memory(frame, self.base))
        # A visible jump is required, so passing by returning a still image is
        # not enough to satisfy the identity invariants.
        chest = np.array([[325., 230.]], dtype=np.float64)
        apex = self.rig.forward(chest, 1.8)
        self.assertGreater(chest[0, 1] - apex[0, 1], 25)
        self.assertGreater(self.rig.expression_weight(1.8), .99)

    def test_rigid_sword_shield_and_chest_regions_keep_dimensions(self):
        regions = {
            'shield': [[379., 210.], [399., 210.], [399., 260.], [379., 260.]],
            'sword': [[266., 271.], [282., 271.], [282., 300.], [266., 300.]],
            'chest': [[315., 206.], [336., 206.], [336., 241.], [315., 241.]],
        }
        for name, points in regions.items():
            source = np.array(points, dtype=np.float64)
            expected = np.linalg.norm(source[:, None] - source[None, :], axis=2)
            for time in (.9, 1.8, 2.6, 4.8, 5.6):
                with self.subTest(region=name, time=time):
                    moved = self.rig.forward(source, time)
                    actual = np.linalg.norm(moved[:, None] - moved[None, :], axis=2)
                    np.testing.assert_allclose(actual, expected, atol=.01, rtol=0)

    def test_position_and_velocity_join_continuously(self):
        # Exercise time joins at anticipation, takeoff, landing, follow-through
        # and rest, using actual body/equipment locations rather than only the
        # scalar channel helpers.
        boundaries = (.55, .75, .85, 1.25, 2.35, 2.85, 3.05,
                      3.55, 3.75, 3.85, 4.25, 5.35, 5.85, 6.05)
        points = np.array([[325., 230.], [388., 238.], [276., 290.],
                           [282., 254.], [368., 254.], [306., 315.],
                           [345., 315.], [235., 270.], [323., 130.]], dtype=np.float64)
        step = 1e-5
        for time in boundaries:
            with self.subTest(time=time):
                left = self.rig.forward(points, time - step)
                center = self.rig.forward(points, time)
                right = self.rig.forward(points, time + step)
                self.assertLess(float(np.max(np.abs(right - left))), .01)
                v_left = (center - left) / step
                v_right = (right - center) / step
                self.assertLess(float(np.max(np.abs(v_right - v_left))), .1)
        for time in (.45, .65, 6.05, 6.25):
            with self.subTest(expression_join=time):
                left = self.rig.expression_weight(time - step)
                center = self.rig.expression_weight(time)
                right = self.rig.expression_weight(time + step)
                self.assertLess(abs(right - 2 * center + left) / step, .02)

    def test_key_poses_have_no_mesh_fold_or_inverse_jump(self):
        for time in (.9, 1.8, 2.6, 4.8, 5.6):
            with self.subTest(time=time):
                inverse = self.rig.inverse_map(time)
                actual = self.rig.forward(inverse, time)
                visible = cv2.remap(self.base[:, :, 3], inverse, None, cv2.INTER_NEAREST,
                                    borderMode=cv2.BORDER_CONSTANT) > 32
                residual = np.linalg.norm(actual - self.rig.grid, axis=2)
                self.assertLess(float(residual[visible].max()), .02)
                diagnostics = self.rig.diagnostic(time)
                self.assertGreater(diagnostics['jacobian_min_on_visible_source'], .2)

    def test_invalid_face_mask_is_rejected(self):
        invalid = dict(self.config, mask_polygon=[[310, 210], [340, 210],
                                                   [340, 240], [310, 240]])
        with self.assertRaisesRegex(ValueError, 'inside the face'):
            motion.WarriorHappyJump(self.base, self.generated, invalid)

    def test_nonfinite_time_is_rejected(self):
        for time in (float('nan'), float('inf'), -float('inf')):
            with self.subTest(time=time):
                with self.assertRaisesRegex(ValueError, 'finite'):
                    self.rig.frame(time)


class FixedSourceRoutingTests(unittest.TestCase):
    def test_repaired_action_does_not_consume_old_jump_drawings(self):
        warrior = {'class': 'warrior', 'name': '开心蹦跳'}
        paths = {p.relative_to(SOURCE).as_posix() for p in render.input_images(warrior)}
        self.assertEqual(paths, {'base-keyframes/warrior/frame-00.png',
                                 'expressions/warrior/happy-face.png'})
        self.assertNotIn('sheets/warrior/happy-jump.png', paths)
        for class_id in render.CLASSES:
            if class_id == 'warrior':
                continue
            with self.subTest(class_id=class_id):
                task = {'class': class_id, 'name': '开心蹦跳'}
                self.assertFalse(render.fixed_identity_action(task))
                self.assertEqual(render.source_list(task),
                                 [SOURCE / 'sheets' / class_id / 'happy-jump.png'])

    def test_expression_and_motion_changes_invalidate_cached_provenance(self):
        task = {'class': 'warrior', 'name': '开心蹦跳'}
        original = render.render_provenance(task)
        sources = {x['path']: x['sha256'] for x in original['source_sheets']}
        metadata = {x['path']: x['sha256'] for x in original['source_metadata']}
        code = {x['path']: x['sha256'] for x in original['renderer_inputs']}
        self.assertIn('expressions/warrior/happy-face.png', sources)
        self.assertIn('expressions/warrior/happy-face.json', metadata)
        self.assertIn('tools/identity-motion.py', code)
        self.assertEqual(code['tools/identity-motion.py'],
                         hashlib.sha256((TOOLS / 'identity-motion.py').read_bytes()).hexdigest())
        # Mutate independent temporary copies; the source artwork may be
        # hardlinked to delivered assets and must never be touched by tests.
        with tempfile.TemporaryDirectory(prefix='dafeiyu-identity-source-') as directory:
            source = Path(directory) / 'source'
            for name in set(sources) | set(metadata):
                destination = source / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(SOURCE / name, destination)
            with mock.patch.object(render, 'SOURCE', source):
                self.assertEqual(render.render_provenance(task), original)
                alignment = source / 'expressions/warrior/happy-face.json'
                alignment.write_bytes(alignment.read_bytes() + b'\n')
                modified_config = render.render_provenance(task)
                self.assertNotEqual(modified_config['source_metadata'], original['source_metadata'])
                self.assertEqual(modified_config['source_sheets'], original['source_sheets'])
                texture = source / 'expressions/warrior/happy-face.png'
                texture.write_bytes(texture.read_bytes() + b'\n')
                modified_texture = render.render_provenance(task)
                self.assertNotEqual(modified_texture['source_sheets'], original['source_sheets'])


if __name__ == '__main__':
    unittest.main()
