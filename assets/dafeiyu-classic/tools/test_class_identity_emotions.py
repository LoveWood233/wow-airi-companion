"""Identity, semantics routing and continuity invariants, not visual acceptance."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

TOOLS=Path(__file__).resolve().parent
SOURCE=TOOLS.parent/'source'
spec=importlib.util.spec_from_file_location('emotion_motion_test_target',TOOLS/'class-identity-motion.py')
motion=importlib.util.module_from_spec(spec);spec.loader.exec_module(motion)
render_spec=importlib.util.spec_from_file_location('emotion_render_test_target',TOOLS/'render.py')
render=importlib.util.module_from_spec(render_spec);render_spec.loader.exec_module(render)


class Utf8MotionConfigTests(unittest.TestCase):
    def test_chinese_config_and_face_bank_survive_non_utf8_default(self):
        original_read_text=Path.read_text
        def legacy_read_text(path,encoding=None,errors=None):
            return original_read_text(path,encoding=encoding or 'cp1252',errors=errors)
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)
            (source/'expressions').mkdir()
            config={'master':'牧师母版.png'}
            (source/'class-identity-motion.json').write_text(
                json.dumps({'classes':{'priest':config}},ensure_ascii=False),encoding='utf-8')
            face={'name':'害怕','notes':'脸内区域'}
            banks={'class-emotion-face-sources.json':{'100':face},
                   'class-face-sources.json':{'0':face}}
            for name,bank in banks.items():
                (source/'expressions'/name).write_text(
                    json.dumps({'classes':{'priest':bank}},ensure_ascii=False),encoding='utf-8')
            for action,bank in ((motion.EMOTIONS[0],banks['class-emotion-face-sources.json']),
                                (motion.KEEP[0],banks['class-face-sources.json'])):
                task={'class':'priest','name':action}
                with self.subTest(action=action),patch.object(Path,'read_text',legacy_read_text), \
                        patch.object(motion,'ClassIdentityMotion') as rig:
                    self.assertIs(motion.build(task,source),rig.return_value)
                    rig.assert_called_once_with(task,source,config,bank)


class EmotionIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rigs={(c,n):motion.build({'class':c,'name':n},SOURCE)
                  for c in motion.EMOTION_CLASSES for n in motion.EMOTIONS}

    def test_same_120_names_and_eight_second_contract(self):
        self.assertEqual(len(render.tasks()),960)
        for (cls,name),rig in self.rigs.items():
            task=next(t for t in render.tasks() if t['class']==cls and t['name']==name)
            self.assertTrue(render.fixed_identity_action(task))
            self.assertEqual(render.poses_for(task)[1],'class_identity')
            self.assertEqual(render.schedule('class_identity',name)[1],8)
            self.assertEqual(rig.duration,8)
            self.assertEqual(render.render_provenance(task)['motion_backend'],'fixed_identity')

    def test_face_sources_never_replace_equipment_or_alpha(self):
        for key,rig in self.rigs.items():
            target=rig.texture_rgba[100+motion.EMOTIONS.index(key[1])]
            with self.subTest(rig=key):
                np.testing.assert_array_equal(target[rig.face_mask==0],rig.source[rig.face_mask==0])
                np.testing.assert_array_equal(target[...,3],rig.source[...,3])
                np.testing.assert_array_equal(target[198:],rig.source[198:])
                self.assertGreater(np.count_nonzero(target!=rig.source),100)
                for t in (0,7.99,8):
                    np.testing.assert_array_equal(rig.frame(t),rig.source)

    def test_five_faces_and_choreographies_are_distinct(self):
        for cls in motion.EMOTION_CLASSES:
            faces=[];motions=[]
            for name in motion.EMOTIONS:
                rig=self.rigs[cls,name]
                faces.append(hashlib.sha256(rig.texture_rgba[100+motion.EMOTIONS.index(name)].tobytes()).hexdigest())
                motions.append(tuple(rig.forward(np.array([[322.,150.],[322.,225.],[282.,250.]]),t).tobytes()
                                     for t in (1.3,2.1,3.6)))
            self.assertEqual(len(set(faces)),5)
            self.assertEqual(len(set(motions)),5)

    def test_equipped_polygons_remain_rigid_during_head_dips_and_trembles(self):
        for key,rig in self.rigs.items():
            for polygon in rig.config['weapons']+[[[310,202],[335,202],[335,228],[310,228]]]:
                pts=np.asarray(polygon,np.float64)
                before=np.linalg.norm(pts[:,None]-pts[None,:],axis=2)
                for t in (.45,1.3,2.1,3.6,7.35):
                    moved=rig.forward(pts,t)
                    with self.subTest(rig=key,t=t):
                        np.testing.assert_allclose(np.linalg.norm(moved[:,None]-moved[None,:],axis=2),before,rtol=0,atol=1e-6)

    def test_continuous_motion_without_spatial_folds(self):
        dt=1e-5
        for key,rig in self.rigs.items():
            pts=np.asarray([[322.,150.],[322.,225.],[300.,310.]]+[a[2:] for a in rig.config['arms']],np.float64)
            for t in (.15,.4,.65,1.3,2.1,3.6,7.1,7.6,7.65):
                left=rig.forward(pts,t-dt);mid=rig.forward(pts,t);right=rig.forward(pts,t+dt)
                with self.subTest(rig=key,t=t):
                    self.assertLess(float(np.abs(right-left).max()),.02)
                    self.assertLess(float(np.abs(right-2*mid+left).max()/dt),.1)
            for t in (1.3,2.1,3.6):
                diagnostic=rig.diagnostic(t)
                self.assertGreater(diagnostic['jacobian_min_on_visible_source'],.2)
                self.assertLess(diagnostic['maximum_inverse_residual_on_visible_output'],.02)


if __name__=='__main__':unittest.main()
