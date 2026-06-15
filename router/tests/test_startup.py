"""E2E startup test for ai-hub-router (x server).

TDD: this test verifies that the router process starts up and /healthz
returns 200 with {"ok": true}.

Run from router/ directory:
    source ~/llm-router/venv/bin/activate
    python -m pytest tests/test_startup.py -v
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import tempfile
import time

import aiohttp
import pytest


# router/ directory (contains the x package as a symlink target)
ROUTER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# claude-server/ (project root; "x" symlink lives here pointing to router/)
PROJECT_ROOT = os.path.dirname(ROUTER_DIR)


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _wait_for_port(host: str, port: int, timeout: float = 10.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            s = socket.create_connection((host, port), timeout=0.5)
            s.close()
            return True
        except OSError:
            time.sleep(0.2)
    return False


@pytest.fixture()
def router_process():
    """Start router server in a subprocess, yield port, then tear down."""
    port = _free_port()
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "data", "x.sqlite")
        releases_dir = os.path.join(tmpdir, "releases")

        env = os.environ.copy()
        # Prepend ROUTER_DIR so `import config` (a module at router/config.py)
        # can be found at import time by relay/multi_tenant.py
        existing_pp = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = (
            ROUTER_DIR + os.pathsep + existing_pp if existing_pp else ROUTER_DIR
        )
        env.update(
            {
                "X_PORT": str(port),
                "X_HOST": "127.0.0.1",
                "X_DB_PATH": db_path,
                "X_RELEASES_DIR": releases_dir,
                "X_BASE_URL": "http://127.0.0.1:" + str(port),
                "LLMROUTER_HOME": tmpdir,
                "INTERNAL_LLM_BASE": "http://127.0.0.1:19999",  # not used in healthz
                "RELAY_TLS": "false",
            }
        )

        proc = subprocess.Popen(
            [sys.executable, "-m", "x"],
            cwd=PROJECT_ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        ready = _wait_for_port("127.0.0.1", port, timeout=15.0)

        yield {"port": port, "proc": proc, "ready": ready}

        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


async def test_healthz(router_process):
    """Router starts up and GET /healthz returns 200 with ok=true."""
    assert router_process["ready"], (
        "Router process did not bind to port within 15 s"
    )
    port = router_process["port"]
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"http://127.0.0.1:{port}/healthz", timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            assert resp.status == 200
            body = await resp.json()
            assert body.get("ok") is True
