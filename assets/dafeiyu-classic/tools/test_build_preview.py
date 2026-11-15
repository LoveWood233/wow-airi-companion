"""Reject stale report labels before publishing a candidate review page."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('build_preview',Path(__file__).with_name('build-preview.py'))
preview=importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class PreviewReportTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name)/'assets'
        self.output=Path(temporary.name)/'candidate'
        for directory in ('source','tools'):(self.root/directory).mkdir(parents=True)
        (self.output/'packs/priest').mkdir(parents=True)
        (self.output/'reports/priest').mkdir(parents=True)
        self.plan={'classes':[{'id':'priest'}],
                   'actions':[{'name':'开心蹦跳','file':'开心蹦跳.webm'}]}
        (self.root/'source/action-plan.json').write_text(json.dumps(self.plan,ensure_ascii=False),encoding='utf-8')
        (self.root/'tools/preview-template.html').write_text('__PACK_DATA__',encoding='utf-8')
        for name in ('IMPORT.txt','ATTRIBUTION.txt'):(self.root/name).write_text(name,encoding='utf-8')
        self.media=self.output/'packs/priest/开心蹦跳.webm'
        self.data=b'\x1a\x45\xdf\xa3'+b'fixture pixels'*(1024*100)
        self.media.write_bytes(self.data)
        self.report_path=self.output/'reports/priest/开心蹦跳.json'
        self.report={'class':'priest','name':'开心蹦跳','bytes':len(self.data),
                     'sha256':hashlib.sha256(self.data).hexdigest(),'fixed_source_equipment':True}
        self.write_report(self.report)
        self.index=self.output/'index.html'
        self.index.write_text('previous valid preview',encoding='utf-8')
        root_patch=patch.object(preview,'ROOT',self.root)
        root_patch.start();self.addCleanup(root_patch.stop)

    def write_report(self,data):
        self.report_path.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')

    def assert_rejected(self,message):
        with self.assertRaisesRegex(ValueError,message):preview.build(self.output)
        self.assertEqual(self.index.read_text(encoding='utf-8'),'previous valid preview')
        self.assertFalse((self.output/'index.html.tmp').exists())
        self.assertEqual(list(self.output.glob('.preview-*.html.tmp')),[])

    def test_matching_report_builds_correct_label_with_streamed_media(self):
        # The media exceeds one chunk. Hashing must not call read_bytes().
        with patch.object(Path,'read_bytes',side_effect=AssertionError('whole-file read')):
            result=preview.build(self.output)
        self.assertEqual(result['clips'],1)
        self.assertEqual(result['fixed_master_clips'],1)
        self.assertFalse(result['visual_acceptance'])
        self.assertEqual(json.loads(self.index.read_text(encoding='utf-8'))['media'],
                         [{'class':'priest','action':'开心蹦跳','fixed':True}])

    def test_missing_or_wrong_report_identity_is_rejected(self):
        for field in ('class','name'):
            for missing in (False,True):
                with self.subTest(field=field,missing=missing):
                    report=dict(self.report)
                    if missing:report.pop(field)
                    else:report[field]='another action or class'
                    self.write_report(report)
                    self.assert_rejected('identity mismatch')

    def test_missing_or_wrong_report_media_fingerprint_is_rejected(self):
        for field,value in (('bytes',len(self.data)+1),('sha256','0'*64)):
            for missing in (False,True):
                with self.subTest(field=field,missing=missing):
                    report=dict(self.report)
                    if missing:report.pop(field)
                    else:report[field]=value
                    self.write_report(report)
                    self.assert_rejected('media hash/size mismatch')

    def test_replaced_media_with_old_report_is_rejected(self):
        for data in (b'x'+self.data[1:],self.data[:-1]):
            with self.subTest(same_size=len(data)==len(self.data)):
                self.media.write_bytes(data)
                self.assert_rejected('media hash/size mismatch')

    def test_missing_media_or_report_cannot_publish_preview(self):
        self.media.unlink()
        self.assert_rejected('Missing media')
        self.media.write_bytes(self.data)
        self.report_path.unlink()
        with self.assertRaises(FileNotFoundError):preview.build(self.output)
        self.assertEqual(self.index.read_text(encoding='utf-8'),'previous valid preview')

    def test_chinese_sources_and_output_survive_non_utf8_default(self):
        original_read_text=Path.read_text
        def legacy_read_text(path,encoding=None,errors=None):
            return original_read_text(path,encoding=encoding or 'cp1252',errors=errors)
        with patch.object(Path,'read_text',legacy_read_text):
            preview.build(self.output)
        page=self.index.read_bytes().decode('utf-8')
        self.assertIn('开心蹦跳',page)
        self.assertEqual(json.loads(page)['actions'],self.plan['actions'])

    def test_overlapping_builds_use_independent_closed_staging_files(self):
        original_replace=preview.os.replace
        staged=[]
        def interleaved_replace(source,target):
            staged.append(Path(source))
            # The staged page is complete and can be opened before publication.
            self.assertEqual(json.loads(Path(source).read_text(encoding='utf-8'))['actions'],
                             self.plan['actions'])
            if len(staged)==1:
                preview.build(self.output)
                self.assertTrue(Path(source).is_file())
                self.assertNotEqual(staged[0],staged[1])
            return original_replace(source,target)
        with patch.object(preview.os,'replace',side_effect=interleaved_replace):
            preview.build(self.output)
        self.assertEqual(len(staged),2)
        self.assertEqual(json.loads(self.index.read_text(encoding='utf-8'))['actions'],self.plan['actions'])
        self.assertEqual(list(self.output.glob('.preview-*.html.tmp')),[])

    def test_failed_publish_preserves_existing_page_and_other_staging_files(self):
        other=self.output/'.preview-other-writer.html.tmp'
        other.write_text('another in-progress build',encoding='utf-8')
        with patch.object(preview.os,'replace',side_effect=OSError('publication failed')):
            with self.assertRaisesRegex(OSError,'publication failed'):
                preview.build(self.output)
        self.assertEqual(self.index.read_text(encoding='utf-8'),'previous valid preview')
        self.assertEqual(other.read_text(encoding='utf-8'),'another in-progress build')
        self.assertEqual(list(self.output.glob('.preview-*.html.tmp')),[other])


if __name__=='__main__':unittest.main()
