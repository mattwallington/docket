"""docket HTTP server — serves the viewer SPA and dashboard markdown via a JSON API."""

from __future__ import annotations

import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DASHBOARDS_DIR = Path(os.environ.get("DOCKET_DASHBOARDS_DIR", "/data/dashboards"))
WEB_DIR = Path(os.environ.get("DOCKET_WEB_DIR", str(Path(__file__).parent.parent / "web")))
HOST = os.environ.get("DOCKET_HOST", "0.0.0.0")
PORT = int(os.environ.get("DOCKET_PORT", "8080"))

FRONTMATTER_DELIM = re.compile(r"^---\s*$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
TEST_RE = re.compile(r"^-\s+\[( |x)\]\s+\*\*([^*]+)\*\*(.*)$")


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    lines = text.splitlines()
    if not lines or not FRONTMATTER_DELIM.match(lines[0]):
        return {}, text
    meta: dict[str, str] = {}
    end = None
    for i, line in enumerate(lines[1:], start=1):
        if FRONTMATTER_DELIM.match(line):
            end = i
            break
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    if end is None:
        return {}, text
    return meta, "\n".join(lines[end + 1 :])


def count_tasks(body: str) -> dict[str, int]:
    """Quick pass for sidebar stats — full parsing happens client-side."""
    total = done = blocked = 0
    section = None
    for raw in body.splitlines():
        line = raw.rstrip()
        m = HEADING_RE.match(line)
        if m:
            depth = len(m.group(1))
            if depth >= 3:
                section = m.group(2).strip()
            elif depth == 2:
                section = None
            continue
        m = TEST_RE.match(line)
        if m:
            total += 1
            status = m.group(1)
            rest = m.group(3).strip().lower()
            if status == "x":
                done += 1
            else:
                if (
                    "blocked" in rest
                    or "e2e pending" in rest
                    or (section and "blocked" in section.lower())
                ):
                    blocked += 1
    pending = total - done - blocked
    return {"done": done, "pending": pending, "blocked": blocked, "total": total}


def list_dashboards() -> list[dict]:
    if not DASHBOARDS_DIR.exists():
        return []
    out: list[dict] = []
    for md in sorted(DASHBOARDS_DIR.glob("*.md")):
        text = md.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(text)
        stats = count_tasks(body)
        out.append(
            {
                "slug": md.stem,
                "name": meta.get("name") or md.stem,
                "description": meta.get("description", ""),
                "project": meta.get("project", ""),
                "status": meta.get("status", "active"),
                "stats": stats,
            }
        )
    return out


def load_dashboard(slug: str) -> str | None:
    safe = re.sub(r"[^a-zA-Z0-9_\-.]", "", slug)
    if safe != slug or not safe:
        return None
    path = DASHBOARDS_DIR / f"{safe}.md"
    if not path.is_file():
        return None
    try:
        path.relative_to(DASHBOARDS_DIR.resolve())
    except ValueError:
        return None
    return path.read_text(encoding="utf-8")


class DocketHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write(f"[docket] {self.address_string()} - {fmt % args}\n")

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, text, content_type="text/plain; charset=utf-8", status=200):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str):
        if not path.is_file():
            self.send_error(404)
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/" or path == "/index.html":
            self._send_file(WEB_DIR / "index.html", "text/html; charset=utf-8")
            return
        if path == "/app.js":
            self._send_file(WEB_DIR / "app.js", "application/javascript; charset=utf-8")
            return
        if path == "/styles.css":
            self._send_file(WEB_DIR / "styles.css", "text/css; charset=utf-8")
            return
        if path == "/api/dashboards":
            self._send_json(list_dashboards())
            return

        m = re.fullmatch(r"/api/dashboards/([a-zA-Z0-9_\-.]+)", path)
        if m:
            content = load_dashboard(m.group(1))
            if content is None:
                self.send_error(404)
                return
            self._send_text(content, "text/markdown; charset=utf-8")
            return

        self.send_error(404)


def main():
    sys.stderr.write(
        f"[docket] serving {DASHBOARDS_DIR} on {HOST}:{PORT} "
        f"(web: {WEB_DIR})\n"
    )
    server = ThreadingHTTPServer((HOST, PORT), DocketHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("[docket] shutting down\n")
        server.server_close()


if __name__ == "__main__":
    main()
