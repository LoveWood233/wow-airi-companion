"""Package unmodified RGBA source images into named PSD layers.

This file only builds the PSD container. It does not crop, resize, repaint,
retouch, or export image previews. Every layer must pass an exact RGBA roundtrip.

Library API: https://psd-tools.readthedocs.io/en/stable/usage.html
Layer API: https://psd-tools.readthedocs.io/en/stable/reference/psd_tools.api.layers.html
"""

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys
import tempfile


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def load_manifest(path):
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("version") != 1:
        raise ValueError("The manifest must use version 1.")
    entries = document.get("layers_bottom_to_top")
    if not isinstance(entries, list) or not entries:
        raise ValueError("The manifest must contain a non-empty layer list.")
    names = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Each layer entry must be an object.")
        name = entry.get("name")
        if not isinstance(name, str) or not name or name in names:
            raise ValueError("Every layer needs a unique, non-empty name.")
        if not isinstance(entry.get("source"), str):
            raise ValueError(f"Layer {name!r} needs a source path.")
        if not isinstance(entry.get("visible"), bool):
            raise ValueError(f"Layer {name!r} needs a boolean visibility value.")
        names.add(name)
    return entries


def read_sources(entries, manifest_dir, image_api):
    sources = []
    for entry in entries:
        path = (manifest_dir / entry["source"]).resolve(strict=True)
        original_bytes = path.read_bytes()
        with image_api.open(path) as image:
            if image.format != "PNG" or image.mode != "RGBA":
                raise ValueError(f"Source must be an RGBA PNG: {path}")
            image.load()
            sources.append({
                "entry": entry,
                "path": path,
                "image": image.copy(),
                "png_sha256": sha256(original_bytes),
                "rgba_sha256": sha256(image.tobytes()),
            })
    return sources


def verify_container(psd_path, sources, expected_size, psd_api):
    document = psd_api.open(psd_path)
    if document.size != expected_size or document.depth != 8 or document.pil_mode != "RGBA":
        raise ValueError("The PSD document does not match the expected RGBA canvas.")
    if len(document) != len(sources):
        raise ValueError("The PSD layer count differs from the manifest.")
    verified = []
    for layer, source in zip(document, sources, strict=True):
        entry = source["entry"]
        if layer.name != entry["name"] or layer.visible != entry["visible"]:
            raise ValueError(f"Layer name or visibility changed: {entry['name']}")
        if layer.left != 0 or layer.top != 0:
            raise ValueError(f"Layer origin changed: {layer.name}")
        if layer.opacity != 255 or layer.has_mask():
            raise ValueError(f"Unexpected opacity or mask on layer: {layer.name}")
        decoded = layer.topil(apply_icc=False)
        original = source["image"]
        if decoded is None or decoded.mode != "RGBA" or decoded.size != original.size:
            raise ValueError(f"Layer dimensions or mode changed: {layer.name}")
        if decoded.tobytes() != original.tobytes():
            raise ValueError(f"RGBA pixel data changed: {layer.name}")
        if sha256(source["path"].read_bytes()) != source["png_sha256"]:
            raise ValueError(f"Original source file changed: {source['path']}")
        verified.append({
            "name": layer.name,
            "source": entry["source"],
            "size": list(original.size),
            "origin": [0, 0],
            "visible": layer.visible,
            "opacity": layer.opacity,
            "png_sha256": source["png_sha256"],
            "source_rgba_sha256": source["rgba_sha256"],
            "psd_layer_rgba_sha256": sha256(decoded.tobytes()),
            "rgba_roundtrip_identical": True,
        })
    return verified


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path(__file__).with_name("layers-manifest.json"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--dependency-dir", type=Path, help="Optional isolated Python package directory.")
    parser.add_argument("--force", action="store_true", help="Replace only the explicitly selected output/report files.")
    args = parser.parse_args()

    if args.dependency_dir:
        sys.path.insert(0, str(args.dependency_dir.resolve(strict=True)))
    try:
        from PIL import Image
        import psd_tools
        from psd_tools import PSDImage
        from psd_tools.constants import Compression
    except ImportError as error:
        raise RuntimeError("Install tools/requirements-psd.txt in an isolated Python environment.") from error

    if psd_tools.__version__ != "1.17.4":
        raise RuntimeError("Use the validated psd-tools version 1.17.4 from tools/requirements-psd.txt.")
    manifest = args.manifest.resolve(strict=True)
    output = args.output.resolve()
    report = (args.report or output.with_suffix(".validation.json")).resolve()
    if output.suffix.lower() != ".psd":
        raise ValueError("The output path must end with .psd.")
    if report == output:
        raise ValueError("The report and PSD paths must differ.")
    entries = load_manifest(manifest)
    sources = read_sources(entries, manifest.parent, Image)
    protected = {manifest, *(source["path"] for source in sources)}
    if output in protected or report in protected:
        raise ValueError("Output paths cannot overwrite the manifest or source images.")
    if not args.force and (output.exists() or report.exists()):
        raise FileExistsError("An output already exists. Choose another path or pass --force.")
    size = (max(source["image"].width for source in sources), max(source["image"].height for source in sources))
    document = PSDImage.new("RGBA", size, color=(0, 0, 0, 0), depth=8)
    for source in sources:
        entry = source["entry"]
        layer = document.create_pixel_layer(source["image"], name=entry["name"], top=0, left=0, compression=Compression.RLE)
        layer.visible = entry["visible"]

    output.parent.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="psd-container-", dir=output.parent) as temporary_dir:
        candidate = Path(temporary_dir) / output.name
        document.save(candidate)
        layers = verify_container(candidate, sources, size, PSDImage)
        result = {
            "scope": "PSD container packaging only. No Live2D rig, model, or runtime validation.",
            "container_validation_passed": True,
            "pixel_policy": "Unmodified RGBA bytes. No cropping, resizing, repainting, or source PNG writes.",
            "canvas_size": list(size),
            "layer_order": "bottom_to_top",
            "layer_count": len(layers),
            "output_file": output.name,
            "output_bytes": candidate.stat().st_size,
            "output_sha256": sha256(candidate.read_bytes()),
            "library_versions": {
                "psd-tools": psd_tools.__version__,
                "Pillow": Image.__version__,
                "numpy": importlib.metadata.version("numpy"),
            },
            "manifest_sha256": sha256(manifest.read_bytes()),
            "layers": layers,
        }
        candidate.replace(output)
        report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "report": str(report), "layers_verified": len(layers), "all_rgba_bytes_identical": True}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"PSD packaging failed: {error}", file=sys.stderr)
        sys.exit(1)
