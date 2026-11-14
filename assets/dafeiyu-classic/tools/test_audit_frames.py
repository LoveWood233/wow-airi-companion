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
        self.media=root/'packs'/'mage'/'example.webm'
        self.media.parent.mkdir(parents=True)
        self.media.write_bytes(b'fixed test media identity')
        self.report=root/'reports'/'mage'/'example.json'
        self.report.parent.mkdir(parents=True)
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
        self.report.write_text(json.dumps(self.report_data),encoding='utf-8')

    def decode(self,on_wait=None):
        process=Mock(stdout=io.BytesIO(self.raw),stderr=io.BytesIO())
        process.wait.side_effect=lambda **kwargs:on_wait() if on_wait else 0
        process.poll.return_value=0
        probe={'streams':[{'codec_name':'vp9','width':audit.W,'height':audit.H,
                           'r_frame_rate':'60/1','tags':{'alpha_mode':'1'}}]}
        with patch.object(audit.subprocess,'check_output',return_value=json.dumps(probe).encode()) as inspect, \
                patch.object(audit.subprocess,'Popen',return_value=process) as decode:
            result=audit.audit_job(self.job)
        self.assertEqual(inspect.call_count,1)
        self.assertEqual(inspect.call_args.kwargs['timeout'],audit.PROBE_TIMEOUT)
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


class AuditPreflightTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name)
        self.media=self.root/'build'
        self.output=self.media/'audit'
        plan=json.loads((audit.ROOT/'source/action-plan.json').read_text(encoding='utf-8'))
        self.names=[a['file'] for a in plan['actions']]
        for class_id in audit.CLASSES:
            directory=self.media/'packs'/class_id
            reports=self.media/'reports'/class_id
            directory.mkdir(parents=True);reports.mkdir(parents=True)
            for name in self.names:
                (directory/name).write_bytes(b'fixture, never decoded')
                (reports/(Path(name).stem+'.json')).write_text('{}',encoding='utf-8')

    def test_complete_scope_and_explicit_class_scope(self):
        jobs,classes=audit.prepare_jobs(self.media,self.output)
        self.assertEqual(len(jobs),960)
        self.assertEqual(classes,audit.CLASSES)
        subset,classes=audit.prepare_jobs(self.media,self.output,['mage','mage'])
        self.assertEqual(len(subset),120)
        self.assertEqual(classes,('mage',))
        self.assertFalse(self.output.exists())

    def test_missing_root_empty_scope_and_unknown_class_are_rejected(self):
        for root,classes in ((self.root/'absent',None),(self.media,[]),(self.media,['maeg'])):
            with self.subTest(root=root,classes=classes),self.assertRaises(ValueError):
                audit.prepare_jobs(root,self.output,classes)
        self.assertFalse(self.output.exists())

    def test_missing_or_extra_action_fails_before_any_output(self):
        path=self.media/'packs'/'druid'/self.names[-1]
        path.unlink()
        with self.assertRaisesRegex(ValueError,'Incomplete media'):
            audit.prepare_jobs(self.media,self.output)
        path.write_bytes(b'fixture')
        (path.parent/'unexpected.webm').write_bytes(b'fixture')
        with self.assertRaisesRegex(ValueError,'Incomplete media'):
            audit.prepare_jobs(self.media,self.output)
        self.assertFalse(self.output.exists())

    def test_missing_report_fails_before_any_output(self):
        (self.media/'reports'/'druid'/(Path(self.names[-1]).stem+'.json')).unlink()
        with self.assertRaisesRegex(ValueError,'Missing render report'):
            audit.prepare_jobs(self.media,self.output)
        self.assertFalse(self.output.exists())

    def test_incomplete_render_marker_rejects_even_a_full_file_set(self):
        (self.media/'packs'/'mage'/audit.INCOMPLETE).write_text('{}',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'Incomplete render'):
            audit.prepare_jobs(self.media,self.output)
        self.assertFalse(self.output.exists())

    def test_invalid_preflight_never_creates_a_lock_or_starts_workers(self):
        with patch.object(audit,'build_lock') as lock, \
                patch.object(audit.concurrent.futures,'ProcessPoolExecutor') as pool:
            with self.assertRaises(SystemExit):
                audit.main(['--media-root',str(self.root/'missing'),'--output',str(self.output)])
        lock.assert_not_called();pool.assert_not_called()

    def test_output_cannot_replace_reports_or_overlap_input_trees(self):
        paths=[self.media,self.media/'reports',self.media/'reports'/'new-audit',
               self.media/'packs',audit.ROOT/'source'/'audit',audit.ROOT/'tools'/'audit']
        original=(self.media/'reports'/'mage'/(Path(self.names[0]).stem+'.json')).read_bytes()
        for destination in paths:
            with self.subTest(destination=destination),self.assertRaisesRegex(ValueError,'overlaps'):
                audit.prepare_jobs(self.media,destination)
        self.assertEqual((self.media/'reports'/'mage'/(Path(self.names[0]).stem+'.json')).read_bytes(),original)

    def test_direct_job_cannot_overwrite_its_render_report(self):
        media=self.media/'packs'/'mage'/self.names[0]
        report=self.media/'reports'/'mage'/(media.stem+'.json')
        with self.assertRaisesRegex(ValueError,'overlaps'):
            audit.audit_job((media,report,report.parent))
        self.assertEqual(report.read_bytes(),b'{}')

    def test_symlinked_class_output_cannot_write_into_another_class_input(self):
        self.output.mkdir()
        try:(self.output/'mage').symlink_to(self.media/'reports'/'hunter',target_is_directory=True)
        except (OSError,NotImplementedError) as error:self.skipTest(str(error))
        with self.assertRaisesRegex(ValueError,'overlaps'):
            audit.prepare_jobs(self.media,self.output,['mage'])


