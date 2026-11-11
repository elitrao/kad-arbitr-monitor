"""Локальный HTTP-сервис над parser_kad.

Запускается на Windows рядом с Chrome и не требует платного Parser API.
"""

import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parents[2]
PARSER_ROOT = ROOT / "services" / "parser_kad"
sys.path.insert(0, str(PARSER_ROOT))

import requests  # noqa: E402
from src.api.documents_api import extract_documents_data, get_case_documents_page, read_cookies  # noqa: E402
from src.browser.case_searcher import CaseSearcher  # noqa: E402

HOST = "127.0.0.1"
PORT = 4176
CACHE_TTL_SECONDS = 15 * 60
cache: dict[str, dict] = {}
search_lock = threading.Lock()


def get_documents(case_number: str, refresh: bool = False) -> dict:
    now = time.time()
    cached = cache.get(case_number)
    if cached and not refresh and now - cached["cached_at"] < CACHE_TTL_SECONDS:
        return {**cached, "from_cache": True}

    # Один браузерный поиск за раз: parser_kad использует фиксированный CDP-порт.
    with search_lock:
        case_id = CaseSearcher().get_case_id(case_number)
        if not case_id:
            raise LookupError("Дело не найдено в КАД")
        documents = extract_documents_data(get_case_documents_page(case_id))

    result = {
        "case_number": case_number,
        "case_id": case_id,
        "documents": documents,
        "cached_at": now,
        "from_cache": False,
    }
    cache[case_number] = result
    return result


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print("[kad-service]", fmt % args)

    def send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            return self.send_json({"status": "ok", "service": "kad-http", "cache_size": len(cache)})

        if parsed.path.startswith("/cases/") and parsed.path.endswith("/documents"):
            encoded = parsed.path[len("/cases/"):-len("/documents")].strip("/")
            case_number = unquote(encoded).strip()
            if not case_number:
                return self.send_json({"error": "Укажите номер дела"}, 400)
            refresh = parse_qs(parsed.query).get("refresh", ["0"])[0] == "1"
            try:
                return self.send_json(get_documents(case_number, refresh))
            except LookupError as error:
                return self.send_json({"error": str(error)}, 404)
            except Exception as error:
                return self.send_json({"error": f"Ошибка получения данных КАД: {error}"}, 502)

        if parsed.path == "/documents/download":
            source_url = parse_qs(parsed.query).get("url", [""])[0]
            allowed = source_url.startswith("https://kad.arbitr.ru/Document/Pdf/")
            if not allowed:
                return self.send_json({"error": "Разрешены только PDF-ссылки kad.arbitr.ru"}, 400)
            try:
                response = requests.get(source_url, cookies=read_cookies(), timeout=60)
                response.raise_for_status()
                self.send_response(200)
                self.send_header("Content-Type", "application/pdf")
                self.send_header("Content-Disposition", 'attachment; filename="court-act.pdf"')
                self.send_header("Content-Length", str(len(response.content)))
                self.end_headers()
                self.wfile.write(response.content)
            except Exception as error:
                self.send_json({"error": f"Не удалось скачать PDF: {error}"}, 502)
            return

        self.send_json({"error": "Маршрут не найден"}, 404)


if __name__ == "__main__":
    print(f"KAD HTTP service: http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
