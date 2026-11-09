"""Audit cache regressions without encoding production media."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

TOOLS=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('audit_frames',TOOLS/'audit-frames.py')
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditCacheTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root=Path(self.directory.name)
        self.media=root/'mage'/'example.webm'
        self.media.parent.mkdir()
        self.media.write_bytes(b'fixed test media identity')
        self.report=root/'render.json'
        self.report_data={'sha256':audit.sha_file(self.media),'frames':2,
                          'timeline':[[0,0],[2/60,1]]}
        self.write_report()
        self.output=root/'audit'
        self.job=(self.media,self.report,self.output)
        frame=np.zeros((audit.H,audit.W,4),np.uint8)
        frame[100:200,250:350]=[160,110,50,255]
        other=frame.copy();other[100:200,250:350,0]=170
        self.raw=frame.tobytes()+other.tobytes()

    def write_report(self):
        self.report.write_text(json.dumps(self.report_data))

    def decode(self,on_wait=None):
        process=Mock(stdout=io.BytesIO(self.raw),stderr=io.BytesIO())
        process.wait.side_effect=on_wait or (lambda:0)
        probe={'streams':[{'codec_name':'vp9','width':audit.W,'height':audit.H,
                           'r_frame_rate':'60/1','tags':{'alpha_mode':'1'}}]}
        with patch.object(audit.subprocess,'check_output',return_value=json.dumps(probe).encode()) as inspect, \
                patch.object(audit.subprocess,'Popen',return_value=process) as decode:
            result=audit.audit_job(self.job)
        self.assertEqual(inspect.call_count,1)
        self.assertEqual(decode.call_count,1)
        return result

    def test_intact_cache_reuses_report_and_contact_page_hashes(self):
        result=self.decode()
        self.assertEqual(result['render_report_sha256'],audit.sha_file(self.report))
        for name in result['contact_pages']:
            self.assertEqual(result['contact_page_sha256'][name],audit.sha_file(self.output/name))
        with patch.object(audit.subprocess,'check_output',side_effect=AssertionError('unexpected probe')), \
                patch.object(audit.subprocess,'Popen',side_effect=AssertionError('unexpected decode')):
            self.assertEqual(audit.audit_job(self.job),result)

    def test_changed_timeline_invalidates_cache_for_same_media(self):
        original=self.decode()
        self.report_data['timeline']=[[0,0],[2/60,0]]
        self.write_report()
        updated=self.decode()
        self.assertNotEqual(original['render_report_sha256'],updated['render_report_sha256'])
        self.assertFalse(original['expected_loop_same_pose'])
        self.assertTrue(updated['expected_loop_same_pose'])

    def test_missing_or_mismatched_render_report_cannot_use_cache(self):
        self.decode()
        self.report.unlink()
        with self.assertRaises(FileNotFoundError):audit.audit_job(self.job)
        self.report_data['sha256']='0'*64
        self.write_report()
        with self.assertRaisesRegex(ValueError,'media SHA256 does not match'):
            audit.audit_job(self.job)

    def test_missing_or_modified_contact_page_is_regenerated(self):
        result=self.decode()
        page=self.output/result['contact_pages'][0]
        page.unlink()
        regenerated=self.decode()
        self.assertTrue(page.is_file())
        self.assertEqual(regenerated['contact_page_sha256'],result['contact_page_sha256'])
        page.write_bytes(b'overwritten contact page')
        repaired=self.decode()
        self.assertEqual(repaired['contact_page_sha256'],result['contact_page_sha256'])

    def test_input_change_during_decode_does_not_publish_audit(self):
        for changed in ('media','render_report'):
            with self.subTest(changed=changed):
                def change_input():
                    if changed=='media':self.media.write_bytes(b'different media')
                    else:
                        self.report_data['timeline']=[[0,0],[2/60,0]]
                        self.write_report()
                    return 0
                with self.assertRaisesRegex(RuntimeError,'Audit inputs changed'):
                    self.decode(on_wait=change_input)
                self.assertFalse((self.output/'example.json').exists())
                self.media.write_bytes(b'fixed test media identity')
                self.write_report()

    def test_failed_contact_write_cannot_publish_audit(self):
        with patch.object(audit.cv2,'imwrite',return_value=False):
            with self.assertRaisesRegex(OSError,'Unable to write contact page'):
                self.decode()
        self.assertFalse((self.output/'example.json').exists())


if __name__=='__main__':unittest.main()
