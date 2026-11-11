"""Build a bounded news-candidate index from locally collected public articles.

The export includes titles, URLs, publication dates and up to 24 weighted terms.
Original bodies, excerpts, labels and model outputs stay in the local corpus.
Usage approval status is retained. This operation grants no new usage rights.
"""
import argparse
import hashlib
import json
import math
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TOKENS = re.compile(r"[가-힣A-Za-z0-9]{2,30}")
STOP_WORDS = set("그리고 그러나 하지만 또는 대한 대해 위해 통해 관련 이번 지난 올해 기자 기사 뉴스 보도 따르면 밝혔다 말했다 한다 있다 있는 것으로 것이다 이다 입니다 합니다 등의 것을 같이 부터 까지 정책 정부 국민 우리 위해서 대한 것에 대해 the and for with from this that have has was were are not into more will said news http https www com org kr".split())
TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|CMPT_CD$|SRS_CD$|BLCK_NO$|PAGE_CD$)", re.I)
CONTACT = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:01[016789]|02|0[3-6][1-5])[- .]?\d{3,4}[- .]?\d{4}")


def terms(text):
    return [token.lower() for token in TOKENS.findall(text) if token.lower() not in STOP_WORDS and not token.isdigit()]


def normalize_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        return None
    try:
        url = urlsplit(value)
        host = (url.hostname or "").lower()
        if (url.scheme != "https" or url.username or url.password or url.port
                or not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}", host)
                or host.endswith((".local", ".localhost", ".internal"))):
            return None
        query = [(key, val) for key, val in parse_qsl(url.query, keep_blank_values=True) if not TRACKING.search(key)]
        if any(key.lower() in {"token", "access_token", "api_key", "signature"} for key, _ in query):
            return None
        return urlunsplit(("https", host, url.path, urlencode(query), ""))
    except ValueError:
        return None


def build_index(rows, now):
    candidates = []
    seen_urls, seen_bodies = set(), set()
    excluded = Counter()
    for row in rows:
        url = normalize_url(row.get("url"))
        title = row.get("title")
        body = row.get("text")
        if not url or not isinstance(title, str) or not title.strip() or not isinstance(body, str):
            excluded["invalid_metadata"] += 1
            continue
        if CONTACT.search(title):
            excluded["contact_in_title"] += 1
            continue
        try:
            published = datetime.fromisoformat(row["publishedAt"].replace("Z", "+00:00"))
            if published.tzinfo is None or published > now:
                raise ValueError("unknown or future publication time")
        except (KeyError, TypeError, ValueError):
            excluded["invalid_publication_time"] += 1
            continue
        body_hash = hashlib.sha256(" ".join(body.split()).encode()).hexdigest()
        if url in seen_urls or body_hash in seen_bodies:
            excluded["duplicate"] += 1
            continue
        seen_urls.add(url)
        seen_bodies.add(body_hash)
        title_terms = terms(title)
        counts = Counter(terms(body))
        candidates.append((row, url, title.strip()[:250], title_terms, counts))
    document_frequencies = Counter()
    for _, _, _, title_terms, counts in candidates:
        document_frequencies.update(set(title_terms) | set(counts))
    articles = []
    for row, url, title, title_terms, counts in candidates:
        title_set = set(title_terms)
        scores = {term: round((1 + math.log1p(count)) * (1 + math.log((len(candidates) + 1) / (document_frequencies[term] + 1))) + (8 if term in title_set else 0), 3)
                  for term, count in (counts | Counter(title_terms)).items()}
        ordered = sorted(scores, key=lambda term: (-scores[term], term))[:24]
        articles.append({
            "id": "indexed_" + hashlib.sha256(url.encode()).hexdigest()[:20],
            "title": title,
            "url": url,
            "publisherDomain": urlsplit(url).hostname.removeprefix("www."),
            "publishedAt": row["publishedAt"],
            "usageStatus": "approved" if row.get("usage", {}).get("status") == "approved" else "unapproved",
            "keywords": [[term, scores[term]] for term in ordered],
        })
    return {
        "schemaVersion": "article-search-index-1.0",
        "generatedAt": now.isoformat(),
        "sourceArticleCount": len(rows),
        "indexedArticleCount": len(articles),
        "exclusions": dict(excluded),
        "scopeNote": "수집 기사 메타데이터의 검색 후보입니다. 원문·인용·입장 검증과 이용 승인 상태는 별도로 확인합니다.",
        "articles": articles,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.input.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    result = build_index(rows, datetime.now(timezone.utc))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key != "articles"}, ensure_ascii=True))


if __name__ == "__main__":
    main()
