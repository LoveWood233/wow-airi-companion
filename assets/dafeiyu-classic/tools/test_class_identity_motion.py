"""Physical/identity invariants for the small-motion class rigs; not visual QA."""
import importlib.util
from pathlib import Path
import unittest

import numpy as np

TOOLS=Path(__file__).resolve().parent
SOURCE=TOOLS.parent/'source'
spec=importlib.util.spec_from_file_location('class_identity_test_target',TOOLS/'class-identity-motion.py')
motion=importlib.util.module_from_spec(spec)
spec.loader.exec_module(motion)


class ClassIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rigs={(c,n):motion.build({'class':c,'name':n},SOURCE)
                  for c in motion.CLASSES for n in motion.KEEP+(motion.JUMP,motion.CLICK_JOY)
                  if motion.supports({'class':c,'name':n})}

    def test_scope_is_exactly_39_actions_and_old_warrior_jump_is_excluded(self):
        self.assertEqual(len(self.rigs),39)
        for action in ('写作','开心小跑','小幅度原地360度旋转展示'):
            self.assertFalse(motion.supports({'class':'hunter','name':action}))
        self.assertFalse(motion.supports({'class':'warrior','name':motion.JUMP}))

    def test_every_expression_changes_only_face_and_never_alpha(self):
        for (c,n),rig in self.rigs.items():
            for index,texture in rig.texture_rgba.items():
                with self.subTest(class_id=c,action=n,expression=index):
                    np.testing.assert_array_equal(texture[rig.face_mask==0],rig.source[rig.face_mask==0])
                    np.testing.assert_array_equal(texture[...,3],rig.source[...,3])
                    np.testing.assert_array_equal(texture[198:],rig.source[198:])

    def test_loop_and_finite_action_endpoints_are_exact_master(self):
        for key,rig in self.rigs.items():
            for t in (0,rig.duration-1/60,rig.duration):
                with self.subTest(rig=key,time=t):
                    frame=rig.frame(t)
                    np.testing.assert_array_equal(frame,rig.source)
                    self.assertFalse(np.shares_memory(frame,rig.source))

    def test_equipment_shapes_remain_rigid(self):
        for key,rig in self.rigs.items():
            regions=rig.config['weapons']
            # Central cuirass is rigid. Robe/skirt margins near a held weapon
            # can deform slightly as the continuous texture follows the grip.
            x0,y0,x1,y1=310,202,335,228
            regions=regions+[[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]]
            for region in regions:
                points=np.asarray(region,np.float64)
                expected=np.linalg.norm(points[:,None]-points[None,:],axis=2)
                for t in (.9,1.8,2.6):
                    moved=rig.forward(points,t)
                    with self.subTest(rig=key,time=t):
                        np.testing.assert_allclose(np.linalg.norm(moved[:,None]-moved[None,:],axis=2),expected,atol=1e-6,rtol=0)

    def test_jump_moves_forearms_relative_to_chest_and_leaves_ground(self):
        for (c,n),rig in self.rigs.items():
            if n!=motion.JUMP:continue
            points=np.asarray([[322.,230.]]+[a[2:] for a in rig.config['arms']],np.float64)
            moved=rig.forward(points,1.8)
            with self.subTest(class_id=c):
                self.assertGreater(points[0,1]-moved[0,1],10)
                relative=(moved[1:]-moved[0])-(points[1:]-points[0])
                self.assertGreater(float(np.linalg.norm(relative,axis=1).max()),.5)

    def test_continuous_position_and_velocity_at_motion_joins(self):
        times=(.05,.35,.55,.65,.75,.85,1.05,1.25,1.6,1.65,2.35,2.85,3.05,3.35,3.65,3.95,5.65,6.05,6.25,6.9,7.6,7.95,8.1,8.55,8.7,9.)
        dt=1e-5
        for key,rig in self.rigs.items():
            pts=np.asarray([[322.,230.],[300.,310.],[343.,310.]]+[a[2:] for a in rig.config['arms']],np.float64)
            for t in times:
                left=rig.forward(pts,t-dt);center=rig.forward(pts,t);right=rig.forward(pts,t+dt)
                with self.subTest(rig=key,time=t):
                    self.assertLess(float(np.abs(right-left).max()),.01)
                    self.assertLess(float(np.abs(right-2*center+left).max()/dt),.1)

    def test_sampled_deformation_has_no_folds_or_inverse_jumps(self):
        for c in motion.CLASSES:
            name=motion.KEEP[2] if c=='warrior' else motion.JUMP
            for action,times in ((name,(.9,1.8,2.6)),(motion.CLICK_JOY,(.9,2.5,4.8,7.1))):
                rig=self.rigs[c,action]
                for t in times:
                    d=rig.diagnostic(t)
                    with self.subTest(class_id=c,action=action,time=t):
                        self.assertGreater(d['jacobian_min_on_visible_source'],.2)
                        self.assertLess(d['maximum_inverse_residual_on_visible_output'],.02)

    def test_sampled_apex_does_not_clip_sprite(self):
        for c in motion.CLASSES:
            name=motion.KEEP[2] if c=='warrior' else motion.JUMP
            for action,times in ((name,(1.8,)),(motion.CLICK_JOY,(2.5,4.8,7.1))):
                rig=self.rigs[c,action]
                for t in times:
                    a=rig.frame(t)[...,3]
                    with self.subTest(class_id=c,action=action,time=t):
                        self.assertFalse(np.any(a[0]) or np.any(a[-1]) or np.any(a[:,0]) or np.any(a[:,-1]))

    def test_nonfinite_time_is_rejected(self):
        rig=self.rigs['hunter',motion.JUMP]
        for t in (float('nan'),float('inf'),-float('inf')):
            with self.assertRaises(ValueError):rig.frame(t)

    def test_click_joy_has_three_distinct_beats_and_its_original_duration(self):
        for c in motion.CLASSES:
            rig=self.rigs[c,motion.CLICK_JOY]
            with self.subTest(class_id=c):
                self.assertEqual(rig.duration,10)
                for t in (2.5,4.8,7.1):
                    self.assertGreater(rig.channels(t)['lift'],10)
                for t in (0,1.3,3.65,5.95,8.5,10):
                    self.assertEqual(rig.channels(t)['lift'],0)
                self.assertEqual(rig.diagnostics['action_choreography'],'three_click_response_hops_10_seconds')


if __name__=='__main__':
    unittest.main()
