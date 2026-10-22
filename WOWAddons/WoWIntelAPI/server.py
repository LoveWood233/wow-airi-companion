"""Local, dependency-free WoW guide and news API (Python 3.10+).

Upstream content is untrusted data. No scripts from source pages are executed.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import xml.etree.ElementTree as ET

BASE = "https://www.wowhead.com"
USER_AGENT = "WoWCompanionIntel/1.0"
MAX_BYTES = 4 * 1024 * 1024
CACHE_TTL = 600
MAX_STALE = 86400
CLASSES = {
    "warrior": ("战士", "arms fury protection"),
    "paladin": ("圣骑士", "holy protection retribution"),
    "hunter": ("猎人", "beast-mastery marksmanship survival"),
    "rogue": ("潜行者", "assassination outlaw subtlety"),
    "priest": ("牧师", "discipline holy shadow"),
    "death-knight": ("死亡骑士", "blood frost unholy"),
    "shaman": ("萨满祭司", "elemental enhancement restoration"),
    "mage": ("法师", "arcane fire frost"),
    "warlock": ("术士", "affliction demonology destruction"),
    "monk": ("武僧", "brewmaster mistweaver windwalker"),
    "druid": ("德鲁伊", "balance feral guardian restoration"),
    "demon-hunter": ("恶魔猎手", "havoc vengeance devourer"),
    "evoker": ("唤魔师", "devastation preservation augmentation"),
}
TOPICS = {"all", "overview", "gear", "talents", "rotation", "dungeon", "raid"}
NEWS_TERMS = {
    "gear": ("gear", "loot", "trinket", "equipment", "tier set", "weapon"),
    "talents": ("talent", "hero tree", "build"),
    "rotation": ("rotation", "cooldown", "class tuning", "class changes"),
    "dungeon": ("dungeon", "mythic", "delve", "affix"),
    "raid": ("raid", "boss", "encounter"),
    "overview": ("class", "guide", "specialization"),
}
TOPIC_ALIASES = {"装备": "gear", "天赋": "talents", "手法": "rotation", "副本": "dungeon", "团本": "raid", "全部": "all", "概览": "overview"}


class APIError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_date(value):
    """Never invent a timezone or substitute retrieval time for publication time."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            dt = parsedate_to_datetime(value)
        except (ValueError, TypeError, OverflowError):
            return None
    if dt.tzinfo is None:
        return None
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def allowed_url(url):
    try:
        parts = urlsplit(url)
        return (parts.scheme == "https" and parts.hostname == "www.wowhead.com"
                and parts.port in (None, 443) and not parts.username and not parts.password
                and not parts.query and not parts.fragment
                and bool(re.fullmatch(r"/(?:guide/|guides/|news(?:/|=))[A-Za-z0-9/_=.-]*", parts.path))
                and ".." not in parts.path)
    except ValueError:
        return False


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_url(newurl):
            raise APIError("上游重定向到允许范围以外的地址。", 502)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url):
    if not allowed_url(url):
        raise APIError("仅允许已配置来源的攻略与新闻地址。")
    try:
        request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html, application/rss+xml, application/xml"})
        with build_opener(SafeRedirect()).open(request, timeout=12) as response:
            raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise APIError("上游响应超出大小限制。", 502)
            return raw.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    except HTTPError as exc:
        raise APIError(f"来源返回 HTTP {exc.code}；未尝试绕过访问限制。", 502) from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise APIError("来源暂时无法连接或请求超时。", 502) from exc


class Cache:
    def __init__(self, fetch=download, clock=time.time):
        self.entries = {}
        self.lock = threading.Lock()
        self.fetch = fetch
        self.clock = clock

    def get(self, url, parser):
        # Serialize cache fills so simultaneous callers do not hammer the source.
        with self.lock:
            entry = self.entries.get(url)
            age = self.clock() - entry[0] if entry else None
            if entry and age < CACHE_TTL:
                return deepcopy(entry[1]), self.meta(entry, "hit")
            try:
                data = parser(self.fetch(url))
            except (APIError, ValueError, ET.ParseError) as exc:
                if entry and age < MAX_STALE:
                    meta = self.meta(entry, "stale")
                    meta["warning"] = str(exc)
                    return deepcopy(entry[1]), meta
                if isinstance(exc, APIError):
                    raise
                raise APIError("来源结构变化或数据无法解析。", 502) from exc
            entry = (self.clock(), data, now_iso())
            self.entries[url] = entry
            return deepcopy(data), self.meta(entry, "miss")

    def meta(self, entry, status):
        return {"cache": status, "stale": status == "stale", "fetched_at": entry[2],
                "cache_age_seconds": max(0, round(self.clock() - entry[0])), "ttl_seconds": CACHE_TTL}


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.ignored = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.ignored += 1
        elif tag in ("br", "p", "li", "div"):
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.ignored:
            self.ignored -= 1
        self.parts.append(" ")

    def handle_data(self, data):
        if not self.ignored:
            self.parts.append(data)


