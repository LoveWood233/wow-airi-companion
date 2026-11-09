"""Regression checks for column leakage and historical source crop isolation."""
from pathlib import Path
import hashlib,importlib.util,json,tempfile,unittest
from unittest.mock import patch
import numpy as np
spec=importlib.util.spec_from_file_location('crop_render',Path(__file__).with_name('render.py'))
render=importlib.util.module_from_spec(spec);spec.loader.exec_module(render)

class ExtractionCrops(unittest.TestCase):
    def test_padding_preserves_every_retained_pixel_and_geometry(self):
        cell=np.random.default_rng(2).integers(0,256,(320,320,4),dtype=np.uint8)
        result=render.trim_cell_boundary(cell,{'bottom_trim_px':18,'right_trim_px':8})
        np.testing.assert_array_equal(result[:302,:312],cell[:302,:312])
        self.assertEqual(result.shape,cell.shape)
        self.assertFalse(result[302:].any());self.assertFalse(result[:,312:].any())
    def test_historical_bottom_only_and_zero_are_unchanged(self):
        cell=np.full((320,320,4),200,np.uint8)
        result=render.trim_cell_boundary(cell,7)
        np.testing.assert_array_equal(result[:-7],cell[:-7]);self.assertFalse(result[-7:].any())
        np.testing.assert_array_equal(render.trim_cell_boundary(cell,0),cell)
    def test_large_or_negative_trim_is_rejected(self):
        for value in (-1,40,{'right_trim_px':-1},{'right_trim_px':40}):
            with self.subTest(value=value),self.assertRaises(ValueError):
                render.trim_cell_boundary(np.zeros((320,320,4),np.uint8),value)
    def crop_fixture(self,rows):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);root=Path(temp.name)
        sheet=root/'sheets/druid/actions-04.png';sheet.parent.mkdir(parents=True);sheet.write_bytes(b'current revision')
        digest=hashlib.sha256(sheet.read_bytes()).hexdigest()
        entries=[dict({'class':'druid','sheet':'actions-04','source_sha256':digest},**row) for row in rows]
        (root/'extraction-crops.json').write_text(json.dumps({'entries':entries}))
        return root
    def test_exact_sha_only_and_two_edges_merge_without_losing_bottom(self):
        root=self.crop_fixture([{'cell':4,'bottom_trim_px':18},{'cell':4,'right_trim_px':8},
                                {'cell':5,'bottom_trim_px':9},{'cell':6,'bottom_trim_px':30,'source_sha256':'old'}])
        with patch.object(render,'SOURCE',root):self.assertEqual(render.crop_map('druid','actions-04'),{4:{'bottom_trim_px':18,'right_trim_px':8},5:9})
    def test_conflicting_same_source_crops_are_rejected(self):
        root=self.crop_fixture([{'cell':4,'bottom_trim_px':18},{'cell':4,'bottom_trim_px':20}])
        with patch.object(render,'SOURCE',root),self.assertRaisesRegex(ValueError,'Conflicting'):
            render.crop_map('druid','actions-04')

if __name__=='__main__':unittest.main()
