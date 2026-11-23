"""URL hygiene for pages the founder asks agents to read."""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Ad-click and campaign parameters carry no content and identify the click; drop them.
TRACKING = {"gclid", "gbraid", "wbraid", "fbclid", "msclkid", "adid", "campaignid", "matchtype", "network", "term", "spm", "dclid"}
TRACKING_PREFIXES = ("utm_", "gad_", "_hs", "mc_")


def clean_url(url: str) -> str | None:
    url = url.strip().strip('"\'')
    parts = urlsplit(url if "://" in url else f"https://{url}")
    host = parts.hostname or ""
    if parts.scheme not in ("http", "https") or "." not in host or " " in url or not all(c.isalnum() or c in ".-" for c in host):
        return None
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=False)
             if k.lower() not in TRACKING and not k.lower().startswith(TRACKING_PREFIXES)]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))


def clean_urls(urls: list[str]) -> list[str]:
    out: list[str] = []
    for u in urls:
        c = clean_url(u) if u and u.strip() else None
        if c and c not in out:
            out.append(c)
    return out[:8]
