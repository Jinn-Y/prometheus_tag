from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(ROOT))).resolve()
TARGETS_FILE = DATA_DIR / "targets.json"
BACKUP_DIR = Path(os.getenv("BACKUP_DIR", str(DATA_DIR / "backups"))).resolve()
STATIC_DIR = ROOT / "static"
TARGET_RE = re.compile(r"^[^:\s]+:\d{1,5}$")
WRITE_MODE = os.getenv("WRITE_MODE", "atomic")


class ValidationError(ValueError):
    pass


def read_targets() -> list[dict]:
    if not TARGETS_FILE.exists():
        return []
    with TARGETS_FILE.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    return validate_targets(data)


def validate_targets(data):
    if not isinstance(data, list):
        raise ValidationError("根节点必须是数组。")

    for index, item in enumerate(data):
        if not isinstance(item, dict):
            raise ValidationError(f"第 {index + 1} 项必须是对象。")

        targets = item.get("targets")
        labels = item.get("labels")

        if not isinstance(targets, list) or not targets:
            raise ValidationError(f"第 {index + 1} 项 targets 必须是非空数组。")
        for target in targets:
            if not isinstance(target, str) or not TARGET_RE.match(target):
                raise ValidationError(f"第 {index + 1} 项 target 格式应为 host:port。")
            port = int(target.rsplit(":", 1)[1])
            if port < 1 or port > 65535:
                raise ValidationError(f"第 {index + 1} 项端口必须在 1-65535 之间。")

        if labels is None:
            item["labels"] = {}
            labels = item["labels"]
        if not isinstance(labels, dict):
            raise ValidationError(f"第 {index + 1} 项 labels 必须是对象。")
        for key, value in labels.items():
            if not isinstance(key, str) or not key.strip():
                raise ValidationError(f"第 {index + 1} 项 label key 不能为空。")
            if not isinstance(value, str):
                raise ValidationError(f"第 {index + 1} 项 label {key} 的值必须是字符串。")

    return data


def backup_targets() -> Path | None:
    if not TARGETS_FILE.exists():
        return None
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = BACKUP_DIR / f"targets.{stamp}.json"
    shutil.copy2(TARGETS_FILE, backup)
    return backup


def backup_metadata(path: Path) -> dict:
    stat = path.stat()
    return {
        "name": path.name,
        "path": str(path),
        "size": stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
    }


def list_backups() -> list[dict]:
    if not BACKUP_DIR.exists():
        return []
    backups = [path for path in BACKUP_DIR.glob("*.json") if path.is_file()]
    backups.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return [backup_metadata(path) for path in backups]


def resolve_backup(name: str) -> Path:
    if not re.fullmatch(r"[\w.-]+\.json", name):
        raise ValidationError("备份文件名非法。")
    path = (BACKUP_DIR / name).resolve()
    if BACKUP_DIR not in path.parents:
        raise ValidationError("备份路径非法。")
    if not path.exists() or not path.is_file():
        raise ValidationError("备份文件不存在。")
    return path


def read_backup(name: str) -> tuple[Path, list[dict]]:
    path = resolve_backup(name)
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    return path, validate_targets(data)


def write_targets(data) -> Path | None:
    validated = validate_targets(data)
    backup = backup_targets()
    payload = json.dumps(validated, ensure_ascii=False, indent=2) + "\n"

    if WRITE_MODE == "inplace":
        with TARGETS_FILE.open("w", encoding="utf-8") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        return backup

    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", delete=False, dir=ROOT, suffix=".tmp"
    ) as fh:
        tmp_path = Path(fh.name)
        fh.write(payload)
    tmp_path.replace(TARGETS_FILE)
    return backup


