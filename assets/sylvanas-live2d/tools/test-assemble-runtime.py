"""Check packaging against the real v1 Editor export and motion playback contracts."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile


TOOLS = Path(__file__).resolve().parent
ASSETS = TOOLS.parent
SPEC = importlib.util.spec_from_file_location("assemble_runtime", TOOLS / "assemble-runtime.py")
ASSEMBLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ASSEMBLER)
SOURCE = ASSETS / "output/editor-export/sylvanas-chibi-v1.model3.json"


def sample(curve, time):
    segments = curve["Segments"]
    start_time, start_value = segments[:2]
    for offset in range(2, len(segments), 7):
        kind, control1_time, control1_value, control2_time, control2_value, end_time, end_value = segments[offset:offset + 7]
        if kind != 1:
            raise AssertionError("Expected a cubic segment")
        if abs(control1_time - (start_time + (end_time - start_time) / 3)) > 1e-10:
            raise AssertionError("First cubic control does not use restricted time")
        if abs(control2_time - (start_time + (end_time - start_time) * 2 / 3)) > 1e-10:
            raise AssertionError("Second cubic control does not use restricted time")
        if time <= end_time:
            fraction = max(0, min(1, (time - start_time) / (end_time - start_time)))
            return ((1 - fraction) ** 3 * start_value
                    + 3 * (1 - fraction) ** 2 * fraction * control1_value
                    + 3 * (1 - fraction) * fraction ** 2 * control2_value
                    + fraction ** 3 * end_value)
        start_time, start_value = end_time, end_value
    return start_value


class AssemblyChecks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="wow-airi-live2d-motion-check-")
        self.directory = Path(self.temporary.name).resolve()
        self.assertTrue(self.directory.is_relative_to(Path(tempfile.gettempdir()).resolve()))

    def tearDown(self):
        self.temporary.cleanup()

    def package(self, profile):
        folder = self.directory / profile
        return ASSEMBLER.assemble(SOURCE, folder / "runtime", folder / "model.zip", folder / "report.json", profile)

    def test_default_profile_preserves_the_published_v1_zip(self):
        report = self.package("basic-v1")
        archive = Path(report["archive"]["path"])
        self.assertEqual(archive.read_bytes(), (ASSETS / "output/sylvanas-chibi-v1.live2d.zip").read_bytes())

    def test_companion_profile_preserves_resources_and_yields_control_to_mouse_gaze(self):
        report = self.package("companion-v2")
        self.assertEqual(report["status"], "PASS")
        with zipfile.ZipFile(report["archive"]["path"]) as archive:
            self.assertIsNone(archive.testzip())
            for resource in report["preservedSourceResources"]:
                self.assertEqual(archive.read(resource["archivePath"]), Path(resource["path"]).read_bytes())
            settings = json.loads(archive.read(SOURCE.name))
            self.assertEqual(set(settings["FileReferences"]["Motions"]), {"Idle", "Yawn"})
            for generated in report["generatedMotions"]:
                motion = json.loads(archive.read(generated["path"]))
                curves = motion["Curves"]
                meta = motion["Meta"]
                self.assertEqual(meta["CurveCount"], len(curves))
                self.assertEqual(meta["TotalSegmentCount"], sum((len(curve["Segments"]) - 2) // 7 for curve in curves))
                self.assertEqual(meta["TotalPointCount"], len(curves) + 3 * meta["TotalSegmentCount"])
                ids = {curve["Id"] for curve in curves}
                self.assertEqual(ids, {"ParamBreath", "ParamEyeLOpen", "ParamEyeROpen", "ParamMouthOpenY"})
                self.assertNotIn("ParamEyeBallX", ids)
                self.assertNotIn("ParamEyeBallY", ids)
                for curve in curves:
                    self.assertEqual(curve["Segments"][0], 0)
                    self.assertEqual(curve["Segments"][-2], meta["Duration"])
                    expected_rest = 1 if curve["Id"] in ("ParamEyeLOpen", "ParamEyeROpen") else 0
                    self.assertEqual(sample(curve, 0), expected_rest)
                    self.assertEqual(sample(curve, meta["Duration"]), expected_rest)
                    values = [sample(curve, tick * meta["Duration"] / 1000) for tick in range(1001)]
                    self.assertGreaterEqual(min(values), -1e-12)
                    self.assertLessEqual(max(values), 1 + 1e-12)

    def test_yawn_closes_the_eyes_opens_the_mouth_and_returns_to_rest(self):
        report = self.package("companion-v2")
        with zipfile.ZipFile(report["archive"]["path"]) as archive:
            standalone = json.loads(archive.read(ASSEMBLER.YAWN_PATH))
            idle = json.loads(archive.read(ASSEMBLER.COMPANION_IDLE_PATH))
        self.assertFalse(standalone["Meta"]["Loop"])
        self.assertTrue(idle["Meta"]["Loop"])
        for motion, start in [(standalone, 0), (idle, 35)]:
            curves = {curve["Id"]: curve for curve in motion["Curves"]}
            self.assertEqual(sample(curves["ParamMouthOpenY"], start + 2), 1)
            self.assertLess(sample(curves["ParamEyeLOpen"], start + 2), 0.1)
            self.assertLess(sample(curves["ParamEyeROpen"], start + 2), 0.1)
            self.assertEqual(sample(curves["ParamMouthOpenY"], start + 5.2), 0)
            self.assertEqual(sample(curves["ParamEyeLOpen"], start + 5.2), 1)
            self.assertEqual(sample(curves["ParamEyeROpen"], start + 5.2), 1)
        idle_curves = {curve["Id"]: curve for curve in idle["Curves"]}
        for time in range(0, 49, 4):
            self.assertEqual(sample(idle_curves["ParamBreath"], time), 0)
        for time in range(2, 48, 4):
            self.assertEqual(sample(idle_curves["ParamBreath"], time), 1)
        self.assertEqual(sample(idle_curves["ParamMouthOpenY"], 30), 0)
        self.assertEqual(sample(idle_curves["ParamEyeLOpen"], 30), 1)

    def test_existing_output_is_not_replaced(self):
        report = self.package("companion-v2")
        archive = Path(report["archive"]["path"])
        before = archive.read_bytes()
        with self.assertRaisesRegex(ValueError, "Output already exists"):
            self.package("companion-v2")
        self.assertEqual(archive.read_bytes(), before)

    def test_idle_blinks_without_an_application_blink_timer_and_resumes_after_yawning(self):
        report = self.package("companion-v2")
        with zipfile.ZipFile(report["archive"]["path"]) as archive:
            idle = json.loads(archive.read(ASSEMBLER.COMPANION_IDLE_PATH))
            standalone = json.loads(archive.read(ASSEMBLER.YAWN_PATH))
        eyes = [curve for curve in idle["Curves"] if curve["Id"] in ("ParamEyeLOpen", "ParamEyeROpen")]
        self.assertEqual(eyes[0]["Segments"], eyes[1]["Segments"])
        for blink_start in [4.6, 11.0, 17.8, 24.1, 30.7, 44.7]:
            for eye in eyes:
                self.assertEqual(sample(eye, blink_start), 1)
                self.assertAlmostEqual(sample(eye, blink_start + 0.075), 0)
                self.assertAlmostEqual(sample(eye, blink_start + 0.1), 0)
                self.assertAlmostEqual(sample(eye, blink_start + 0.125), 0)
                self.assertAlmostEqual(sample(eye, blink_start + 0.305), 1)
        for eye in eyes:
            self.assertAlmostEqual(sample(eye, 37.8), 0)
            self.assertAlmostEqual(sample(eye, 40.2), 1)
            self.assertAlmostEqual(sample(eye, 44.8), 0)
            self.assertAlmostEqual(sample(eye, 46), 1)
            self.assertAlmostEqual(sample(eye, 48), 1)
        for eye in [curve for curve in standalone["Curves"] if curve["Id"] in ("ParamEyeLOpen", "ParamEyeROpen")]:
            self.assertEqual(len(eye["Segments"]), 2 + 6 * 7)

    def test_yawn_reaches_rest_before_the_runtime_fade_out_window(self):
        report = self.package("companion-v2")
        with zipfile.ZipFile(report["archive"]["path"]) as archive:
            standalone = json.loads(archive.read(ASSEMBLER.YAWN_PATH))
            idle = json.loads(archive.read(ASSEMBLER.COMPANION_IDLE_PATH))
        self.assertLess(4.8, standalone["Meta"]["Duration"] - standalone["FadeOutTime"])
        for curve in standalone["Curves"]:
            expected_rest = 1 if curve["Id"] in ("ParamEyeLOpen", "ParamEyeROpen") else 0
            for time in [4.8, 4.9, 5.0, 5.1, 5.2]:
                self.assertAlmostEqual(sample(curve, time), expected_rest, places=12)
        for curve in idle["Curves"]:
            if curve["Id"] == "ParamBreath":
                continue
            expected_rest = 0 if curve["Id"] == "ParamMouthOpenY" else 1
            for time in [39.8, 39.9, 40.0, 40.1, 40.2]:
                self.assertAlmostEqual(sample(curve, time), expected_rest, places=12)


if __name__ == "__main__":
    unittest.main()
