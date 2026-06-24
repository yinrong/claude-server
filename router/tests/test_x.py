"""Tests for the X coordinator."""

import json
import sqlite3

import pytest


async def test_create_user_valid(x_server, http_client):
    async with http_client.post(
        f"{x_server['url']}/api/users",
        json={"user_id": "host-alpha"},
    ) as resp:
        assert resp.status == 201
        body = await resp.json()
        assert body["user_id"] == "host-alpha"
        assert body["tunnel_secret"]
        assert body["tunnel_secret"].startswith("tun-")


async def test_create_user_invalid_starts_with_dash(x_server, http_client):
    async with http_client.post(
        f"{x_server['url']}/api/users",
        json={"user_id": "-badname"},
    ) as resp:
        assert resp.status == 400


async def test_create_user_invalid_special_chars(x_server, http_client):
    async with http_client.post(
        f"{x_server['url']}/api/users",
        json={"user_id": "bad!name"},
    ) as resp:
        assert resp.status == 400


async def test_create_user_invalid_too_long(x_server, http_client):
    async with http_client.post(
        f"{x_server['url']}/api/users",
        json={"user_id": "a" * 64},
    ) as resp:
        assert resp.status == 400


async def test_create_user_duplicate(x_server, http_client):
    payload = {"user_id": "dup-host"}
    async with http_client.post(f"{x_server['url']}/api/users", json=payload) as resp:
        assert resp.status == 201
    async with http_client.post(f"{x_server['url']}/api/users", json=payload) as resp:
        assert resp.status == 409


async def test_list_users(x_server, http_client):
    for gid in ["list-host-1", "list-host-2"]:
        async with http_client.post(
            f"{x_server['url']}/api/users",
            json={"user_id": gid},
        ) as resp:
            assert resp.status == 201

    async with http_client.get(f"{x_server['url']}/api/users") as resp:
        assert resp.status == 200
        body = await resp.json()
        ids = [g["user_id"] for g in body["users"]]
        assert "list-host-1" in ids
        assert "list-host-2" in ids


async def test_get_user_404(x_server, http_client):
    async with http_client.get(f"{x_server['url']}/api/users/nope-host") as resp:
        assert resp.status == 404


async def test_get_user_with_clients(x_server, http_client):
    user_id = "withclients-host"

    async with http_client.post(
        f"{x_server['url']}/api/users",
        json={"user_id": user_id},
    ) as resp:
        assert resp.status == 201

    async with http_client.post(
        f"{x_server['url']}/api/register/b",
        json={
            "user_id": user_id,
            "client_id": f"b-{user_id}",
            "public_addr": "127.0.0.1",
            "port": 9443,
            "version": "0.0.1",
            "hostname": "test-b",
        },
    ) as resp:
        assert resp.status == 200

    async with http_client.post(
        f"{x_server['url']}/api/register/c",
        json={
            "user_id": user_id,
            "client_id": f"c-{user_id}",
            "version": "0.0.1",
            "hostname": "test-c",
        },
    ) as resp:
        assert resp.status == 200

    async with http_client.get(f"{x_server['url']}/api/users/{user_id}") as resp:
        assert resp.status == 200
        body = await resp.json()
        clients = body.get("clients") or []
        assert len(clients) >= 2
        roles = sorted(c["role"] for c in clients)
        assert "B" in roles
        assert "C" in roles


async def test_version_endpoint(x_server, http_client):
    async with http_client.get(f"{x_server['url']}/api/version/c") as resp:
        assert resp.status == 200
        body = await resp.json()
        assert "version" in body
        assert "available" in body


async def test_version_endpoint_unknown_role(x_server, http_client):
    async with http_client.get(f"{x_server['url']}/api/version/z") as resp:
        assert resp.status == 404


async def test_install_script_renders_b(x_server, http_client):
    async with http_client.get(f"{x_server['url']}/install/b.sh") as resp:
        assert resp.status == 200
        body = await resp.text()
        assert "install/c.sh" in body


async def test_install_script_renders_c(x_server, http_client):
    user_id = "install-host"
    async with http_client.get(
        f"{x_server['url']}/install/c.sh", params={"user_id": user_id}
    ) as resp:
        assert resp.status == 200
        body = await resp.text()
        assert "INTERNAL_LLM_BASE" in body
        assert "set -euo pipefail" in body
        assert user_id in body


async def test_install_script_a_ps1(x_server, http_client):
    async with http_client.get(f"{x_server['url']}/install/a.ps1") as resp:
        assert resp.status == 200
        body = await resp.text()
        assert body
        assert "wsl" in body.lower()


async def test_audit_post_and_query(x_server, http_client):
    user_id = "audit-host"
    async with http_client.post(
        f"{x_server['url']}/api/users",
        json={"user_id": user_id},
    ) as resp:
        assert resp.status == 201

    async with http_client.post(
        f"{x_server['url']}/api/audit",
        json={
            "user_id": user_id,
            "b_client_id": "b1",
            "events": [
                {"ts": 1234, "method": "POST", "path": "/v1/x", "status": 200, "latency_ms": 5}
            ],
        },
    ) as resp:
        assert resp.status == 200
        body = await resp.json()
        assert body == {"accepted": 1}

    conn = sqlite3.connect(x_server["db_path"])
    try:
        rows = conn.execute(
            "SELECT method, status FROM audit_log WHERE user_id=?",
            (user_id,),
        ).fetchall()
    finally:
        conn.close()
    assert len(rows) == 1
    assert rows[0][0] == "POST"
    assert rows[0][1] == 200


async def test_audit_unknown_group_404(x_server, http_client):
    async with http_client.post(
        f"{x_server['url']}/api/audit",
        json={
            "user_id": "ghost-host",
            "b_client_id": "b1",
            "events": [{"ts": 1, "method": "GET", "path": "/", "status": 200, "latency_ms": 1}],
        },
    ) as resp:
        assert resp.status == 404


async def test_healthz(x_server, http_client):
    async with http_client.get(f"{x_server['url']}/healthz") as resp:
        assert resp.status == 200
        body = await resp.json()
        assert body.get("ok") is True
        assert "version" in body


async def test_download_release_missing(x_server, http_client):
    async with http_client.get(f"{x_server['url']}/api/download/b/0.0.1") as resp:
        assert resp.status == 404
