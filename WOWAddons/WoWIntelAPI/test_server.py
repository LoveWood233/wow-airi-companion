import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import urlopen

from server import (APIError, Cache, IntelService, allowed_url, make_handler,
                    normalize_date, parse_article, parse_catalog, parse_news)


class SourceTests(unittest.TestCase):
    def test_dates_are_not_fabricated(self):
        self.assertIsNone(normalize_date("2026-10-20 13:00:00"))
        self.assertIsNone(normalize_date("unknown"))
        self.assertEqual(normalize_date("2026-10-20T13:00:00-05:00"), "2026-10-20T18:00:00+00:00")
        self.assertEqual(normalize_date("Tue, 20 Oct 2026 13:00:00 -0500"), "2026-10-20T18:00:00+00:00")

    def test_outbound_allowlist(self):
        self.assertTrue(allowed_url("https://www.wowhead.com/guide/classes/mage/frost/bis-gear"))
        for url in ("http://127.0.0.1/guide/x", "https://www.wowhead.com.evil.test/guide/x",
                    "https://user@www.wowhead.com/guide/x", "https://www.wowhead.com:8888/guide/x",
                    "https://www.wowhead.com/guide/../account", "https://www.wowhead.com/guide/x?redirect=evil",
                    "https://www.wowhead.com/guide/%2e%2e/account"):
            self.assertFalse(allowed_url(url), url)

    def test_parse_catalog_without_executing_javascript(self):
        data = [{"title": "Mage &amp; Gear", "url": "https://www.wowhead.com/guide/classes/mage/frost/bis-gear",
                 "lastEdit": "2026-10-13T16:52:53-05:00", "patch": 120105}]
        # Trailing Listview options contain executable JavaScript, not JSON.
        html = 'new Listview({"id":"guides","data":' + json.dumps(data) + ',onClick:function(){evil()}});'
        item = parse_catalog(html)[0]
        self.assertEqual(item["topic"], "gear")
        self.assertEqual(item["title"], "Mage & Gear")
        self.assertEqual(item["compatibility"], "unverified")

    def test_parser_failure_is_not_successful_empty_result(self):
        with self.assertRaises(APIError):
            parse_catalog("<html>Access denied</html>")
        with self.assertRaises(APIError):
            parse_article("<html>Please sign in</html>")

    def test_retail_news_only_and_scripts_removed(self):
        xml = '''<rss><channel>
        <item><title>Live hotfix</title><link>https://www.wowhead.com/news=1/live</link><category>Live</category>
        <pubDate>Tue, 20 Oct 2026 13:00:00 -0500</pubDate><description>&lt;script&gt;bad()&lt;/script&gt;Loot update</description></item>
        <item><title>Classic patch</title><category>Classic</category></item>
        <item><title>PTR patch</title><category>PTR</category></item></channel></rss>'''
        items = parse_news(xml)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["summary"], "Loot update")
        self.assertIsNone(items[0]["updated_at"])

    def test_article_metadata_and_noscript_sections(self):
        html = '''<script type="application/ld+json">{"@type":"Article","headline":"Guide", "dateModified":"2026-10-13T10:00:00Z"}</script>
        <div id="guide-body"></div><noscript><h2>Raid <a>Build</a></h2><h3>Mythic+ Build</h3></noscript>
        <h2>Comments</h2>'''
        article = parse_article(html)
        self.assertEqual(article["sections"], ["Raid Build", "Mythic+ Build"])
        self.assertEqual(article["content_mode"], "metadata_and_section_index")


class CacheTests(unittest.TestCase):
    def test_cache_stale_fallback_keeps_original_fetch_time(self):
        clock = [1000]
        failed = [False]
        def fetch(url):
            if failed[0]:
                raise APIError("upstream blocked", 502)
            return "payload"
        cache = Cache(fetch, lambda: clock[0])
        data, first = cache.get("test", lambda text: {"value": text})
        data["value"] = "mutated"
        self.assertEqual(cache.get("test", lambda text: {})[0]["value"], "payload")
        failed[0] = True
        clock[0] += 700
        data, stale = cache.get("test", lambda text: {})
        self.assertTrue(stale["stale"])
        self.assertEqual(stale["fetched_at"], first["fetched_at"])
        clock[0] += 86401
        with self.assertRaises(APIError):
            cache.get("test", lambda text: {})

    def test_no_cache_failure_is_502(self):
        def fail(url):
            raise APIError("unreachable", 502)
        with self.assertRaises(APIError) as result:
            Cache(fail).get("x", parse_catalog)
        self.assertEqual(result.exception.status, 502)


class RoutingTests(unittest.TestCase):
    def setUp(self):
        self.service = IntelService()

    def test_invalid_inputs(self):
        cases = [("/api/v1/guides", {"class": ["mage"], "spec": ["holy"]}),
                 ("/api/v1/news", {"limit": ["NaN"]}),
                 ("/api/v1/news", {"days": ["0"]}),
                 ("/api/v1/news", {"topic": ["unknown"]}),
                 ("/api/v1/guide", {"url": ["http://localhost/"]}),
                 ("/api/v1/guides", {"topic": ["raid"], "class": ["mage"]})]
        for path, params in cases:
            with self.assertRaises(APIError):
                self.service.dispatch(path, params)

    def test_empty_filtered_results_are_valid(self):
        class FakeCache:
            def get(self, url, parser):
                return [], {"stale": False}
        service = IntelService(FakeCache())
        self.assertEqual(service.dispatch("/api/v1/news", {})["items"], [])
        self.assertEqual(service.dispatch("/api/v1/guides", {"topic": ["副本"]})["items"], [])

    def test_http_status_and_json_encoding(self):
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.service))
        worker = threading.Thread(target=httpd.serve_forever, daemon=True)
        worker.start()
        base = f"http://127.0.0.1:{httpd.server_port}"
        try:
            with urlopen(base + "/api/v1/specs") as response:
                result = json.load(response)
                self.assertEqual(len(result["items"]), 13)
                self.assertEqual(response.headers["Content-Type"], "application/json; charset=utf-8")
            with self.assertRaises(HTTPError) as result:
                urlopen(base + "/api/v1/news?limit=0")
            self.assertEqual(result.exception.code, 400)
            with self.assertRaises(HTTPError) as result:
                urlopen(base + "/missing")
            self.assertEqual(result.exception.code, 404)
        finally:
            httpd.shutdown()
            httpd.server_close()
            worker.join()


if __name__ == "__main__":
    unittest.main()
