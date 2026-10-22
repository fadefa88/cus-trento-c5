"""Regression checks for video covers imported into the CUS Trento social wall."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from scripts.update_instagram_feed import (
    is_tiktok_avatar_url,
    normalize_tiktok_item,
    tiktok_image_from_item,
    useful_tiktok_caption,
    valid_tiktok_cover,
    import_tiktok_posts,
)


VIDEO_URL = "https://www.tiktok.com/@custrentoc5/video/7697221559471050017"
AVATAR_URL = (
    "https://p16-common-sign.tiktokcdn-eu.com/tos-no1a-avt-0068c001-no/"
    "test~tplv-tiktokx-cropcenter:100:100.jpeg"
)
COVER_URL = "https://p16.tiktokcdn.com/video-cover/720x1280.jpeg"


class TestTikTokFeed(unittest.TestCase):
    def create_image(self, root, filename, size):
        path = root / "img" / "social" / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", size, "red").save(path, format="JPEG")
        return "/" + path.relative_to(root).as_posix()

    def test_rss_avatar_is_not_a_video_cover(self):
        self.assertTrue(is_tiktok_avatar_url(AVATAR_URL))
        self.assertFalse(is_tiktok_avatar_url(COVER_URL))
        self.assertEqual(tiktok_image_from_item({"image": AVATAR_URL, "icon": AVATAR_URL}), "")

    def test_small_files_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            small = self.create_image(root, "avatar.jpg", (100, 100))
            large = self.create_image(root, "cover.jpg", (720, 1280))
            self.assertFalse(valid_tiktok_cover(small, root))
            self.assertTrue(valid_tiktok_cover(large, root))

    def test_caption_does_not_become_a_video_url(self):
        self.assertEqual(useful_tiktok_caption(VIDEO_URL), "")
        self.assertEqual(useful_tiktok_caption("Video TikTok CUS Trento C5"), "")
        self.assertEqual(useful_tiktok_caption("Il primo goal in Serie B!"), "Il primo goal in Serie B!")

    def test_new_post_uses_oembed_video_cover(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            local = self.create_image(root, "new-video.jpg", (720, 1280))
            with (
                patch("scripts.update_instagram_feed.tiktok_oembed", return_value={
                    "title": "Gol del CUS Trento",
                    "thumbnail_url": COVER_URL,
                }),
                patch("scripts.update_instagram_feed.download_image", return_value=(local, COVER_URL)) as fetch,
            ):
                post = normalize_tiktok_item(
                    {"url": VIDEO_URL, "title": VIDEO_URL, "image": AVATAR_URL},
                    root,
                    {},
                    "@custrentoc5",
                )
                self.assertIsNotNone(post)
                self.assertEqual(post["image"], local)
                self.assertEqual(post["caption"], "Gol del CUS Trento")
                fetch.assert_called_once()
                self.assertEqual(fetch.call_args.kwargs["min_dimension"], 240)

    def test_previous_good_cover_and_caption_are_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            local = self.create_image(root, "old-video.jpg", (720, 1280))
            old = {VIDEO_URL: {"image": local, "caption": "Copertina precedente", "url": VIDEO_URL}}
            with (
                patch("scripts.update_instagram_feed.tiktok_oembed", return_value={}),
                patch("scripts.update_instagram_feed.download_image") as fetch,
            ):
                post = normalize_tiktok_item({"url": VIDEO_URL, "title": VIDEO_URL, "icon": AVATAR_URL}, root, old, "@custrentoc5")
                self.assertEqual(post["image"], local)
                self.assertEqual(post["caption"], "Copertina precedente")
                fetch.assert_not_called()


    def test_http_502_recovers_cached_video_urls_and_hides_unavailable_covers(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            valid = self.create_image(root, "ok.jpg", (720, 1280))
            other_url = "https://www.tiktok.com/@custrentoc5/video/7696852069482761505"
            cached = [
                {"platform": "TikTok", "url": VIDEO_URL, "image": "/img/social/missing.jpg", "caption": VIDEO_URL},
                {"platform": "TikTok", "url": other_url, "image": valid, "caption": "Video precedente"},
            ]
            with (
                patch("scripts.update_instagram_feed.requests.get", side_effect=RuntimeError("HTTP 502")),
                patch("scripts.update_instagram_feed.tiktok_oembed", return_value={}),
            ):
                posts = import_tiktok_posts("https://example.com/rss", root, cached, 12, "@custrentoc5")
            self.assertEqual(len(posts), 2)
            self.assertTrue(posts[0]["hidden"])
            self.assertEqual(posts[1]["image"], valid)
            self.assertFalse(posts[1].get("hidden", False))

    def test_no_avatar_or_placeholder_published_as_real_post(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch("scripts.update_instagram_feed.tiktok_oembed", return_value={}):
                post = normalize_tiktok_item(
                    {"url": VIDEO_URL, "title": VIDEO_URL, "image": AVATAR_URL},
                    Path(temp),
                    {},
                    "@custrentoc5",
                )
                self.assertIsNone(post)


if __name__ == "__main__":
    unittest.main()
