"""Vendor the pinned flag-icons SVG set; run with the npm package archive path."""

import hashlib
import json
from pathlib import Path
import re
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = "7.5.0"
SHA256 = "c0b80bf0e08006a60f56621d6bc49f8c7131f4d1fef6737a165a673431f4b518"


def main():
    archive = Path(sys.argv[1])
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        raise ValueError("Unexpected flag-icons archive checksum")
    with tarfile.open(archive, "r:gz") as package:
        countries = json.load(package.extractfile("package/country.json"))
        selected = [c for c in countries if re.fullmatch(r"[a-z]{2}", c["code"]) and c["code"] != "xx"]
        codes = {
            "iso": sorted(c["code"] for c in selected if c["iso"]),
            "extra": sorted(c["code"] for c in selected if not c["iso"]),
        }
        assert len(codes["iso"]) == 249
        target = ROOT / "public" / "flags"
        target.mkdir(exist_ok=True)
        for country in selected:
            code = country["code"]
            data = package.extractfile(f"package/flags/4x3/{code}.svg").read()
            (target / f"{code}.svg").write_bytes(data)
        (ROOT / "src" / "flag-codes.json").write_text(json.dumps(codes, indent=2) + "\n", encoding="utf-8")
        license_text = package.extractfile("package/LICENSE").read().decode("utf-8")
        theme_version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
        notices = f"""Monitor Classic {theme_version} uses no external JavaScript libraries, fonts or icon services at runtime.
System fonts and platform emoji are supplied by the visitor's device.
The interface and charts are distributed under the repository MIT license.
No Microsoft proprietary image assets are included.
Development tools and their licenses are documented in THIRD_PARTY.md and package-lock.json.

Bundled country/region flags: flag-icons {VERSION}
Source: https://github.com/lipis/flag-icons/tree/v{VERSION}/flags/4x3
Archive: https://registry.npmjs.org/flag-icons/-/flag-icons-{VERSION}.tgz
Archive SHA-256: {SHA256}

{license_text}"""
        (ROOT / "THIRD_PARTY_NOTICES.txt").write_text(notices, encoding="utf-8")
        print(f"Imported {len(selected)} flags ({len(codes['iso'])} ISO, {len(codes['extra'])} extras)")


if __name__ == "__main__":
    main()
