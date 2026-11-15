import importlib.util,unittest
from pathlib import Path
import numpy as np
import torch
import torch.nn.functional as F

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('neural_motion',HERE/'neural-motion.py')
motion=importlib.util.module_from_spec(spec);spec.loader.exec_module(motion)

class WarpTests(unittest.TestCase):
    def test_clamped_grid_matches_border_padding(self):
        _,warp=motion.load_vendor()
        rng=torch.Generator().manual_seed(17)
        source=torch.rand((1,4,13,19),generator=rng)
        flow=torch.randn((1,2,13,19),generator=rng)*15
        xs=torch.linspace(-1,1,19).view(1,1,1,19).expand(1,1,13,19)
        ys=torch.linspace(-1,1,13).view(1,1,13,1).expand(1,1,13,19)
        grid=(torch.cat((xs,ys),1)+flow/torch.tensor([9,6]).view(1,2,1,1)).permute(0,2,3,1)
        expected=F.grid_sample(source,grid,mode='bilinear',padding_mode='border',align_corners=True)
        self.assertLess((warp(source,flow)-expected).abs().max().item(),2e-6)

@unittest.skipUnless(motion.model_path().is_file(),'Pinned authoring weights not installed')
class ModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.a=np.zeros((64,64,4),np.uint8);cls.a[16:40,12:32]=[200,120,80,255]
        cls.b=np.zeros_like(cls.a);cls.b[16:40,20:40]=[200,120,80,255]
        cls.tween=motion.Tween([cls.a,cls.b])

    def test_exact_and_continuous_endpoints(self):
        for t,expected in [(0,self.a),(1,self.b)]:
            np.testing.assert_array_equal(self.tween.frame(0,1,t),expected)
        for t,expected in [(1e-5,self.a),(1-1e-5,self.b)]:
            result=self.tween.frame(0,1,t).astype(float)
            visible=result[:,:,:3]*result[:,:,3:4]/255
            target=expected[:,:,:3].astype(float)*expected[:,:,3:4]/255
            self.assertLessEqual(np.max(np.abs(visible-target)),1)

    def test_transparency_and_no_matte_color_leak(self):
        frame=self.tween.frame(0,1,.5)
        self.assertEqual(frame.dtype,np.uint8)
        self.assertEqual(frame[:,:,3].min(),0)
        self.assertGreater(frame[:,:,3].max(),250)
        opaque=frame[:,:,3]>240
        self.assertGreater(opaque.sum(),100)
        self.assertLessEqual(np.max(np.abs(frame[:,:,:3][opaque].astype(int)-[200,120,80])),1)

    def test_nonfinite_phase_is_rejected(self):
        with self.assertRaises(ValueError):self.tween.frame(0,1,float('nan'))

if __name__=='__main__':unittest.main()
