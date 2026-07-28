from __future__ import annotations

from pathlib import Path

from flask import abort, send_from_directory
from waitress import serve

from app import create_app


FRONTEND_ROOT = Path(__file__).resolve().parents[1]


def create_dev_app():
    app = create_app()

    @app.get("/")
    def frontend_index():
        return send_from_directory(FRONTEND_ROOT, "index.html")

    @app.get("/<path:asset_path>")
    def frontend_asset(asset_path: str):
        if asset_path.startswith(("server/", ".")) or ".." in Path(asset_path).parts:
            abort(404)
        return send_from_directory(FRONTEND_ROOT, asset_path)

    return app


if __name__ == "__main__":
    serve(create_dev_app(), host="127.0.0.1", port=5002, threads=8)

