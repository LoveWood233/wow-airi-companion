"""Regressions for two visually confirmed RIFE anatomy failures."""
import importlib.util
from pathlib import Path
import unittest

TOOLS=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('regression_render_target',TOOLS/'render.py')
render=importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)


class MotionRegressionRoutes(unittest.TestCase):
    def task(self,cls,name):
        return next(t for t in render.tasks() if t['class']==cls and t['name']==name)

    def test_original_names_and_120_action_contract_are_preserved(self):
        self.assertEqual(len(render.tasks()),960)
        for cls in render.CLASSES:
            for name in ('点击回应-开心跃动','原地小憩沉眠'):
                self.assertEqual(self.task(cls,name)['name'],name)

    def test_click_joy_uses_fixed_identity_and_ten_seconds_for_all_classes(self):
        for cls in render.CLASSES:
            task=self.task(cls,'点击回应-开心跃动')
            poses,kind=render.poses_for(task)
            with self.subTest(class_id=cls):
                self.assertEqual(kind,'class_identity')
                self.assertEqual(len(poses),1)
                self.assertEqual(render.schedule(kind,task['name'])[1],10)
                self.assertTrue(all('base-keyframes' in str(p) for p in render.source_list(task)))
                self.assertFalse(any(p.stem=='actions-11' for p in render.input_images(task)))

    def test_nap_uses_complete_locomotion_sleep_bridge(self):
        for cls in render.CLASSES:
            task=self.task(cls,'原地小憩沉眠')
            poses,kind=render.poses_for(task)
            timeline,duration=render.schedule(kind,task['name'])
            with self.subTest(class_id=cls):
                self.assertEqual([p.stem for p in render.source_list(task)],['locomotion-sleep'])
                self.assertEqual(kind,'dense_nap')
                self.assertEqual(duration,10)
                self.assertEqual(len(poses),9)
                self.assertEqual(timeline[0],(0,0))
                self.assertEqual(timeline[-1],(10,0))
                self.assertEqual([i for _,i in timeline[:7]],[0,0,1,2,3,4,5])
                self.assertEqual([i for _,i in timeline[-5:]],[7,8,1,0,0])
                self.assertTrue(all(a[0]<b[0] for a,b in zip(timeline,timeline[1:])))
                self.assertFalse(any(a[1] in (4,5,6) and b[1]==0 for a,b in zip(timeline,timeline[1:])))

    def test_warrior_approved_eight_second_jump_is_untouched(self):
        task=self.task('warrior','开心蹦跳')
        self.assertTrue(render.warrior_identity_jump(task))
        self.assertEqual(render.poses_for(task)[1],'identity_happy_jump')
        self.assertEqual(render.schedule('identity_happy_jump',task['name'])[1],8)


if __name__=='__main__':unittest.main()
