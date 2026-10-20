"""Serve this site and the installed water DLL on loopback only."""

import argparse
import hmac
import json
import logging
import secrets
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlsplit

from refprop_water import RefpropError, RefpropWater


ROOT = Path(__file__).resolve().parent.parent
PUBLIC_EXTENSIONS = {".html", ".css", ".js", ".wasm", ".svg", ".png", ".jpg",
                     ".jpeg", ".ico", ".webp", ".gif", ".woff", ".woff2"}


class Handler(SimpleHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def log_message(self, format_string, *args):
        if len(args) > 1 and str(args[1]).isdigit() and int(args[1]) >= 400:
            logging.warning(format_string, *args)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def allowed(self):
        origin = self.headers.get("Origin")
        site = self.headers.get("Sec-Fetch-Site")
        return (self.headers.get("Host") == self.server.authority
                and (origin is None or origin == self.server.origin)
                and site not in ("cross-site", "same-site"))

    def reply(self, status, value):
        data = json.dumps(value, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.allowed():
            self.reply(403, {"error": "Only same-origin loopback access is allowed."})
            return
        path = urlsplit(self.path).path
        if path == "/api/refprop/info":
            water = self.server.water
            self.reply(200, {
                "token": self.server.token,
                "constants": water.constants,
                "melting": {
                    "temperatureMin": 251.165, "temperatureMax": water.melting_temperature_max,
                    "pressureMin": water.melting_pressure_min, "pressureMax": water.melting_pressure_max,
                },
            })
            return
        if path == "/" or path == "/pycool.html" and not urlsplit(self.path).query:
            self.send_response(302)
            self.send_header("Location", "/pycool.html?water=refprop")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        target = (ROOT / unquote(path).lstrip("/")).resolve()
        if (not target.is_relative_to(ROOT) or not target.is_file()
                or target.suffix.lower() not in PUBLIC_EXTENSIONS
                or any(part.startswith(".") for part in target.relative_to(ROOT).parts)
                or target.relative_to(ROOT).parts[0] not in ("assets", "tests")
                and target.parent != ROOT):
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        self.send_error(405, "Use GET.")

    def do_POST(self):
        if not self.allowed() or not hmac.compare_digest(
                self.headers.get("X-REFPROP-Token", ""), self.server.token):
            self.reply(403, {"error": "Invalid REFPROP session or origin."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096 or self.headers.get_content_type() != "application/json":
                raise ValueError("Expected a JSON body of at most 4096 bytes.")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("Expected a JSON object.")
            path = urlsplit(self.path).path
            if path == "/api/refprop/state":
                keys = body["keys"]
                values = body["values"]
                if (not isinstance(keys, list) or len(keys) != 2
                        or not all(isinstance(k, str) for k in keys)
                        or not isinstance(values, list) or len(values) != 2
                        or not all(type(v) in (int, float) for v in values)):
                    raise ValueError("Expected two property keys and two numeric SI values.")
                result = self.server.water.state(keys[0], values[0], keys[1], values[1])
            elif path == "/api/refprop/line":
                if not isinstance(body["kind"], str) or type(body["temperature"]) not in (int, float):
                    raise ValueError("Expected a line name and a numeric temperature.")
                result = {"pressure": self.server.water.line(body["kind"], body["temperature"])}
            else:
                self.reply(404, {"error": "Unknown API endpoint."})
                return
            self.reply(200, result)
        except (RefpropError, ValueError, KeyError, TypeError, OverflowError) as error:
            logging.warning("REFPROP request rejected: %s", error)
            self.reply(422, {"error": str(error)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refprop", default=r"C:\Program Files (x86)\REFPROP")
    parser.add_argument("--port", type=int, default=8768)
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)
    water = RefpropWater(args.refprop)
    with HTTPServer(("127.0.0.1", args.port), Handler) as server:
        server.timeout = 30
        server.water = water
        server.token = secrets.token_urlsafe(32)
        server.authority = f"127.0.0.1:{server.server_port}"
        server.origin = f"http://{server.authority}"
        print(f"REFPROP water ready: {server.origin}/pycool.html?water=refprop", flush=True)
        print("Keep this window open; Ctrl+C stops the local service.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nREFPROP service stopped.", flush=True)


if __name__ == "__main__":
    main()