def plain(value):
    parser = TextParser()
    parser.feed(value or "")
    return re.sub(r"\s+", " ", "".join(parser.parts)).strip()


def brief(value, limit=400):
    text = plain(value)
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + "…"


def guide_topic(url):
    slug = urlsplit(url).path.rsplit("/", 1)[-1]
    if "bis-gear" in slug or "stat-priority" in slug or "enchants-gems" in slug:
        return "gear"
    if "talent-build" in slug:
        return "talents"
    if "rotation" in slug:
        return "rotation"
    if "overview-pve" in slug or slug == "basics":
        return "overview"
    return "other"


def parse_catalog(html):
    for match in re.finditer(r'new Listview\(\s*\{[^\n]*?"data"\s*:\s*', html):
        data, _ = json.JSONDecoder().raw_decode(html[match.end():])
        if not isinstance(data, list):
            continue
        rows = []
        for item in data:
            url = item.get("url", "")
            if not allowed_url(url) or not urlsplit(url).path.startswith("/guide/"):
                continue
            rows.append({"title": plain(item.get("title") or item.get("name", "")), "url": url,
                         "source": "Wowhead", "language": "en", "topic": guide_topic(url),
                         "author": item.get("author"), "published_at": normalize_date(item.get("when")),
                         "updated_at": normalize_date(item.get("lastEdit")),
                         "source_date_raw": {"published": item.get("when"), "updated": item.get("lastEdit")},
                         "source_patch_tag": item.get("patch"), "class_id": item.get("class"), "spec_id": item.get("spec"),
                         "compatibility": "unverified"})
        if rows:
            return rows
    raise APIError("来源未返回可识别的攻略目录；不会用预设链接伪装实时结果。", 502)


def parse_news(xml):
    root = ET.fromstring(xml)
    if root.tag != "rss" or root.find("channel") is None:
        raise APIError("来源未返回 RSS 新闻数据。", 502)
    items = []
    for item in root.findall("./channel/item"):
        categories = [node.text or "" for node in item.findall("category")]
        # Exclude PTR, Classic, Forever, beta and other game branches.
        if "Live" not in categories:
            continue
        url = item.findtext("link", "")
        if not allowed_url(url):
            continue
        items.append({"title": plain(item.findtext("title", "")), "url": url,
                      "source": "Wowhead", "language": "en", "game_branch": "retail-live",
                      "published_at": normalize_date(item.findtext("pubDate")), "updated_at": None,
                      "summary": brief(item.findtext("description", ""), 400), "categories": categories})
    return items


class ArticleParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ld = False
        self.ld_text = []
        self.schemas = []
        self.meta = {}
        self.body_depth = 0
        self.noscript = False
        self.heading = None
        self.sections = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta":
            self.meta[attrs.get("property") or attrs.get("name")] = attrs.get("content", "")
        if tag == "script" and attrs.get("type") == "application/ld+json":
            self.ld, self.ld_text = True, []
        if tag == "noscript":
            self.noscript = True
        if tag == "div":
            if attrs.get("id") == "guide-body":
                self.body_depth = 1
            elif self.body_depth:
                self.body_depth += 1
        if (self.body_depth or self.noscript) and tag in ("h2", "h3"):
            self.heading = []

    def handle_endtag(self, tag):
        if tag == "noscript":
            self.noscript = False
        if tag == "script" and self.ld:
            self.ld = False
            try:
                self.schemas.append(json.loads("".join(self.ld_text)))
            except ValueError:
                pass
        if tag == "div" and self.body_depth:
            self.body_depth -= 1
        if tag in ("h2", "h3") and self.heading is not None:
            title = re.sub(r"\s+", " ", "".join(self.heading)).strip()
            if title and title not in self.sections:
                self.sections.append(title[:200])
            self.heading = None

    def handle_data(self, data):
        if self.ld:
            self.ld_text.append(data)
        if self.heading is not None:
            self.heading.append(data)


def schema_article(node):
    if isinstance(node, dict):
        kinds = node.get("@type", [])
        if isinstance(kinds, str):
            kinds = [kinds]
        if any(kind in kinds for kind in ("Article", "NewsArticle", "TechArticle")):
            return node
        for value in node.values():
            found = schema_article(value)
            if found:
                return found
    elif isinstance(node, list):
        for value in node:
            found = schema_article(value)
            if found:
                return found
    return None


