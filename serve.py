"""Локальный сервер витрины NexusModeler.

Отключает кеширование: без этого браузер держит ES-модули в памяти и
правки исходников не видны.

Запуск:  python serve.py [порт] [корень]
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # тихий режим


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8802
    root = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = partial(NoCacheHandler, directory=root)
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"NexusModeler: http://127.0.0.1:{port}/  (root: {root})")
        httpd.serve_forever()


if __name__ == "__main__":
    main()