class Handler(BaseHTTPRequestHandler):
    server_version = "PrometheusTargetUI/1.0"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/":
            return self.serve_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
        if parsed.path == "/api/targets":
            return self.json_response({"targets": read_targets()})
        if parsed.path == "/api/backups":
            return self.json_response({"backups": list_backups()})
        backup_match = re.fullmatch(r"/api/backups/([^/]+)", parsed.path)
        if backup_match:
            path, data = read_backup(unquote(backup_match.group(1)))
            return self.json_response({
                "backup": backup_metadata(path),
                "targets": data,
                "content": json.dumps(data, ensure_ascii=False, indent=2),
            })
        if parsed.path.startswith("/static/"):
            filename = unquote(parsed.path.removeprefix("/static/"))
            path = (STATIC_DIR / filename).resolve()
            if STATIC_DIR.resolve() not in path.parents:
                return self.error_response(HTTPStatus.FORBIDDEN, "非法路径。")
            content_type = "text/plain; charset=utf-8"
            if path.suffix == ".css":
                content_type = "text/css; charset=utf-8"
            if path.suffix == ".js":
                content_type = "application/javascript; charset=utf-8"
            return self.serve_file(path, content_type)
        return self.error_response(HTTPStatus.NOT_FOUND, "页面不存在。")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/targets":
            targets = read_targets()
            item = self.read_json()
            validate_targets([item])
            targets.append(item)
            backup = write_targets(targets)
            return self.json_response({"targets": targets, "backup": str(backup) if backup else None})
        if parsed.path == "/api/validate":
            data = self.read_json()
            validate_targets(data)
            return self.json_response({"ok": True})
        if parsed.path == "/api/backup":
            backup = backup_targets()
            return self.json_response({"backup": str(backup) if backup else None})
        restore_match = re.fullmatch(r"/api/backups/([^/]+)/restore", parsed.path)
        if restore_match:
            path, data = read_backup(unquote(restore_match.group(1)))
            current_backup = write_targets(data)
            return self.json_response({
                "targets": data,
                "restored": backup_metadata(path),
                "backup": str(current_backup) if current_backup else None,
            })
        return self.error_response(HTTPStatus.NOT_FOUND, "接口不存在。")

    def do_PUT(self):
        parsed = urlparse(self.path)
        match = re.fullmatch(r"/api/targets/(\d+)", parsed.path)
        if not match:
            return self.error_response(HTTPStatus.NOT_FOUND, "接口不存在。")
        index = int(match.group(1))
        targets = read_targets()
        if index < 0 or index >= len(targets):
            return self.error_response(HTTPStatus.NOT_FOUND, "服务器不存在。")
        item = self.read_json()
        validate_targets([item])
        targets[index] = item
        backup = write_targets(targets)
        return self.json_response({"targets": targets, "backup": str(backup) if backup else None})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        backup_match = re.fullmatch(r"/api/backups/([^/]+)", parsed.path)
        if backup_match:
            path = resolve_backup(unquote(backup_match.group(1)))
            deleted = backup_metadata(path)
            path.unlink()
            return self.json_response({"deleted": deleted, "backups": list_backups()})

        match = re.fullmatch(r"/api/targets/(\d+)", parsed.path)
        if not match:
            return self.error_response(HTTPStatus.NOT_FOUND, "接口不存在。")
        index = int(match.group(1))
        targets = read_targets()
        if index < 0 or index >= len(targets):
            return self.error_response(HTTPStatus.NOT_FOUND, "服务器不存在。")
        targets.pop(index)
        backup = write_targets(targets)
        return self.json_response({"targets": targets, "backup": str(backup) if backup else None})

    def read_json(self):
        length = int(self.headers.get("content-length", "0"))
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValidationError(f"JSON 解析失败：{exc.msg}") from exc

    def serve_file(self, path: Path, content_type: str):
        if not path.exists() or not path.is_file():
            return self.error_response(HTTPStatus.NOT_FOUND, "文件不存在。")
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def json_response(self, data, status=HTTPStatus.OK):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def error_response(self, status: HTTPStatus, message: str):
        return self.json_response({"error": message}, status)

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except ValidationError as exc:
            self.error_response(HTTPStatus.BAD_REQUEST, str(exc))
        except Exception as exc:
            self.error_response(HTTPStatus.INTERNAL_SERVER_ERROR, f"服务异常：{exc}")

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Prometheus targets UI: http://{host}:{port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
