from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from PIL import Image

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
WIKI_UA = "NarezchikStudio/1.0 (local faceless studio; contact=local)"


def _headers(kind: str = "browser") -> dict[str, str]:
    if kind == "wiki":
        return {"User-Agent": WIKI_UA}
    return {"User-Agent": BROWSER_UA}


def _is_junk_image_url(url: str) -> bool:
    lowered = url.lower()
    bad_bits = (
        "favicon",
        "sprite",
        "logo",
        "/icon",
        "icons/",
        "avatar",
        "placeholder",
        "1x1",
        "pixel",
        "gstatic.com",
        "google.com/images",
        "news.google.com",
        "googlenews",
        ".svg",
        "navalny",
        "nixon",
        "mordashov",
        "kobzev",
        "letter_of_resignation",
        "resignation_of_president",
    )
    return any(bit in lowered for bit in bad_bits)


def extract_image_url_from_html(raw: str, page_url: str) -> str | None:
    host = urlparse(page_url).netloc.lower()
    if "news.google.com" in host:
        return None
    patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:image["\']',
        r'<link[^>]+rel=["\']image_src["\'][^>]+href=["\']([^"\']+)["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, raw, flags=re.IGNORECASE)
        if not match:
            continue
        candidate = match.group(1).strip()
        if candidate.startswith("//"):
            candidate = "https:" + candidate
        elif candidate.startswith("/"):
            candidate = urljoin(page_url, candidate)
        if candidate.startswith("http") and not _is_junk_image_url(candidate):
            return candidate[:1000]
    return None


def search_wikimedia(query: str, limit: int = 6) -> list[str]:
    term = (query or "").strip()
    if not term:
        return []
    urls: list[str] = []
    try:
        response = requests.get(
            "https://commons.wikimedia.org/w/api.php",
            params={
                "action": "query",
                "format": "json",
                "generator": "search",
                "gsrsearch": term,
                "gsrlimit": str(max(1, min(limit, 10))),
                "gsrnamespace": "6",
                "prop": "imageinfo",
                "iiprop": "url|mime|size",
                "iiurlwidth": "1280",
            },
            headers=_headers("wiki"),
            timeout=12,
        )
        response.raise_for_status()
        payload = response.json()
        pages = (payload.get("query") or {}).get("pages") or {}
        for page in pages.values():
            info_list = page.get("imageinfo") or []
            if not info_list:
                continue
            info = info_list[0]
            mime = str(info.get("mime") or "image/jpeg")
            if mime and not mime.startswith("image/"):
                continue
            if "svg" in mime:
                continue
            url = str(info.get("thumburl") or info.get("url") or "").strip()
            if "?" in url:
                url = url.split("?", 1)[0]
            if url.startswith("http"):
                urls.append(url)
    except Exception:
        pass

    if len(urls) >= limit:
        return urls[:limit]

    try:
        response = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "format": "json",
                "generator": "search",
                "gsrsearch": term,
                "gsrlimit": str(max(1, min(limit, 10))),
                "prop": "pageimages",
                "piprop": "thumbnail",
                "pithumbsize": "1280",
            },
            headers=_headers("wiki"),
            timeout=12,
        )
        response.raise_for_status()
        payload = response.json()
        pages = (payload.get("query") or {}).get("pages") or {}
        for page in pages.values():
            thumb = page.get("thumbnail") or {}
            url = str(thumb.get("source") or "").strip()
            if "?" in url:
                url = url.split("?", 1)[0]
            if url.startswith("http") and ".svg" not in url.lower():
                urls.append(url)
    except Exception:
        pass
    return urls[:limit]


def search_openverse(query: str, limit: int = 6) -> list[str]:
    term = (query or "").strip()
    if not term:
        return []
    try:
        response = requests.get(
            "https://api.openverse.org/v1/images/",
            params={
                "q": term,
                "page_size": max(1, min(limit, 10)),
                "license_type": "commercial",
            },
            headers=_headers("wiki"),
            timeout=12,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return []
    urls: list[str] = []
    for item in payload.get("results") or []:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or item.get("thumbnail") or "").strip()
        if url.startswith("http"):
            urls.append(url)
    return urls[:limit]


