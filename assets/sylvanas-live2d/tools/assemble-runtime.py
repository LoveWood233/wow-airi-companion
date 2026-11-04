"""Package a real Cubism export without changing its MOC or texture bytes."""

import argparse
import copy
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import zipfile


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
IDLE_PATH = "motions/airi-idle-breath.motion3.json"
PARAMETER_GROUPS = {
    "EyeBlink": ["ParamEyeLOpen", "ParamEyeROpen"],
    "LipSync": ["ParamMouthOpenY"],
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def encode_json(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def references_in(value, key=""):
    if isinstance(value, str):
        return [value] if value and key != "Name" else []
    if isinstance(value, list):
        return [reference for item in value for reference in references_in(item, key)]
    if isinstance(value, dict):
        return [reference for name, item in value.items() for reference in references_in(item, name)]
    return []


def read_resource(directory, reference):
    portable_path = PurePosixPath(reference.replace("\\", "/"))
    if portable_path.is_absolute() or ":" in reference or ".." in portable_path.parts or "\0" in reference:
        raise ValueError(f"Expected a package-relative resource: {reference}")
    source = directory.joinpath(*portable_path.parts).resolve(strict=True)
    if not source.is_file() or not source.is_relative_to(directory):
        raise ValueError(f"Resource leaves the source export directory: {reference}")
    return portable_path.as_posix(), source, source.read_bytes()


def idle_motion():
    return {
        "Version": 3,
        "Meta": {
            "Duration": 4.0,
            "Fps": 30.0,
            "Loop": True,
            "AreBeziersRestricted": True,
            "CurveCount": 1,
            "TotalSegmentCount": 2,
            "TotalPointCount": 7,
            "UserDataCount": 0,
            "TotalUserDataSize": 0,
        },
        "FadeInTime": 0.5,
        "FadeOutTime": 0.5,
        "Curves": [{
            "Target": "Parameter",
            "Id": "ParamBreath",
            "Segments": [
                0.0, 0.0,
                1, 2.0 / 3, 0.0, 4.0 / 3, 1.0, 2.0, 1.0,
                1, 8.0 / 3, 1.0, 10.0 / 3, 0.0, 4.0, 0.0,
            ],
        }],
        "UserData": [],
    }


def assemble(model_path, output_directory, archive_path, report_path):
    model_path = model_path.resolve(strict=True)
    source_directory = model_path.parent
    original_model_bytes = model_path.read_bytes()
    settings = json.loads(original_model_bytes.decode("utf-8-sig"))
    if not isinstance(settings, dict) or settings.get("Version") != 3:
        raise ValueError("Expected an Editor-exported model settings file with Version 3")
    source_references = settings.get("FileReferences")
    if not isinstance(source_references, dict) or not isinstance(source_references.get("Moc"), str) or not source_references["Moc"]:
        raise ValueError("The source settings must declare FileReferences.Moc")
    textures = source_references.get("Textures")
    if not isinstance(textures, list) or not textures or not all(isinstance(path, str) and path for path in textures):
        raise ValueError("The source settings must declare at least one texture")

    files = {}
    source_files = []
    canonical_names = {}
    for reference in sorted(set(references_in(source_references))):
        name, source, data = read_resource(source_directory, reference)
        canonical = name.casefold()
        if canonical in canonical_names and canonical_names[canonical] != name:
            raise ValueError(f"Resource paths differ only in case: {name}")
        canonical_names[canonical] = name
        if reference == source_references["Moc"] and (len(data) < 5 or data[:4] != b"MOC3"):
            raise ValueError("The source MOC does not have a MOC3 signature")
        if reference in textures and (len(data) < 24 or not data.startswith(PNG_SIGNATURE) or data[12:16] != b"IHDR"):
            raise ValueError(f"Texture is not a PNG with an IHDR header: {reference}")
        files[name] = data
        source_files.append({"reference": reference, "path": str(source), "archivePath": name, "bytes": len(data), "sha256": sha256(data)})

    packaged_settings = copy.deepcopy(settings)
    groups = packaged_settings.get("Groups", [])
    if not isinstance(groups, list) or not all(isinstance(group, dict) for group in groups):
        raise ValueError("Groups must be an array of objects")
    packaged_settings["Groups"] = [group for group in groups if group.get("Name") not in PARAMETER_GROUPS]
    packaged_settings["Groups"].extend(
        {"Target": "Parameter", "Name": name, "Ids": ids}
        for name, ids in PARAMETER_GROUPS.items()
    )

    motions = packaged_settings["FileReferences"].setdefault("Motions", {})
    if not isinstance(motions, dict):
        raise ValueError("FileReferences.Motions must be an object")
    if motions.get("Idle"):
        raise ValueError("Source already defines Idle motions. Review them before adding the generated breath motion.")
    if IDLE_PATH.casefold() in canonical_names or model_path.name.casefold() in canonical_names:
        raise ValueError("A generated file path conflicts with a source resource")
    motions["Idle"] = [{"File": IDLE_PATH, "FadeInTime": 0.5, "FadeOutTime": 0.5}]
    files[IDLE_PATH] = encode_json(idle_motion())
    files[model_path.name] = encode_json(packaged_settings)

    destinations = [path.resolve() for path in [output_directory, archive_path, report_path]]
    output_directory, archive_path, report_path = destinations
    if len(set(destinations)) != 3:
        raise ValueError("Output directory, archive and report must have distinct paths")
    for destination in destinations:
        if destination.is_relative_to(source_directory):
            raise ValueError(f"An output path is inside the source export: {destination}")
        if destination.exists():
            raise ValueError(f"Output already exists: {destination}. Choose a new destination.")
    if archive_path.is_relative_to(output_directory) or report_path.is_relative_to(output_directory):
        raise ValueError("Place the archive and report outside the unpacked runtime directory")

    output_directory.mkdir(parents=True)
    for name, data in sorted(files.items()):
        destination = output_directory.joinpath(*PurePosixPath(name).parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data)

    with zipfile.ZipFile(archive_path) as archive:
        if archive.testzip() is not None:
            raise ValueError("ZIP integrity check failed")
        for source in source_files:
            name = source["archivePath"]
            output_data = output_directory.joinpath(*PurePosixPath(name).parts).read_bytes()
            if sha256(output_data) != source["sha256"] or sha256(archive.read(name)) != source["sha256"]:
                raise ValueError(f"Packaged resource bytes changed: {name}")
            if sha256(Path(source["path"]).read_bytes()) != source["sha256"]:
                raise ValueError(f"Source resource changed during assembly: {name}")
    if model_path.read_bytes() != original_model_bytes:
        raise ValueError("Source model settings changed during assembly")

    report = {
        "status": "PASS",
        "scope": "Package structure and byte preservation. No Core, renderer or animation playback verification.",
        "sourceModel": {"path": str(model_path), "sha256": sha256(original_model_bytes)},
        "runtimeDirectory": str(output_directory),
        "modelSettings": model_path.name,
        "archive": {"path": str(archive_path), "bytes": archive_path.stat().st_size, "sha256": sha256(archive_path.read_bytes())},
        "groups": packaged_settings["Groups"],
        "generatedIdleMotion": {"path": IDLE_PATH, "durationSeconds": 4, "range": [0, 1], "parameter": "ParamBreath"},
        "preservedSourceResources": source_files,
        "files": [{"path": name, "bytes": len(data), "sha256": sha256(data)} for name, data in sorted(files.items())],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(encode_json(report))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True, help="Real Editor-exported .model3.json")
    parser.add_argument("--output-dir", type=Path, required=True, help="New directory for runtime resources")
    parser.add_argument("--zip", type=Path, required=True, help="New import ZIP outside the runtime directory")
    parser.add_argument("--report", type=Path, required=True, help="New JSON byte-preservation report")
    args = parser.parse_args()
    try:
        report = assemble(args.model, args.output_dir, args.zip, args.report)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"Assembly failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"status": report["status"], "archive": report["archive"], "report": str(args.report.resolve())}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
