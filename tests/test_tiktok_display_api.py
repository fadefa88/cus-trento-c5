"""Offline regression checks for the official TikTok Display API pipeline."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet
from PIL import Image

from scripts import sync_tiktok_display_api as api


class TestOfficialTikTok(unittest.TestCase):
    def test_normalize_video_preserves_correct_caption_and_local_cover(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            img = root / "img/social/tiktok-1234567890abcdef.jpg"
            img.parent.mkdir(parents=True)
            Image.new("RGB", (480, 800), "red").save(img, format="JPEG")
            with patch.object(api, "ROOT", root):
                item = api.normalize_video(
                    {"id": "7697221559471050017", "video_description": "Nuovo video CUS",
                     "create_time": 1792600000, "cover_image_url": "https://example.com/expires.jpg"},
                    {"7697221559471050017": {"image": "/img/social/tiktok-1234567890abcdef.jpg"}},
                )
            self.assertEqual(item["caption"], "Nuovo video CUS")
            self.assertEqual(item["source"], "tiktok-display-api")
            self.assertEqual(item["hidden"], False)
            self.assertEqual(item["thumbnail"], "/img/social/tiktok-1234567890abcdef.jpg")

    def test_invalid_avatar_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            img = root / "img/social/tiktok-1234567890abcdef.jpg"
            img.parent.mkdir(parents=True)
            Image.new("RGB", (100, 100), "blue").save(img, format="JPEG")
            with patch.object(api, "ROOT", root):
                self.assertFalse(api.is_valid_local("/img/social/tiktok-1234567890abcdef.jpg"))
                with patch.object(api.requests, "get") as fetch:
                    self.assertEqual(
                        api.cover_for("https://www.tiktok.com/@custrentoc5/video/123", "https://cdn.tiktok.com/tos-avt-image", {}),
                        "",
                    )
                    fetch.assert_not_called()

    def test_api_error_does_not_publish_fake_videos(self):
        with patch.object(api.requests, "post") as request:
            request.return_value.json.return_value = {
                "error": {"code": "scope_not_authorized", "message": "Not authorized"},
                "data": {"videos": []},
            }
            request.return_value.raise_for_status.return_value = None
            with self.assertRaisesRegex(RuntimeError, "scope_not_authorized"):
                api.fetch_latest("fake-token", 12)

    def test_rotated_refresh_token_is_encrypted_at_rest(self):
        with tempfile.TemporaryDirectory() as tmp:
            token_file = Path(tmp) / "secret.enc"
            key = Fernet.generate_key().decode()
            previous = {
                "access_token": "expired-token", "refresh_token": "old-rt",
                "expires_at": 1, "refresh_expires_at": 4102444800, "scope": "video.list",
            }
            with (
                patch.object(api, "TOKEN_FILE", token_file),
                patch.dict(os.environ, {
                    "TIKTOK_CLIENT_KEY": "client-key",
                    "TIKTOK_CLIENT_SECRET": "client-secret",
                    "TIKTOK_FERNET_KEY": key,
                }),
                patch.object(api.requests, "post") as request,
            ):
                api.save_credentials(previous)
                response = request.return_value
                response.raise_for_status.return_value = None
                response.json.return_value = {
                    "access_token": "new-access-token",
                    "refresh_token": "new-refresh-token",
                    "expires_in": 86400,
                    "refresh_expires_in": 31536000,
                    "scope": "video.list",
                }
                self.assertEqual(api.authenticated_token(), "new-access-token")
                self.assertEqual(api.load_credentials()["refresh_token"], "new-refresh-token")
                self.assertNotIn(b"new-refresh-token", token_file.read_bytes())

    def test_official_feed_updates_without_replacing_instagram(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "content/social-feed.json"
            path.parent.mkdir(parents=True)
            initial = {"posts": [
                {"platform": "Instagram", "url": "https://www.instagram.com/p/abc"},
                {"platform": "TikTok", "url": "https://www.tiktok.com/@custrentoc5/video/123",
                 "hidden": True},
            ], "sourceHits": {}}
            path.write_text(json.dumps(initial))
            latest = {"id": "7697221559471050017", "video_description": "Ultimo video"}
            cover = {"platform": "TikTok", "id": "tiktok-123", "url": "https://www.tiktok.com/@custrentoc5/video/7697221559471050017", "image": "/img/social/tiktok-1234567890abcdef.jpg"}
            with (
                patch.object(api, "FEED", path),
                patch.object(api, "authenticated_token", return_value="valid-token"),
                patch.object(api, "fetch_latest", return_value=[latest]),
                patch.object(api, "normalize_video", return_value=cover),
            ):
                api.sync(12)
            updated = json.loads(path.read_text())
            self.assertEqual(updated["posts"][0], initial["posts"][0])
            self.assertEqual(updated["posts"][1], cover)
            self.assertEqual(updated["sourceHits"]["tiktokDisplayAPI"], 1)


if __name__ == "__main__":
    unittest.main()