def search_pexels(query: str, limit: int = 6) -> list[str]:
    key = (os.environ.get("PEXELS_API_KEY") or "").strip()
    if not key:
        return []
    term = (query or "").strip()
    if not term:
        return []
    try:
        response = requests.get(
            "https://api.pexels.com/v1/search",
            params={"query": term, "per_page": max(1, min(limit, 10)), "orientation": "portrait"},
            headers={**_headers("browser"), "Authorization": key},
            timeout=12,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return []

    urls: list[str] = []
    for photo in payload.get("photos") or []:
        src = photo.get("src") if isinstance(photo, dict) else None
        if not isinstance(src, dict):
            continue
        url = str(src.get("large2x") or src.get("large") or src.get("original") or "").strip()
        if url.startswith("http"):
            urls.append(url)
    return urls


def download_image(url: str, destination: Path) -> Path | None:
    if _is_junk_image_url(url):
        return None
    try:
        host = urlparse(url).netloc.lower()
        kind = "wiki" if "wikimedia.org" in host or "wikipedia.org" in host else "browser"
        response = requests.get(
            url,
            headers=_headers(kind),
            timeout=15,
            allow_redirects=True,
        )
        if not response.ok:
            return None
        final_url = str(response.url or url)
        if _is_junk_image_url(final_url):
            return None
        content_type = str(response.headers.get("Content-Type") or "").lower()
        data = response.content
        looks_image = (
            "image" in content_type
            or url.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
            or data[:3] == b"\xff\xd8\xff"
            or data[:8] == b"\x89PNG\r\n\x1a\n"
        )
        if not looks_image or len(data) < 20000:
            return None
        suffix = ".jpg"
        path = urlparse(url).path.lower()
        if path.endswith(".png") or "png" in content_type or data[:8] == b"\x89PNG\r\n\x1a\n":
            suffix = ".png"
        elif path.endswith(".webp") or "webp" in content_type:
            suffix = ".webp"
        destination = destination.with_suffix(suffix)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        try:
            with Image.open(destination) as opened:
                width, height = opened.size
            if width < 480 or height < 480:
                destination.unlink(missing_ok=True)
                return None
        except Exception:
            destination.unlink(missing_ok=True)
            return None
        return destination
    except Exception:
        return None


def _topic_queries(topic: str, beats: list[dict[str, Any]], language: str) -> list[str]:
    queries: list[str] = []
    clean = " ".join((topic or "").split()).strip()
    if clean:
        queries.append(clean)
    words = [part for part in re.split(r"[\s,.;:!?\-_/]+", clean) if len(part) >= 4]
    if words:
        queries.append(" ".join(words[:4]))
        queries.append(words[0])
    for beat in beats:
        text = str(beat.get("text") or "").strip()
        if text:
            queries.append(text.split(".")[0][:80])
    lowered = clean.lower()
    if language != "en":
        queries.extend([f"{clean} президент", f"{clean} парламент", f"{clean} правительство"])
    else:
        queries.extend([f"{clean} president", f"{clean} parliament government"])
    if "казах" in lowered or "kazakhstan" in lowered or "токаев" in lowered:
        queries = [
            "Kassym-Jomart Tokayev",
            "President of Kazakhstan Tokayev",
            "Kazakhstan parliament Astana",
            "Ministry of Defense Kazakhstan",
        ] + queries
    if "министр" in lowered or "minister" in lowered:
        queries.append("government minister meeting")
    if "оборон" in lowered or "defense" in lowered or "defence" in lowered:
        queries.append("military defense ministry")

    unique: list[str] = []
    seen: set[str] = set()
    for item in queries:
        key = item.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(item.strip())
    return unique[:8]


def collect_media_urls(
    topic: str,
    sources: list[dict[str, Any]],
    beats: list[dict[str, Any]],
    language: str = "ru",
) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()

    def add(url: str | None) -> None:
        value = (url or "").strip()
        if not value or value in seen or _is_junk_image_url(value):
            return
        seen.add(value)
        urls.append(value)

    for item in sources:
        add(str(item.get("imageUrl") or ""))

    for query in _topic_queries(topic, beats, language):
        if len(urls) >= 12:
            break
        for found in search_wikimedia(query, limit=5):
            add(found)
            if len(urls) >= 12:
                break
        if len(urls) >= 8:
            break
        for found in search_pexels(query, limit=4):
            add(found)
            if len(urls) >= 12:
                break

    if len(urls) < 4:
        for query in _topic_queries(topic, beats, language)[:3]:
            for found in search_openverse(query, limit=4):
                add(found)
                if len(urls) >= 8:
                    break

    return urls


def _relevance_score(url: str, topic: str) -> float:
    hay = url.lower()
    score = 0.0
    tokens = [
        part.lower()
        for part in re.split(r"[\s,.;:!?\-_/]+", topic or "")
        if len(part) >= 4
    ]
    bonus_map = {
        "казах": ("kazakhstan", "tokayev", "astana", "kazakh"),
        "kazakhstan": ("kazakhstan", "tokayev", "astana", "kazakh"),
        "токаев": ("tokayev",),
        "оборон": ("defense", "defence", "military", "ministry"),
        "министр": ("minister", "ministry", "government"),
        "президент": ("president", "tokayev"),
        "отставк": ("resignation", "resign"),
    }
    for token in tokens:
        if token in hay:
            score += 3.0
        for key, aliases in bonus_map.items():
            if key in token or token in key:
                for alias in aliases:
                    if alias in hay:
                        score += 4.0
    return score


def download_media_pack(
    urls: list[str],
    assets_dir: Path,
    max_files: int = 8,
    topic: str = "",
) -> list[Path]:
    assets_dir.mkdir(parents=True, exist_ok=True)
    ranked = sorted(
        [url for url in urls if not _is_junk_image_url(url)],
        key=lambda item: _relevance_score(item, topic),
        reverse=True,
    )
    strong = [url for url in ranked if _relevance_score(url, topic) >= 6.0]
    weak = [url for url in ranked if _relevance_score(url, topic) < 6.0]
    ordered = strong + weak
    saved: list[tuple[float, Path]] = []
    for index, url in enumerate(ordered):
        if len(saved) >= max_files:
            break
        if strong and _relevance_score(url, topic) < 6.0 and len(saved) >= min(3, len(strong)):
            break
        path = download_image(url, assets_dir / f"photo-{index:02d}")
        if path is not None:
            score = _relevance_score(url, topic) + (path.stat().st_size / 5_000_000)
            saved.append((score, path))
    if not saved:
        for index, url in enumerate(weak[:max_files]):
            path = download_image(url, assets_dir / f"fallback-{index:02d}")
            if path is not None:
                saved.append((_relevance_score(url, topic), path))
            if len(saved) >= max_files:
                break
    saved.sort(key=lambda item: item[0], reverse=True)
    return [path for _score, path in saved]
