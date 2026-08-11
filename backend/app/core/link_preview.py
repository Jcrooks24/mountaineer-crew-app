"""
Fetch a shared URL's OpenGraph preview (title / image / description) for a
Bulletin link post, so the feed can show a thumbnail card instead of a bare URL.

Deliberately small and defensive: it runs a server-side fetch of a crew-supplied
URL, so it is bounded (short timeout, capped read) and refuses obviously-internal
hosts to blunt SSRF. Any failure returns an empty preview - a link post still
works, it just shows the raw URL.
"""
import html as html_lib
import ipaddress
import json
import re
import socket
import urllib.request
from typing import Optional
from urllib.parse import parse_qs, quote, urlparse, urljoin

_TIMEOUT_S = 5
_MAX_BYTES = 262_144  # 256 KB is plenty for <head> og tags
_UA = "MountaineerBulletin/1.0 (+link-preview)"


def _is_public_host(host: str) -> bool:
    if not host:
        return False
    if host.lower() in ("localhost",):
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return False
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False
    return True


def _meta(html: str, prop: str) -> Optional[str]:
    # <meta property="og:title" content="..."> in either attribute order.
    for pat in (
        rf'<meta[^>]+property=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']*)["\']',
        rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']{re.escape(prop)}["\']',
        rf'<meta[^>]+name=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']*)["\']',
    ):
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def _youtube_id(parsed) -> Optional[str]:
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host in ("youtube.com", "m.youtube.com"):
        if parsed.path == "/watch":
            return (parse_qs(parsed.query).get("v") or [None])[0]
        for prefix in ("/shorts/", "/embed/", "/live/"):
            if parsed.path.startswith(prefix):
                return parsed.path[len(prefix):].split("/")[0] or None
    if host == "youtu.be":
        return parsed.path.lstrip("/").split("/")[0] or None
    return None


def _youtube_preview(url: str, vid: str) -> dict:
    # YouTube walls its OG tags behind a consent/JS page for non-browser fetches,
    # so build the thumbnail from the video id (always public) and get the title
    # from the public oEmbed JSON API.
    out = {"title": None, "description": None, "image": f"https://img.youtube.com/vi/{vid}/hqdefault.jpg"}
    try:
        oembed = "https://www.youtube.com/oembed?format=json&url=" + quote(url, safe="")
        req = urllib.request.Request(oembed, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as r:
            data = json.loads(r.read(65536).decode("utf-8", "replace"))
        out["title"] = data.get("title")
        if data.get("thumbnail_url"):
            out["image"] = data["thumbnail_url"]
    except Exception:
        pass
    out["title"] = out["title"] or "YouTube video"
    return out


def fetch_link_preview(url: str) -> dict:
    """Return {title, description, image} for a URL. All keys may be None/empty.
    Never raises - a failed fetch just yields an empty preview."""
    out = {"title": None, "description": None, "image": None}
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return out
        vid = _youtube_id(parsed)
        if vid:
            return _youtube_preview(url, vid)
        if not _is_public_host(parsed.hostname or ""):
            return out

        req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "text/html,*/*"})
        # No custom opener = follow redirects via the default handler; the host
        # guard above only checks the initial host, which is an accepted limit
        # for a low-stakes crew tool.
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            ctype = (resp.headers.get("Content-Type") or "").lower()
            if "html" not in ctype and "xml" not in ctype and ctype:
                # e.g. a direct image link: use it as the image itself.
                if ctype.startswith("image/"):
                    out["image"] = url
                return out
            raw = resp.read(_MAX_BYTES)
        html = raw.decode("utf-8", errors="replace")

        title = _meta(html, "og:title") or _meta(html, "twitter:title")
        if not title:
            m = re.search(r"<title[^>]*>([^<]*)</title>", html, re.IGNORECASE)
            title = m.group(1).strip() if m else None
        image = (
            _meta(html, "og:image")
            or _meta(html, "og:image:url")
            or _meta(html, "twitter:image")
            or _meta(html, "twitter:image:src")
        )
        if not image:
            m = re.search(r'<link[^>]+rel=["\']image_src["\'][^>]+href=["\']([^"\']+)["\']', html, re.IGNORECASE)
            image = m.group(1).strip() if m else None
        desc = _meta(html, "og:description") or _meta(html, "description") or _meta(html, "twitter:description")

        if image:
            image = urljoin(url, html_lib.unescape(image))  # resolve + decode entities in a relative og:image
        # unescape HTML entities (&amp; &#39; etc.) so the card reads cleanly.
        out["title"] = (html_lib.unescape(title) if title else "")[:300] or None
        out["description"] = (html_lib.unescape(desc) if desc else "")[:500] or None
        out["image"] = image
    except Exception:
        pass
    return out