def parse_article(html):
    parser = ArticleParser()
    parser.feed(html)
    article = schema_article(parser.schemas)
    if not article or not (article.get("headline") or parser.meta.get("og:title")):
        raise APIError("页面不是可识别的攻略文章，可能需要登录或已改版。", 502)
    author = article.get("author")
    return {"title": plain(article.get("headline") or parser.meta["og:title"]),
            "summary": brief(article.get("description") or parser.meta.get("description", ""), 500),
            "author": author.get("name") if isinstance(author, dict) else author,
            "published_at": normalize_date(article.get("datePublished")),
            "updated_at": normalize_date(article.get("dateModified")),
            "sections": parser.sections[:40], "content_mode": "metadata_and_section_index",
            "language": "en", "source": "Wowhead", "compatibility": "unverified"}


def choose(params, name, default=""):
    values = params.get(name, [default])
    if len(values) != 1 or len(values[0]) > 500:
        raise APIError(f"参数 {name} 无效。")
    return values[0].strip()


def bounded_int(params, name, default, low, high):
    try:
        value = int(choose(params, name, str(default)))
    except ValueError as exc:
        raise APIError(f"{name} 必须为整数。") from exc
    if not low <= value <= high:
        raise APIError(f"{name} 必须介于 {low} 和 {high}。")
    return value


def topic_param(params):
    topic = choose(params, "topic", "all").lower()
    topic = TOPIC_ALIASES.get(topic, topic)
    if topic not in TOPICS:
        raise APIError("topic 支持 all、overview、gear、talents、rotation、dungeon、raid。")
    return topic


def sort_latest(items):
    return sorted(items, key=lambda item: item.get("updated_at") or item.get("published_at") or "", reverse=True)


class IntelService:
    def __init__(self, cache=None):
        self.cache = cache or Cache()

    def dispatch(self, path, params):
        if path == "/health":
            return {"status": "ok", "service": "WoWIntelAPI", "version": "1.0.0", "upstream_checked": False}
        if path == "/api/v1/specs":
            return {"items": [{"class": key, "name_zh": value[0], "specs": value[1].split()} for key, value in CLASSES.items()]}
        if path == "/api/v1/sources":
            return {"items": [{"name": "Wowhead", "base_url": BASE, "language": "en", "official_blizzard": False,
                                "capabilities": ["retail_news", "class_guides", "dungeon_guides", "raid_guides"]}],
                    "cache_ttl_seconds": CACHE_TTL, "stale_fallback_max_seconds": MAX_STALE,
                    "notice": "攻略为第三方编辑内容；来源版本标签不保证适用于当前角色、赛季或国服。"}
        if path == "/api/v1/news":
            return self.news(params)
        if path == "/api/v1/guides":
            return self.guides(params)
        if path == "/api/v1/guide":
            url = choose(params, "url")
            if not allowed_url(url) or not urlsplit(url).path.startswith("/guide/"):
                raise APIError("url 必须是 www.wowhead.com/guide/ 下的 HTTPS 攻略地址，不能附带查询参数。")
            item, meta = self.cache.get(url, parse_article)
            item["url"] = url
            return {"item": item, "source_status": meta,
                    "notice": "返回原文简介与章节索引。完整配装、天赋导入码和条件化手法请打开原文；本接口不执行页面脚本或生成 AI 建议。"}
        raise APIError("接口不存在；访问 / 查看用法。", 404)

    def news(self, params):
        topic = topic_param(params)
        limit = bounded_int(params, "limit", 10, 1, 50)
        days = bounded_int(params, "days", 30, 1, 365)
        query = choose(params, "q").casefold()
        items, meta = self.cache.get(BASE + "/news/rss/all", parse_news)
        cutoff = time.time() - days * 86400
        result = []
        for item in items:
            stamp = item["published_at"]
            if not stamp or datetime.fromisoformat(stamp).timestamp() < cutoff:
                continue
            text = (item["title"] + " " + item["summary"]).casefold()
            if query and query not in text:
                continue
            if topic != "all" and not any(term in text for term in NEWS_TERMS[topic]):
                continue
            result.append(item)
        return {"items": sort_latest(result)[:limit], "total_matches": len(result), "source_status": meta,
                "notice": "最新指 RSS 当前窗口内、符合筛选条件的正式服资讯；不是完整历史库。topic 为关键词分类，q 匹配英文原文。"}

    def guides(self, params):
        topic = topic_param(params)
        limit = bounded_int(params, "limit", 10, 1, 50)
        query = choose(params, "q").casefold()
        class_name = choose(params, "class").lower()
        spec = choose(params, "spec").lower()
        for key, value in CLASSES.items():
            if class_name == value[0]:
                class_name = key
        if topic in ("dungeon", "raid"):
            if class_name or spec:
                raise APIError("副本/团本目录不接受 class 或 spec；请使用 q 筛选副本英文名称。")
            urls = [BASE + "/guides/" + ("dungeons" if topic == "dungeon" else "raids")]
        else:
            if class_name not in CLASSES or spec not in CLASSES[class_name][1].split():
                raise APIError("职业攻略需要有效的 class 和 spec；可通过 /api/v1/specs 查询。")
            urls = [BASE + f"/guides/classes/{class_name}/{spec}"]
        items, meta = self.cache.get(urls[0], parse_catalog)
        patch = choose(params, "patch")
        if patch and not re.fullmatch(r"\d{5,6}", patch):
            raise APIError("patch 使用来源数字版本标签，例如 120105。")
        result = []
        for item in items:
            if topic not in ("all", "dungeon", "raid") and item["topic"] != topic:
                continue
            if topic in ("dungeon", "raid"):
                item["topic"] = topic
            if query and query not in (item["title"] + " " + item["url"]).casefold():
                continue
            if patch and str(item["source_patch_tag"]) != patch:
                continue
            result.append(item)
        return {"items": sort_latest(result)[:limit], "total_matches": len(result), "source_status": meta,
                "notice": "按来源文章更新时间排序；目录可能含旧资料片或旧赛季。source_patch_tag 只是站点标签，不能证明内容已针对该版本修订，请核对标题、更新时间与原文。"}