class DecoderLifecycleTests(unittest.TestCase):
    def test_stderr_is_a_file_and_probe_and_waits_are_bounded(self):
        process=Mock(stdout=io.BytesIO(b''))
        process.poll.return_value=0;process.wait.return_value=0
        with patch.object(audit.subprocess,'Popen',return_value=process) as launch:
            with audit.decoded_stream(Path('fixture.webm'),10) as stream:
                self.assertEqual(stream.read(),b'')
        self.assertNotEqual(launch.call_args.kwargs['stderr'],audit.subprocess.PIPE)
        self.assertEqual(process.wait.call_args.kwargs,{'timeout':5})
        self.assertTrue(process.stdout.closed)

    def test_watchdog_kills_blocked_decoder_and_reports_timeout(self):
        process=Mock(stdout=io.BytesIO(b''))
        process.poll.return_value=None;process.wait.return_value=-9
        # Trigger the watchdog synchronously instead of sleeping or launching FFmpeg.
        def timer_factory(seconds,callback):
            timer=Mock()
            timer.start.side_effect=callback
            return timer
        with patch.object(audit.subprocess,'Popen',return_value=process), \
                patch.object(audit.threading,'Timer',side_effect=timer_factory):
            with self.assertRaisesRegex(TimeoutError,'decode exceeded'):
                with audit.decoded_stream(Path('fixture.webm'),.01) as stream:
                    stream.read()
        self.assertTrue(process.kill.called)
        self.assertTrue(process.stdout.closed)

    def test_processing_failure_kills_and_reaps_child(self):
        process=Mock(stdout=io.BytesIO(b''))
        process.poll.return_value=None;process.wait.return_value=-9
        with patch.object(audit.subprocess,'Popen',return_value=process):
            with self.assertRaisesRegex(ValueError,'processing failed'):
                with audit.decoded_stream(Path('fixture.webm'),10):
                    raise ValueError('processing failed')
        process.kill.assert_called_once()
        process.wait.assert_called_once_with(timeout=5)
        self.assertTrue(process.stdout.closed)


if __name__=='__main__':unittest.main()
