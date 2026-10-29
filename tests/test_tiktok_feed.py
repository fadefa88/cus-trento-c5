"""Regression checks for video covers imported into the CUS Trento social wall."""
import tempfile
import json
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
    tiktok_page_metadata,
    parse_date,
    import_tiktok_posts,
    tiktok_video_metadata,
)


VIDEO_URL = "https://www.tiktok.com/@custrentoc5/video/7697221559471050017"
AVATAR_URL = (
    "https://p16-common-sign.tiktokcdn-eu.com/tos-no1a-avt-0068c001-no/"
    "test~tplv-tiktokx-cropcenter:100:100.jpeg"
)
COVER_URL = "https://p16.tiktokcdn.com/video-cover/720x1280.jpeg"


class TestTikTokFeed(unittest.TestCase):
    def setUp(self):
        # No real TikTok requests in unit tests: the fallback must be mocked too.
        self._original_tiktok_page = tiktok_page_metadata
        for function in ("tiktok_page_metadata", "tiktok_video_metadata"):
            no_network = patch(f"scripts.update_instagram_feed.{function}", return_value={})
            no_network.start()
            self.addCleanup(no_network.stop)

    def create_image(self, root, filename, size):
        path = root / "img" / "social" / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", size, "red").save(path, format="JPEG")
        return "/" + path.relative_to(root).as_posix()


    def test_public_page_metadata_extracts_true_caption_and_cover(self):
        caption = "Bentornati alla Cus Trento League 🥳 #futsal #calcio #torneo"
        data = {"__DEFAULT_SCOPE__": {"webapp.video-detail": {
            "itemInfo": {"itemStruct": {
                "id": "7697221559471050017", "desc": caption,
                "createTime": "1792158650",
                "video": {
                    "originCover": "https://example.com/video720.jpg",
                    "cover": "https://example.com/video640.jpg",
                },
            }}
        }}}
        page = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">' + json.dumps(data, ensure_ascii=False) + '</script>'
        with patch("scripts.update_instagram_feed.requests.get") as request:
            request.return_value.text = page
            request.return_value.raise_for_status.return_value = None
            # This mock overrides setUp's default for the duration of this check.
            with patch("scripts.update_instagram_feed.tiktok_page_metadata", side_effect=None, wraps=None) as unused:
                pass
            # Access the real function via a locally restored patch.
            from scripts import update_instagram_feed as module
            self._metadata_module = module
            real = self._original_tiktok_page
            result = real(VIDEO_URL)
        self.assertEqual(result["caption"], caption)
        self.assertEqual(result["create_time"], "1792158650")
        self.assertEqual(result["cover_urls"], [
            "https://example.com/video720.jpg", "https://example.com/video640.jpg"
        ])

    def test_metadata_rejects_wrong_video_id(self):
        data = {"__DEFAULT_SCOPE__": {"webapp.video-detail": {
            "itemInfo": {"itemStruct": {"id": "123456789012345678", "desc": "Wrong post"}}
        }}}
        with patch("scripts.update_instagram_feed.requests.get") as request:
            request.return_value.text = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">' + json.dumps(data) + '</script>'
            request.return_value.raise_for_status.return_value = None
            self.assertEqual(self._original_tiktok_page(VIDEO_URL), {})

    def test_authentic_description_overrides_truncated_rss_caption(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cover = self.create_image(root, "actual.jpg", (720, 1280))
            full = "Un’analisi video tranquilla: Mepo Core 💥 #futsal #calcio #calcioa5 #università #studenti"
            with patch("scripts.update_instagram_feed.tiktok_page_metadata", return_value={
                "caption": full, "create_time": "1792158650", "cover_urls": [],
            }):
                result = normalize_tiktok_item(
                    {"url": VIDEO_URL, "title": "Un’analisi video tranquilla..."},
                    root, {VIDEO_URL: {"image": cover}}, "@custrentoc5",
                )
            self.assertEqual(result["caption"], full)
            self.assertEqual(result["title"], full[:120])
            self.assertRegex(result["date"], "^2026-10-")
            self.assertEqual(result["image"], cover)

    def test_latest_video_is_visible_without_cover_or_avatar(self):
        with tempfile.TemporaryDirectory() as temp:
            caption = "Bentornati alla Cus Trento League 🥳 #futsal"
            with (
                patch("scripts.update_instagram_feed.tiktok_page_metadata", return_value={
                    "caption": caption, "create_time": "", "cover_urls": [],
                }),
                patch("scripts.update_instagram_feed.tiktok_oembed", return_value={}),
                patch("scripts.update_instagram_feed.tiktok_video_metadata", return_value={}),
            ):
                post = normalize_tiktok_item(
                    {"url": VIDEO_URL, "title": VIDEO_URL, "image": AVATAR_URL},
                    Path(temp), {}, "@custrentoc5",
                )
            self.assertIsNotNone(post)
            self.assertEqual(post["caption"], caption)
            self.assertEqual(post["thumbnail"], "/img/placeholder.webp")
            self.assertFalse(post.get("hidden", False))

    def test_known_caption_is_preserved_during_page_metadata_outage(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            prior = "Testo originale completo #futsal #università"
            good = self.create_image(root, "cover.jpg", (720, 1280))
            with patch("scripts.update_instagram_feed.tiktok_oembed", return_value={}):
                post = normalize_tiktok_item({"url": VIDEO_URL, "title": "Testo..."}, root,
                    {VIDEO_URL: {"image":good, "caption":prior}}, "@custrentoc5")
            self.assertEqual(post["caption"], prior)

    def test_epoch_timestamp(self):
        day, published = parse_date("1792158650")
        self.assertTrue(day.startswith("2026-10-"))
        self.assertTrue(published.endswith("+00:00"))

    def test_feed_latest_videos_are_visible_with_original_captions(self):
        root = Path(__file__).resolve().parents[1]
        feed = json.loads((root/"content"/"social-feed.json").read_text(encoding="utf-8"))
        posts = [x for x in feed["posts"] if x.get("platform") == "TikTok"]
        self.assertGreaterEqual(len(posts), 2)
        # Do not pin captions to the first two positions: new videos must be
        # allowed to appear above older posts without breaking CI.
        for post in posts[:2]:
            with self.subTest(url=post.get("url")):
                self.assertFalse(post.get("hidden", False))
                self.assertFalse(post.get("placeholder", False))
                self.assertRegex(post.get("url", ""), r"^https://www\.tiktok\.com/@custrentoc5/video/\d+$")
                caption = useful_tiktok_caption(post.get("caption"))
                self.assertTrue(caption, "The latest videos must have a real caption")
                self.assertEqual(post.get("text"), caption)
                self.assertEqual(post.get("permalink"), post.get("url"))
                self.assertTrue(
                    str(post.get("title") or "").startswith(caption[:60]),
                    "Video title must reflect the original caption",
                )
        self.assertNotEqual(posts[0]["url"], posts[1]["url"])
        # The feed must keep the newest TikTok item at the top.
        self.assertGreaterEqual(str(posts[0].get("date") or ""), str(posts[1].get("date") or ""))

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



    def test_public_video_metadata_fallback_recovers_cover_and_description(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            valid = self.create_image(root, "latest-video.jpg", (720, 1280))
            with (
                patch("scripts.update_instagram_feed.tiktok_oembed", return_value={}),
                patch("scripts.update_instagram_feed.tiktok_video_metadata", return_value={
                    "caption": "Ultimo video CUS Trento",
                    "cover_urls": [COVER_URL],
                }) as extractor,
                patch("scripts.update_instagram_feed.download_image", return_value=(valid, COVER_URL)) as download,
            ):
                item = normalize_tiktok_item(
                    {"url": VIDEO_URL, "title": VIDEO_URL, "image": AVATAR_URL},
                    root, {}, "@custrentoc5",
                )
            self.assertEqual(item["image"], valid)
            self.assertEqual(item["caption"], "Ultimo video CUS Trento")
            self.assertEqual(item["remoteImage"], COVER_URL)
            extractor.assert_called_once_with(VIDEO_URL)
            download.assert_called_once()

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
