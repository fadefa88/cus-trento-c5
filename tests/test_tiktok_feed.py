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
    def create_image(self, root, filename, size):
        path = root / "img" / "social" / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", size, "red").save(path, format="JPEG")
        return "/" + path.relative_to(root).as_posix()


    def test_real_public_tiktok_page_hydration_provides_complete_caption(self):
        desc = "Bentornati alla Cus Trento League 🥳 #futsal #calcio #torneo #università #student"
        payload = {"__DEFAULT_SCOPE__": {"webapp.video-detail": {
            "itemInfo": {"itemStruct": {
                "id": "7697221559471050017", "desc": desc,
                "createTime": "1792158650",
            }}
        }}}
        html_page = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">' + json.dumps(payload, ensure_ascii=False) + '</script>'
        with patch("scripts.update_instagram_feed.requests.get") as getter:
            getter.return_value.text = html_page
            getter.return_value.raise_for_status.return_value = None
            result = tiktok_page_metadata(VIDEO_URL)
        self.assertEqual(result["caption"], desc)
        self.assertEqual(result["source"], "tiktok-page-hydration")
        self.assertEqual(result["create_time"], "1792158650")

    def test_page_hydration_rejects_wrong_video_id(self):
        page = json.dumps({"__DEFAULT_SCOPE__": {"webapp.video-detail": {
            "itemInfo": {"itemStruct": {"id": "1234567890", "desc": "Not this video"}}
        }}})
        with patch("scripts.update_instagram_feed.requests.get") as getter:
            getter.return_value.text = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">' + page + '</script>'
            getter.return_value.raise_for_status.return_value = None
            self.assertEqual(tiktok_page_metadata(VIDEO_URL), {})

    def test_complete_page_description_beats_missing_oembed_and_truncated_rss(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            local = self.create_image(root, "good.jpg", (720, 1280))
            original = "Bentornati alla Cus Trento League 🥳 #futsal #calcio #torneo #università #student"
            old = {VIDEO_URL: {"image": local, "title": "", "caption": ""}}
            with (
                patch("scripts.update_instagram_feed.tiktok_oembed", return_value={}),
                patch("scripts.update_instagram_feed.tiktok_page_metadata", return_value={
                    "caption": original, "create_time": "1792158650", "source": "tiktok-page-hydration",
                }),
            ):
                result = normalize_tiktok_item({
                    "url": VIDEO_URL, "title": "Bentornati alla Cus Trento League...",
                }, root, old, "@custrentoc5")
            self.assertEqual(result["caption"], original)
            self.assertEqual(result["text"], original)
            self.assertEqual(result["title"], original[:120])
            self.assertEqual(result["metadataSource"], "tiktok-page-hydration")
            self.assertRegex(result["date"], r"^2026-10-")
            self.assertTrue(result["embed"])

    def test_epoch_post_dates_are_recognized(self):
        date, published = parse_date("1792158650")
        self.assertRegex(date, r"^2026-10-")
        self.assertTrue(published.endswith("+00:00"))

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
                patch("scripts.update_instagram_feed.tiktok_page_metadata", return_value={}),
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
                patch("scripts.update_instagram_feed.tiktok_page_metadata", return_value={}),
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
                patch("scripts.update_instagram_feed.tiktok_page_metadata", return_value={}),
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


    def test_oembed_preserves_full_original_description_instead_of_truncated_rss_title(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            local = self.create_image(root, "cover.jpg", (720, 1280))
            old = {VIDEO_URL: {"image": local, "caption": "Video TikTok CUS Trento C5"}}
            complete = "Gol decisivo del CUS Trento! Le azioni e i festeggiamenti della squadra #futsal"
            with (
                patch("scripts.update_instagram_feed.tiktok_oembed", return_value={"title": complete}),
                patch("scripts.update_instagram_feed.tiktok_page_metadata", return_value={}),
            ):
                item = normalize_tiktok_item(
                    {"url": VIDEO_URL, "title": "Gol decisivo del CUS Trento..."},
                    root, old, "@custrentoc5",
                )
            self.assertEqual(item["caption"], complete)
            self.assertEqual(item["title"], complete[:120])

    def test_missing_description_does_not_create_a_fake_caption(self):
        with tempfile.TemporaryDirectory() as temp:
            with (
                patch("scripts.update_instagram_feed.tiktok_oembed", return_value={}),
                patch("scripts.update_instagram_feed.tiktok_page_metadata", return_value={}),
                patch("scripts.update_instagram_feed.tiktok_video_metadata", return_value={}),
            ):
                item = normalize_tiktok_item(
                    {"url": VIDEO_URL, "title": VIDEO_URL},
                    Path(temp), {}, "@custrentoc5",
                )
            self.assertEqual(item["caption"], "")
            self.assertEqual(item["title"], "")
            self.assertTrue(item["embed"])

    def test_http_502_keeps_embeddable_video_urls_without_cover(self):
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
                patch("scripts.update_instagram_feed.tiktok_page_metadata", return_value={}),
                patch("scripts.update_instagram_feed.tiktok_video_metadata", return_value={}),
            ):
                posts = import_tiktok_posts("https://example.com/rss", root, cached, 12, "@custrentoc5")
            self.assertEqual(len(posts), 2)
            self.assertFalse(posts[0]["hidden"])
            self.assertEqual(posts[0]["image"], "")
            self.assertTrue(posts[0]["embed"])
            self.assertEqual(posts[1]["image"], valid)
            self.assertFalse(posts[1].get("hidden", False))

    def test_no_avatar_is_published_but_official_video_embed_is_kept(self):
        with tempfile.TemporaryDirectory() as temp:
            with (
                patch("scripts.update_instagram_feed.tiktok_oembed", return_value={}),
                patch("scripts.update_instagram_feed.tiktok_page_metadata", return_value={}),
                patch("scripts.update_instagram_feed.tiktok_video_metadata", return_value={}),
            ):
                post = normalize_tiktok_item(
                    {"url": VIDEO_URL, "title": VIDEO_URL, "image": AVATAR_URL},
                    Path(temp),
                    {},
                    "@custrentoc5",
                )
                self.assertIsNotNone(post)
            self.assertFalse(post["hidden"])
            self.assertTrue(post["embed"])
            self.assertEqual(post["image"], "")
            self.assertEqual(post["thumbnail"], "")


if __name__ == "__main__":
    unittest.main()
