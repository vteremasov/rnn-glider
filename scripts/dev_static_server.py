#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


REPO_ROOT = Path(__file__).resolve().parent.parent


class StaticOnlyHandler(BaseHTTPRequestHandler):
    server_version = "StaticOnlyDev/1.0"

    def do_GET(self) -> None:
        self._serve()

    def do_HEAD(self) -> None:
        self._serve(send_body=False)

    def do_POST(self) -> None:
        self._reject_method()

    def do_PUT(self) -> None:
        self._reject_method()

    def do_DELETE(self) -> None:
        self._reject_method()

    def do_PATCH(self) -> None:
        self._reject_method()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Allow", "GET, HEAD")
        self.end_headers()

    def _reject_method(self) -> None:
      self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
      self.send_header("Allow", "GET, HEAD")
      self.end_headers()

    def _serve(self, send_body: bool = True) -> None:
        target = self._resolve_path()
        if target is None:
            self._send_text(HTTPStatus.FORBIDDEN, "Forbidden\n", send_body)
            return

        if target.is_dir():
            index_file = target / "index.html"
            if index_file.is_file():
                target = index_file
            else:
                self._send_text(HTTPStatus.NOT_FOUND, "Not found\n", send_body)
                return

        if not target.is_file():
            self._send_text(HTTPStatus.NOT_FOUND, "Not found\n", send_body)
            return

        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        stat = target.stat()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(stat.st_size))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()

        if not send_body:
            return

        with target.open("rb") as handle:
            self.wfile.write(handle.read())

    def _resolve_path(self) -> Path | None:
        raw_path = urlsplit(self.path).path
        safe_path = unquote(raw_path)
        stripped = safe_path.lstrip("/")
        candidate = (REPO_ROOT / stripped).resolve()

        try:
            candidate.relative_to(REPO_ROOT)
        except ValueError:
            return None

        return candidate

    def _send_text(self, status: HTTPStatus, body: str, send_body: bool) -> None:
      payload = body.encode("utf-8")
      self.send_response(status)
      self.send_header("Content-Type", "text/plain; charset=utf-8")
      self.send_header("Content-Length", str(len(payload)))
      self.send_header("Cache-Control", "no-store")
      self.end_headers()
      if send_body:
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:
      message = format % args
      print(f"{self.address_string()} - {html.escape(message)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Static-only dev server for the repo root.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=6969)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), StaticOnlyHandler)
    print(f"Serving {REPO_ROOT} on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