DOC = """<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WoW 攻略情报 API</title><style>body{max-width:900px;margin:50px auto;padding:0 24px;font:16px/1.9 system-ui;color:#233047;background:#f5f7fb}a{color:#3656ad}code{background:#e5eaf3;padding:3px 6px;border-radius:4px}li{margin:14px 0}small{color:#596a82}</style>
<h1>WoW 攻略情报 API</h1><p>运行于游戏外部的本地 HTTP 服务。实时读取 Wowhead 正式服新闻和攻略目录，缓存 10 分钟。</p>
<ul><li><a href="/api/v1/news?limit=10">最新正式服资讯</a></li>
<li><a href="/api/v1/guides?topic=dungeon&amp;limit=10">副本攻略</a> · <a href="/api/v1/guides?topic=raid&amp;limit=10">团本攻略</a></li>
<li><a href="/api/v1/guides?class=mage&amp;spec=frost&amp;topic=gear">冰法装备推荐</a></li>
<li><a href="/api/v1/guides?class=mage&amp;spec=frost&amp;topic=talents">冰法天赋推荐</a></li>
<li><a href="/api/v1/guides?class=mage&amp;spec=frost&amp;topic=rotation">冰法输出手法</a></li>
<li><a href="/api/v1/guide?url=https%3A%2F%2Fwww.wowhead.com%2Fguide%2Fclasses%2Fmage%2Ffrost%2Fbis-gear">查看攻略简介、作者、日期及章节索引</a></li>
<li><a href="/api/v1/specs">支持的职业/专精参数</a> · <a href="/api/v1/sources">数据源说明</a> · <a href="/health">服务健康状态</a></li></ul>
<p><code>/api/v1/guides</code> 支持 topic、class、spec、q、patch、limit；<code>/api/v1/news</code> 支持 topic、q、days、limit。</p>
<p>topic：all / overview / gear / talents / rotation / dungeon / raid；也支持“装备、天赋、手法、副本、团本”等中文分类。q 匹配来源英文标题，不自动翻译。</p>
<p>每次响应包含 request_at；source_status 提供 fetched_at、cache、stale。文章的 published_at / updated_at 独立返回，缺失即为 null。</p>
<small>返回来源元数据、简介和阅读入口，不复制整篇攻略，不生成个性化配装或 AI 建议。国际服英文资料需核对国服更新进度。完整接口说明见项目 README.md。</small></html>"""


def make_handler(service):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if len(self.path) > 4096:
                self.send_json({"error": "请求地址过长。"}, 414)
                return
            parsed = urlsplit(self.path)
            if parsed.path == "/":
                body = DOC.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(body)
                return
            try:
                params = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=20)
                result = service.dispatch(parsed.path, params)
                self.send_json({"request_at": now_iso(), **result})
            except APIError as exc:
                self.send_json({"request_at": now_iso(), "error": str(exc)}, exc.status)
            except ValueError:
                self.send_json({"error": "查询参数无效。"}, 400)
            except Exception:
                self.send_json({"error": "内部处理失败；请检查来源结构或联系维护者。"}, 500)

        def send_json(self, value, status=200):
            body = json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(IntelService()))
    print(f"WoWIntelAPI: http://127.0.0.1:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
