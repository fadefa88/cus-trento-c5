#!/usr/bin/env python3
"""
Optimize images uploaded through Decap CMS.

Profiles:
- roster/staff photos: 800x1000 WebP, cover crop, quality 82
- news images: max width 1600 WebP, quality 82
- gallery covers/photos: max width 1600 WebP, quality 80
- sponsor logos: max width 300 WebP, quality 90

The script also rewrites JSON references from .jpg/.jpeg/.png to .webp.
SVG and remote images are intentionally left untouched.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from PIL import Image, ImageOps


SITE_HOSTS = {"custrentocalcioa5.it", "www.custrentocalcioa5.it"}
SUPPORTED_INPUT_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
SKIP_EXTS = {".svg", ".gif", ".avif"}


@dataclass(frozen=True)
class Profile:
    name: str
    quality: int
    max_width: int | None = None
    size: tuple[int, int] | None = None
    cover: bool = False


PROFILES = {
    "people": Profile(name="people", size=(800, 1000), cover=True, quality=82),
    "news": Profile(name="news", max_width=1600, quality=82),
    "gallery": Profile(name="gallery", max_width=1600, quality=80),
    "sponsor": Profile(name="sponsor", max_width=300, quality=90),
}


class Optimizer:
    def __init__(self, root: Path, delete_originals: bool = True, dry_run: bool = False) -> None:
        self.root = root.resolve()
        self.delete_originals = delete_originals
        self.dry_run = dry_run
        self.replacements: dict[str, str] = {}
        self.changed_files: set[Path] = set()
        self.warnings: list[str] = []
        self.processed: dict[tuple[Path, str], str] = {}

    def log(self, message: str) -> None:
        print(message, flush=True)

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        print(f"WARNING: {message}", flush=True)

    def public_to_local_path(self, value: str) -> Path | None:
        if not isinstance(value, str):
            return None

        raw = value.strip()
        if not raw:
            return None

        parsed = urlparse(raw)
        if parsed.scheme in {"http", "https"}:
            if parsed.netloc.lower() not in SITE_HOSTS:
                return None
            raw = parsed.path
        elif parsed.scheme:
            return None

        raw = raw.split("?", 1)[0].split("#", 1)[0]
        if raw.startswith("/"):
            raw = raw[1:]

        if not raw.startswith("img/uploads/"):
            return None

        candidate = (self.root / raw).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError:
            return None
        return candidate

    def local_to_public_path(self, path: Path) -> str:
        return "/" + path.resolve().relative_to(self.root).as_posix()

    def output_path_for(self, source: Path) -> Path:
        if source.suffix.lower() == ".webp":
            return source
        return source.with_suffix(".webp")

    def load_image(self, source: Path) -> Image.Image:
        img = Image.open(source)
        img = ImageOps.exif_transpose(img)
        return img

    def has_alpha(self, img: Image.Image) -> bool:
        if img.mode in {"RGBA", "LA"}:
            return True
        if img.mode == "P" and "transparency" in img.info:
            return True
        return False

    def normalize_mode_for_webp(self, img: Image.Image) -> Image.Image:
        if self.has_alpha(img):
            return img.convert("RGBA")
        return img.convert("RGB")

    def webp_already_satisfies_profile(self, img: Image.Image, profile: Profile) -> bool:
        if profile.cover and profile.size:
            return img.size == profile.size
        if profile.max_width:
            return img.width <= profile.max_width
        return True

    def transform(self, img: Image.Image, profile: Profile) -> Image.Image:
        if profile.cover and profile.size:
            img = ImageOps.fit(
                img,
                profile.size,
                method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.5),
            )
            return self.normalize_mode_for_webp(img)

        if profile.max_width and img.width > profile.max_width:
            ratio = profile.max_width / float(img.width)
            new_height = max(1, round(img.height * ratio))
            img = img.resize((profile.max_width, new_height), Image.Resampling.LANCZOS)

        return self.normalize_mode_for_webp(img)

    def encode_webp(self, img: Image.Image, quality: int) -> bytes:
        buffer = BytesIO()
        img.save(buffer, format="WEBP", quality=quality, method=6)
        return buffer.getvalue()

    def optimize_reference(self, value: str, profile_name: str) -> str:
        if value in self.replacements:
            return self.replacements[value]

        profile = PROFILES[profile_name]
        source = self.public_to_local_path(value)
        if source is None:
            return value

        suffix = source.suffix.lower()
        if suffix in SKIP_EXTS:
            return value
        if suffix not in SUPPORTED_INPUT_EXTS:
            self.warn(f"Unsupported image type skipped: {self.local_to_public_path(source)}")
            return value
        if not source.exists():
            self.warn(f"Referenced image not found: {value}")
            return value

        key = (source, profile.name)
        if key in self.processed:
            new_public = self.processed[key]
            self.replacements[value] = new_public
            return new_public

        output = self.output_path_for(source)
        new_public = self.local_to_public_path(output)

        try:
            with self.load_image(source) as img:
                # WebP files that already satisfy the target dimensions are left untouched.
                # This keeps the workflow idempotent and avoids repeated commits caused by
                # harmless encoder-level byte differences.
                if suffix == ".webp" and self.webp_already_satisfies_profile(img, profile):
                    self.processed[key] = new_public
                    self.replacements[value] = new_public
                    return new_public

                transformed = self.transform(img, profile)
                encoded = self.encode_webp(transformed, profile.quality)
        except Exception as exc:
            self.warn(f"Could not optimize {value}: {exc}")
            return value

        old_bytes = output.read_bytes() if output.exists() else None
        if old_bytes != encoded:
            self.log(
                f"Optimize {self.local_to_public_path(source)} -> {new_public} "
                f"[{profile.name}, q={profile.quality}]"
            )
            if not self.dry_run:
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(encoded)
            self.changed_files.add(output)

        if self.delete_originals and source != output and source.exists():
            self.log(f"Remove original {self.local_to_public_path(source)}")
            if not self.dry_run:
                source.unlink()
            self.changed_files.add(source)

        self.processed[key] = new_public
        self.replacements[value] = new_public
        return new_public

    def process_list_objects(self, items: Any, field: str, profile: str) -> bool:
        changed = False
        if not isinstance(items, list):
            return changed
        for item in items:
            if not isinstance(item, dict):
                continue
            current = item.get(field)
            if isinstance(current, str):
                new_value = self.optimize_reference(current, profile)
                if new_value != current:
                    item[field] = new_value
                    changed = True
        return changed

    def process_gallery_albums(self, albums: Any) -> bool:
        changed = False
        if not isinstance(albums, list):
            return changed

        for album in albums:
            if not isinstance(album, dict):
                continue

            cover = album.get("cover")
            if isinstance(cover, str):
                new_cover = self.optimize_reference(cover, "gallery")
                if new_cover != cover:
                    album["cover"] = new_cover
                    changed = True

            photos = album.get("photos")
            if isinstance(photos, list):
                new_photos = []
                for photo in photos:
                    if isinstance(photo, str):
                        new_photo = self.optimize_reference(photo, "gallery")
                        changed = changed or (new_photo != photo)
                        new_photos.append(new_photo)
                    elif isinstance(photo, dict):
                        photo_changed = False
                        updated = dict(photo)
                        for key in ("u", "url", "photo", "image", "src"):
                            val = updated.get(key)
                            if isinstance(val, str):
                                new_val = self.optimize_reference(val, "gallery")
                                if new_val != val:
                                    updated[key] = new_val
                                    photo_changed = True
                        changed = changed or photo_changed
                        new_photos.append(updated)
                    else:
                        new_photos.append(photo)
                album["photos"] = new_photos

        return changed

    def recursively_replace_known_paths(self, value: Any) -> tuple[Any, bool]:
        if isinstance(value, str):
            replacement = self.replacements.get(value)
            if replacement is not None and replacement != value:
                return replacement, True
            return value, False
        if isinstance(value, list):
            changed = False
            out = []
            for item in value:
                new_item, item_changed = self.recursively_replace_known_paths(item)
                changed = changed or item_changed
                out.append(new_item)
            return out, changed
        if isinstance(value, dict):
            changed = False
            out = {}
            for key, item in value.items():
                new_item, item_changed = self.recursively_replace_known_paths(item)
                changed = changed or item_changed
                out[key] = new_item
            return out, changed
        return value, False

    def process_json_file(self, path: Path) -> None:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            self.warn(f"Invalid JSON skipped {path}: {exc}")
            return

        changed = False
        if isinstance(data, dict):
            changed |= self.process_list_objects(data.get("roster"), "photo", "people")
            changed |= self.process_list_objects(data.get("staff"), "photo", "people")
            changed |= self.process_list_objects(data.get("news"), "image", "news")
            changed |= self.process_list_objects(data.get("sponsors"), "logo", "sponsor")
            changed |= self.process_gallery_albums(data.get("galleryAlbums"))

        data, replacement_changed = self.recursively_replace_known_paths(data)
        changed = changed or replacement_changed

        if changed:
            self.log(f"Update JSON references: {path.relative_to(self.root)}")
            if not self.dry_run:
                path.write_text(
                    json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
            self.changed_files.add(path)

    def json_files(self) -> list[Path]:
        paths: list[Path] = []
        for pattern in [
            "content/cms/*.json",
            "content/data.json",
            "content/data.generated.optional.json",
        ]:
            paths.extend(sorted(self.root.glob(pattern)))
        return [p for p in paths if p.exists()]

    def run(self) -> int:
        for path in self.json_files():
            self.process_json_file(path)

        if self.warnings:
            self.log("\nWarnings:")
            for warning in self.warnings:
                self.log(f"- {warning}")

        if self.changed_files:
            self.log("\nChanged files:")
            for path in sorted(self.changed_files):
                try:
                    self.log(f"- {path.relative_to(self.root)}")
                except ValueError:
                    self.log(f"- {path}")
        else:
            self.log("No CMS image optimization changes.")

        return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Optimize CMS uploaded images and update JSON references.")
    parser.add_argument("--root", default=".", help="Repository root")
    parser.add_argument(
        "--keep-originals",
        action="store_true",
        help="Keep original JPG/PNG files after WebP conversion",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print actions without writing files")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    optimizer = Optimizer(
        root=Path(args.root),
        delete_originals=not args.keep_originals,
        dry_run=args.dry_run,
    )
    return optimizer.run()


if __name__ == "__main__":
    raise SystemExit(main())
