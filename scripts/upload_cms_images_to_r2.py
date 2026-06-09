#!/usr/bin/env python3
"""
Optimize new images uploaded through Decap CMS, upload the optimized WebP files to
Cloudflare R2, and rewrite CMS JSON references to the public R2 URLs.

This script is intentionally conservative:
- only image files explicitly passed with --changed-files-list are processed by default;
- existing /img/uploads files already in the repository are left untouched;
- remote URLs, SVG, GIF and AVIF are left untouched;
- JSON files are rewritten only when they reference one of the eligible new uploads.

Required environment variables when not using --dry-run:
- R2_ENDPOINT: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
- R2_BUCKET: bucket name
- R2_ACCESS_KEY_ID: R2 S3 access key ID
- R2_SECRET_ACCESS_KEY: R2 S3 secret access key
- R2_PUBLIC_BASE_URL: public custom domain or r2.dev URL, without a trailing slash

Optional:
- R2_PREFIX: object key prefix, default cms/uploads
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import re
import sys
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

from PIL import Image, ImageOps


SITE_HOSTS = {"custrentocalcioa5.it", "www.custrentocalcioa5.it"}
SUPPORTED_INPUT_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
SKIP_EXTS = {".svg", ".gif", ".avif"}
DEFAULT_R2_PREFIX = "cms/uploads"


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


def slugify_filename(value: str, fallback: str = "image") -> str:
    stem = Path(value).stem.lower()
    stem = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")
    return stem or fallback


def normalize_public_base(value: str) -> str:
    return value.strip().rstrip("/")


class R2Client:
    def __init__(self, dry_run: bool = False) -> None:
        self.dry_run = dry_run
        self.endpoint = os.environ.get("R2_ENDPOINT", "").strip()
        self.bucket = os.environ.get("R2_BUCKET", "").strip()
        self.access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
        self.secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
        self.public_base = normalize_public_base(os.environ.get("R2_PUBLIC_BASE_URL", ""))
        self.prefix = os.environ.get("R2_PREFIX", DEFAULT_R2_PREFIX).strip().strip("/") or DEFAULT_R2_PREFIX
        self._client = None

    def validate(self) -> None:
        missing = [
            name
            for name, value in [
                ("R2_ENDPOINT", self.endpoint),
                ("R2_BUCKET", self.bucket),
                ("R2_ACCESS_KEY_ID", self.access_key),
                ("R2_SECRET_ACCESS_KEY", self.secret_key),
                ("R2_PUBLIC_BASE_URL", self.public_base),
            ]
            if not value
        ]
        if missing and not self.dry_run:
            raise RuntimeError("Missing required R2 environment variables: " + ", ".join(missing))

    def client(self):
        if self._client is None:
            try:
                import boto3  # type: ignore
            except ImportError as exc:
                raise RuntimeError("boto3 is required. Install it with: pip install boto3") from exc

            self._client = boto3.client(
                service_name="s3",
                endpoint_url=self.endpoint,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                region_name="auto",
            )
        return self._client

    def object_key(self, source: Path, profile: Profile, payload: bytes) -> str:
        digest = hashlib.sha256(payload).hexdigest()[:12]
        safe_stem = slugify_filename(source.name)
        return f"{self.prefix}/{profile.name}/{safe_stem}-{digest}.webp"

    def public_url(self, key: str) -> str:
        quoted_key = "/".join(quote(part) for part in key.split("/"))
        return f"{self.public_base}/{quoted_key}"

    def upload(self, key: str, payload: bytes) -> None:
        if self.dry_run:
            print(f"DRY RUN: upload s3://{self.bucket}/{key} ({len(payload)} bytes)", flush=True)
            return

        self.client().put_object(
            Bucket=self.bucket,
            Key=key,
            Body=payload,
            ContentType="image/webp",
            CacheControl="public, max-age=31536000, immutable",
        )


class Optimizer:
    def __init__(
        self,
        root: Path,
        changed_files: set[Path],
        r2: R2Client,
        delete_local_uploads: bool = True,
        dry_run: bool = False,
    ) -> None:
        self.root = root.resolve()
        self.changed_files = {p.resolve() for p in changed_files}
        self.r2 = r2
        self.delete_local_uploads = delete_local_uploads
        self.dry_run = dry_run
        self.replacements: dict[str, str] = {}
        self.changed_repo_files: set[Path] = set()
        self.warnings: list[str] = []
        self.processed: dict[tuple[Path, str], str] = {}
        self.uploaded_keys: list[str] = []

    def log(self, message: str) -> None:
        print(message, flush=True)

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        print(f"WARNING: {message}", flush=True)

    def is_r2_url(self, value: str) -> bool:
        base = self.r2.public_base
        return bool(base and value.strip().startswith(base + "/"))

    def public_to_local_path(self, value: str) -> Path | None:
        if not isinstance(value, str):
            return None

        raw = value.strip()
        if not raw or self.is_r2_url(raw):
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

    def local_to_repo_path(self, path: Path) -> str:
        return path.resolve().relative_to(self.root).as_posix()

    def local_to_public_path(self, path: Path) -> str:
        return "/" + self.local_to_repo_path(path)

    def is_eligible(self, source: Path) -> bool:
        resolved = source.resolve()
        return resolved in self.changed_files

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

    def optimize_upload_reference(self, value: str, profile_name: str) -> str:
        if value in self.replacements:
            return self.replacements[value]

        source = self.public_to_local_path(value)
        if source is None:
            return value
        if not self.is_eligible(source):
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

        profile = PROFILES[profile_name]
        key_for_processed = (source.resolve(), profile.name)
        if key_for_processed in self.processed:
            new_public = self.processed[key_for_processed]
            self.replacements[value] = new_public
            return new_public

        try:
            with self.load_image(source) as img:
                transformed = self.transform(img, profile)
                encoded = self.encode_webp(transformed, profile.quality)
        except Exception as exc:
            self.warn(f"Could not optimize {value}: {exc}")
            return value

        object_key = self.r2.object_key(source, profile, encoded)
        new_public = self.r2.public_url(object_key)

        self.log(
            f"Optimize and upload {self.local_to_public_path(source)} -> {new_public} "
            f"[{profile.name}, q={profile.quality}]"
        )
        self.r2.upload(object_key, encoded)
        self.uploaded_keys.append(object_key)

        self.processed[key_for_processed] = new_public
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
                new_value = self.optimize_upload_reference(current, profile)
                if new_value != current:
                    item[field] = new_value
                    changed = True
        return changed

    def process_news_items(self, news_items: Any) -> bool:
        changed = False
        if not isinstance(news_items, list):
            return changed

        for article in news_items:
            if not isinstance(article, dict):
                continue

            image = article.get("image")
            if isinstance(image, str):
                new_image = self.optimize_upload_reference(image, "news")
                if new_image != image:
                    article["image"] = new_image
                    changed = True

            blocks = article.get("contentBlocks")
            if isinstance(blocks, list):
                for block in blocks:
                    if not isinstance(block, dict):
                        continue
                    block_image = block.get("image")
                    if isinstance(block_image, str):
                        new_block_image = self.optimize_upload_reference(block_image, "news")
                        if new_block_image != block_image:
                            block["image"] = new_block_image
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
                new_cover = self.optimize_upload_reference(cover, "gallery")
                if new_cover != cover:
                    album["cover"] = new_cover
                    changed = True

            photos = album.get("photos")
            if isinstance(photos, list):
                new_photos = []
                for photo in photos:
                    if isinstance(photo, str):
                        new_photo = self.optimize_upload_reference(photo, "gallery")
                        changed = changed or (new_photo != photo)
                        new_photos.append(new_photo)
                    elif isinstance(photo, dict):
                        photo_changed = False
                        updated = dict(photo)
                        for key in ("u", "url", "photo", "image", "src"):
                            val = updated.get(key)
                            if isinstance(val, str):
                                new_val = self.optimize_upload_reference(val, "gallery")
                                if new_val != val:
                                    updated[key] = new_val
                                    photo_changed = True
                        changed = changed or photo_changed
                        new_photos.append(updated)
                    else:
                        new_photos.append(photo)
                album["photos"] = new_photos

        return changed

    def process_club_history(self, club_history: Any) -> bool:
        changed = False
        if not isinstance(club_history, dict):
            return changed
        images = club_history.get("images")
        if not isinstance(images, list):
            return changed
        for item in images:
            if not isinstance(item, dict):
                continue
            current = item.get("image")
            if isinstance(current, str):
                new_value = self.optimize_upload_reference(current, "gallery")
                if new_value != current:
                    item["image"] = new_value
                    changed = True
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
            changed |= self.process_news_items(data.get("news"))
            changed |= self.process_list_objects(data.get("sponsors"), "logo", "sponsor")
            changed |= self.process_gallery_albums(data.get("galleryAlbums"))
            changed |= self.process_club_history(data.get("clubHistory"))

        data, replacement_changed = self.recursively_replace_known_paths(data)
        changed = changed or replacement_changed

        if changed:
            self.log(f"Update JSON references: {path.relative_to(self.root)}")
            if not self.dry_run:
                path.write_text(
                    json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
            self.changed_repo_files.add(path)

    def json_files(self) -> list[Path]:
        paths: list[Path] = []
        for pattern in [
            "content/cms/*.json",
            "content/data.json",
            "content/data.generated.optional.json",
        ]:
            paths.extend(sorted(self.root.glob(pattern)))
        return [p for p in paths if p.exists()]

    def delete_processed_local_uploads(self) -> None:
        if not self.delete_local_uploads:
            return

        processed_sources = sorted({source for (source, _profile) in self.processed.keys()})
        for source in processed_sources:
            if not source.exists():
                continue
            self.log(f"Remove local CMS upload after R2 migration: {self.local_to_public_path(source)}")
            if not self.dry_run:
                source.unlink()
            self.changed_repo_files.add(source)

    def run(self) -> int:
        if not self.changed_files:
            self.log("No new CMS uploaded images to process.")
            return 0

        self.r2.validate()

        self.log("Eligible CMS uploads:")
        for path in sorted(self.changed_files):
            try:
                self.log(f"- {path.relative_to(self.root)}")
            except ValueError:
                self.log(f"- {path}")

        for path in self.json_files():
            self.process_json_file(path)

        self.delete_processed_local_uploads()

        if self.warnings:
            self.log("\nWarnings:")
            for warning in self.warnings:
                self.log(f"- {warning}")

        if self.uploaded_keys:
            self.log("\nUploaded R2 objects:")
            for key in self.uploaded_keys:
                self.log(f"- s3://{self.r2.bucket}/{key}")
        else:
            self.log("No JSON references matched the new uploads. Nothing uploaded to R2.")

        if self.changed_repo_files:
            self.log("\nChanged repository files:")
            for path in sorted(self.changed_repo_files):
                try:
                    self.log(f"- {path.relative_to(self.root)}")
                except ValueError:
                    self.log(f"- {path}")
        else:
            self.log("No repository file changes.")

        return 0


def read_changed_files(root: Path, list_path: Path) -> set[Path]:
    if not list_path.exists():
        return set()

    out: set[Path] = set()
    for line in list_path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw:
            continue
        path = (root / raw).resolve()
        try:
            rel = path.relative_to(root.resolve()).as_posix()
        except ValueError:
            continue
        if not rel.startswith("img/uploads/"):
            continue
        if path.suffix.lower() in SKIP_EXTS:
            continue
        if path.suffix.lower() not in SUPPORTED_INPUT_EXTS:
            continue
        if path.exists():
            out.add(path)
    return out


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Optimize new CMS uploads, upload them to R2, and rewrite JSON references.")
    parser.add_argument("--root", default=".", help="Repository root")
    parser.add_argument("--changed-files-list", required=True, help="Text file containing changed repo paths, one per line")
    parser.add_argument("--keep-local-uploads", action="store_true", help="Keep local uploaded images after R2 upload")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without writing files or uploading to R2")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    changed_files = read_changed_files(root, Path(args.changed_files_list))
    optimizer = Optimizer(
        root=root,
        changed_files=changed_files,
        r2=R2Client(dry_run=args.dry_run),
        delete_local_uploads=not args.keep_local_uploads,
        dry_run=args.dry_run,
    )
    return optimizer.run()


if __name__ == "__main__":
    raise SystemExit(main())
