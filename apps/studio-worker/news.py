from __future__ import annotations

import html
import re
from typing import Any
from urllib.parse import quote_plus, urlparse

import feedparser
import requests

from media_fetch import extract_image_url_from_html

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 NarezchikStudio/1.0"
)


def _clean_text(value: str) -> str:
    text = html.unescape(value or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _source_name(entry: dict[str, Any], link: str) -> str:
    source = entry.get("source")
    if isinstance(source, dict) and source.get("title"):
        return _clean_text(str(source.get("title")))[:120]
    host = urlparse(link).netloc.replace("www.", "")
    return host or "СМИ"


def _google_news_url(topic: str, language: str) -> str:
    query = quote_plus(topic.strip())
    if language == "en":
        return (
            f"https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"
        )
    return f"https://news.google.com/rss/search?q={query}&hl=ru&gl=RU&ceid=RU:ru"


def search_news(topic: str, language: str = "ru", limit: int = 8) -> list[dict[str, Any]]:
    url = _google_news_url(topic, language)
    try:
        response = requests.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=12,
        )
        response.raise_for_status()
        feed = feedparser.parse(response.content)
    except Exception:
        return []

    results: list[dict[str, Any]] = []
    for entry in feed.entries[: max(1, limit)]:
        title = _clean_text(str(entry.get("title") or ""))
        link = str(entry.get("link") or "").strip()
        if not title or not link:
            continue
        published = None
        if entry.get("published"):
            published = str(entry.get("published"))
        elif entry.get("updated"):
            published = str(entry.get("updated"))
        summary = _clean_text(str(entry.get("summary") or entry.get("description") or ""))
        results.append(
            {
                "title": title[:300],
                "url": link[:1000],
                "source": _source_name(entry, link),
                "publishedAt": published,
                "snippet": summary[:800],
                "imageUrl": None,
            }
        )
    return results


def _extract_snippet_from_html(raw: str) -> str:
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", raw)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = _clean_text(text)
    if len(text) < 80:
        return ""
    return text[:1500]


def enrich_sources(sources: list[dict[str, Any]], max_fetch: int = 3) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    fetched = 0
    for item in sources:
        next_item = dict(item)
        snippet = str(next_item.get("snippet") or "").strip()
        image_url = str(next_item.get("imageUrl") or "").strip() or None
        if fetched < max_fetch:
            try:
                page_url = str(next_item.get("url") or "")
                response = requests.get(
                    page_url,
                    headers={"User-Agent": USER_AGENT},
                    timeout=8,
                    allow_redirects=True,
                )
                if response.ok and response.text:
                    final_page = str(response.url or page_url)
                    page_snippet = _extract_snippet_from_html(response.text)
                    if len(page_snippet) > len(snippet):
                        snippet = page_snippet
                    if not image_url:
                        image_url = extract_image_url_from_html(
                            response.text,
                            final_page,
                        )
                    fetched += 1
            except Exception:
                pass
        next_item["snippet"] = snippet[:1500]
        next_item["imageUrl"] = image_url
        enriched.append(next_item)
    return enriched


def research_topic(topic: str, language: str = "ru") -> list[dict[str, Any]]:
    found = search_news(topic, language=language, limit=8)
    if not found:
        return []
    return enrich_sources(found, max_fetch=3)


def sources_brief(sources: list[dict[str, Any]], limit: int = 6) -> str:
    lines: list[str] = []
    for index, item in enumerate(sources[:limit], start=1):
        title = str(item.get("title") or "").strip()
        source = str(item.get("source") or "СМИ").strip()
        snippet = str(item.get("snippet") or "").strip()
        published = str(item.get("publishedAt") or "").strip()
        url = str(item.get("url") or "").strip()
        lines.append(
            f"{index}. [{source}] {title}\n"
            f"Дата: {published or 'н/д'}\n"
            f"URL: {url}\n"
            f"Фрагмент: {snippet[:700]}"
        )
    return "\n\n".join(lines)
