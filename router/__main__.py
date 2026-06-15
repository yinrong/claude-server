"""Entry point for `python -m x`."""

from __future__ import annotations

import logging
import os

from aiohttp import web

from router.presentation.app_factory import create_app


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    home = os.environ.get("LLMROUTER_HOME", os.path.expanduser("~/.llmrouter"))
    db_path = os.environ.get("X_DB_PATH", os.path.join(home, "data", "x.sqlite"))
    releases_dir = os.environ.get(
        "X_RELEASES_DIR", os.path.join(home, "releases")
    )
    host = os.environ.get("X_HOST", "0.0.0.0")
    port = int(os.environ.get("X_PORT", "8000"))
    x_base_url = os.environ.get("X_BASE_URL", "")

    app = create_app(
        db_path=db_path,
        releases_dir=releases_dir,
        x_base_url=x_base_url,
    )
    web.run_app(app, host=host, port=port)


if __name__ == "__main__":
    main()
