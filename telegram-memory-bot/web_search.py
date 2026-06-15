"""Web search via DuckDuckGo — free, no API key needed."""

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

DDGS_API = "https://html.duckduckgo.com/html/"
DDGS_LITE_API = "https://lite.duckduckgo.com/lite/"


async def search(query: str, max_results: int = 5) -> list[dict]:
    """Search DuckDuckGo and return results.

    Returns list of dicts with 'title', 'url', 'snippet' keys.
    """
    results = []

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.post(
                DDGS_API,
                data={"q": query, "b": ""},
                headers={
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )

            if resp.status_code != 200:
                logger.error(f"DDG search failed: {resp.status_code}")
                return results

            # Parse HTML results
            from html.parser import HTMLParser

            class DDGParser(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.results = []
                    self.current = {}
                    self.in_result = False
                    self.in_title = False
                    self.in_snippet = False
                    self.capture = False
                    self.capture_text = ""

                def handle_starttag(self, tag, attrs):
                    attrs_dict = dict(attrs)
                    cls = attrs_dict.get("class", "")

                    if "result" in cls and "results" not in cls:
                        self.in_result = True
                        self.current = {}

                    if self.in_result:
                        if tag == "a" and "result__a" in cls:
                            self.in_title = True
                            self.current["url"] = attrs_dict.get("href", "")
                            self.capture = True
                            self.capture_text = ""
                        elif tag == "a" and "result__snippet" in cls:
                            self.in_snippet = True
                            self.capture = True
                            self.capture_text = ""

                def handle_endtag(self, tag):
                    if self.in_title and tag == "a":
                        self.current["title"] = self.capture_text.strip()
                        self.in_title = False
                        self.capture = False
                    elif self.in_snippet and tag == "a":
                        self.current["snippet"] = self.capture_text.strip()
                        self.in_snippet = False
                        self.capture = False
                        if self.current.get("title") and self.current.get("snippet"):
                            self.results.append(dict(self.current))
                        self.in_result = False

                def handle_data(self, data):
                    if self.capture:
                        self.capture_text += data

            parser = DDGParser()
            parser.feed(resp.text)
            results = parser.results[:max_results]

    except Exception as e:
        logger.error(f"Search error: {e}")

    return results


async def search_and_summarize(query: str, llm_client) -> str:
    """Search the web and return a formatted summary."""
    from llm_client import LLMClient

    results = await search(query)

    if not results:
        return "🔍 Ничего не найдено. Попробуй другой запрос."

    # Format results
    text = f"🔍 Результаты по запросу «{query}»:\n\n"
    for i, r in enumerate(results, 1):
        title = r.get("title", "Без названия")
        snippet = r.get("snippet", "")
        url = r.get("url", "")
        text += f"{i}. {title}\n"
        if snippet:
            text += f"   {snippet}\n"
        if url:
            text += f"   🔗 {url}\n"
        text += "\n"

    return text
