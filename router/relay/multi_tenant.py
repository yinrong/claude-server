"""Multi-tenant relay for X.

Handles WebSocket tunnels from C clients and routes API requests from A
to the correct group's active tunnel. Merged into X so users only need
one public IP (yinaisvr.duckdns.org).

Data path: A → X(/g/{user_id}/*) → WS tunnel → C → LLM.

WS auth: Cookie _sid={tunnel_secret}.  Lookup group by secret via UserRepository.
Wrong secret → 404 (camouflage, not 401).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid

import aiohttp
from aiohttp import web

from router import config
from router.application.audit_service import AuditService
from router.application.completion_service import CompletionService
from router.infrastructure.repositories.base import UserRepository
from router.relay.protocol import ALLOWED_HEADERS, MSG_PONG, MSG_RESPONSE, MSG_STREAM_CHUNK, MSG_STREAM_END

log = logging.getLogger("relay")


class MultiTenantRelay:
    def __init__(self, user_repo: UserRepository, audit_service: AuditService,
                 completion_service: CompletionService | None = None):
        self._user_repo = user_repo
        self._audit = audit_service
        self._completion = completion_service
        # user_id → active WS from C
        self.tunnels: dict[str, web.WebSocketResponse] = {}
        # user_id → {req_id → Future}
        self.pending: dict[str, dict[str, asyncio.Future]] = {}
        # user_id → {req_id → Queue}
        self.stream_queues: dict[str, dict[str, asyncio.Queue]] = {}
        # user_id → asyncio.Lock (serialise tunnel replacement)
        self._user_locks: dict[str, asyncio.Lock] = {}

    def _lock(self, user_id: str) -> asyncio.Lock:
        if user_id not in self._user_locks:
            self._user_locks[user_id] = asyncio.Lock()
        return self._user_locks[user_id]

    async def handle_index(self, request: web.Request) -> web.Response:
        static_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "static", "index.html"
        )
        if os.path.exists(static_path):
            return web.FileResponse(static_path)
        return web.Response(text="Welcome", content_type="text/html")

    async def handle_catch_all(self, request: web.Request) -> web.Response:
        return await self.handle_index(request)

    async def handle_websocket(self, request: web.Request) -> web.WebSocketResponse:
        cookie = request.headers.get("Cookie", "")
        token = next(
            (p.split("=", 1)[1] for p in cookie.split(";") if p.strip().startswith("_sid=")), ""
        )
        user = self._user_repo.get_by_secret(token)
        if user is None:
            log.warning("Tunnel auth failed from %s (unknown secret)", request.remote)
            raise web.HTTPNotFound()

        user_id = user.user_id.value
        ws = web.WebSocketResponse(heartbeat=None)
        await ws.prepare(request)
        log.info("Tunnel connected: user=%s from %s", user_id, request.remote)

        async with self._lock(user_id):
            old = self.tunnels.get(user_id)
            if old is not None and not old.closed:
                await old.close()
            self.tunnels[user_id] = ws

        try:
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    await self._handle_tunnel_msg(user_id, msg.data)
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    log.error("Tunnel error user=%s: %s", user_id, ws.exception())
        finally:
            log.info("Tunnel disconnected: user=%s", user_id)
            async with self._lock(user_id):
                if self.tunnels.get(user_id) is ws:
                    del self.tunnels[user_id]
            for fut in (self.pending.pop(user_id, {}) or {}).values():
                if not fut.done():
                    fut.set_exception(ConnectionError("tunnel disconnected"))
            for q in (self.stream_queues.pop(user_id, {}) or {}).values():
                await q.put(None)

        return ws

    async def _handle_tunnel_msg(self, user_id: str, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return

        msg_type = msg.get("type")
        req_id = msg.get("id")
        user_pending = self.pending.get(user_id, {})
        user_queues = self.stream_queues.get(user_id, {})

        if msg_type == MSG_PONG:
            return

        if msg_type == MSG_RESPONSE and req_id in user_pending:
            fut = user_pending.pop(req_id)
            if not fut.done():
                fut.set_result(msg)

        elif msg_type == MSG_STREAM_CHUNK and req_id in user_queues:
            await user_queues[req_id].put(msg.get("data", ""))

        elif msg_type == MSG_STREAM_END and req_id in user_queues:
            await user_queues[req_id].put(None)

    async def handle_api(self, request: web.Request) -> web.StreamResponse:
        started_at = time.time()
        user_id = request.match_info.get("user_id", "")
        path = "/" + (request.match_info.get("path", "") or "")

        tunnel = self.tunnels.get(user_id)
        if tunnel is None or tunnel.closed:
            self._audit.record_relay_event(
                user_id, request.method, path, 502, started_at, error_type="no_tunnel"
            )
            return web.json_response(
                {"error": {"message": "service unavailable", "type": "server_error"}},
                status=502,
            )

        try:
            body = await request.json()
        except Exception:
            body = {}

        is_stream = body.get("stream", False)
        req_id = uuid.uuid4().hex

        tunnel_msg = json.dumps({
            "type": "request",
            "id": req_id,
            "method": request.method,
            "path": path,
            "headers": {
                k: v for k, v in request.headers.items() if k.lower() in ALLOWED_HEADERS
            },
            "body": body,
        })

        if is_stream:
            return await self._handle_stream(
                request, user_id, req_id, tunnel, tunnel_msg, started_at, path, body
            )
        return await self._handle_normal(
            request, user_id, req_id, tunnel, tunnel_msg, started_at, path, body
        )

    async def _handle_normal(
        self, request: web.Request, user_id: str, req_id: str,
        tunnel: web.WebSocketResponse, tunnel_msg: str, started_at: float, path: str,
        body: dict,
    ) -> web.Response:
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self.pending.setdefault(user_id, {})[req_id] = fut

        try:
            await tunnel.send_str(tunnel_msg)
            result = await asyncio.wait_for(fut, timeout=config.REQUEST_TIMEOUT)
        except asyncio.TimeoutError:
            self.pending.get(user_id, {}).pop(req_id, None)
            self._audit.record_relay_event(
                user_id, request.method, path, 504, started_at, error_type="timeout"
            )
            return web.json_response(
                {"error": {"message": "request timeout", "type": "server_error"}},
                status=504,
            )
        except Exception as e:
            self.pending.get(user_id, {}).pop(req_id, None)
            self._audit.record_relay_event(
                user_id, request.method, path, 502, started_at, error_type=type(e).__name__
            )
            return web.json_response(
                {"error": {"message": str(e), "type": "server_error"}},
                status=502,
            )

        status = result.get("status", 200)
        resp_body = result.get("body")
        resp_headers = result.get("headers", {})
        content_type = resp_headers.get("content-type", "application/json")

        self._audit.record_relay_event(
            user_id, request.method, path, status, started_at, upstream_status=status
        )

        if self._completion and status == 200:
            body_dict = resp_body if isinstance(resp_body, dict) else {}
            choices = body_dict.get("choices", [{}])
            first = choices[0] if choices else {}
            response_content = (first.get("message") or {}).get("content", "")
            finish_reason = first.get("finish_reason", "")
            self._completion.record({
                "ts": int(started_at * 1000),
                "user_id": user_id,
                "model": body.get("model", ""),
                "messages": body.get("messages", []),
                "response_content": response_content,
                "finish_reason": finish_reason,
                "usage": body_dict.get("usage", {}),
                "latency_ms": max(0, int((time.time() - started_at) * 1000)),
            })

        if isinstance(resp_body, (dict, list)):
            return web.json_response(resp_body, status=status)
        return web.Response(text=str(resp_body), status=status, content_type=content_type)

    async def _handle_stream(
        self, request: web.Request, user_id: str, req_id: str,
        tunnel: web.WebSocketResponse, tunnel_msg: str, started_at: float, path: str,
        body: dict,
    ) -> web.StreamResponse:
        queue: asyncio.Queue = asyncio.Queue()
        self.stream_queues.setdefault(user_id, {})[req_id] = queue

        try:
            await tunnel.send_str(tunnel_msg)
        except Exception as e:
            self.stream_queues.get(user_id, {}).pop(req_id, None)
            self._audit.record_relay_event(
                user_id, request.method, path, 502, started_at, error_type=type(e).__name__
            )
            return web.json_response(
                {"error": {"message": str(e), "type": "server_error"}},
                status=502,
            )

        response = web.StreamResponse(
            status=200,
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
        await response.prepare(request)

        content_parts: list[str] = []
        finish_reason = ""
        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(queue.get(), timeout=config.REQUEST_TIMEOUT)
                except asyncio.TimeoutError:
                    break
                if chunk is None:
                    break
                await response.write(chunk.encode() if isinstance(chunk, str) else chunk)
                if self._completion and isinstance(chunk, str):
                    for line in chunk.splitlines():
                        if line.startswith("data: ") and line != "data: [DONE]":
                            try:
                                d = json.loads(line[6:])
                                delta = (d.get("choices") or [{}])[0].get("delta", {})
                                if delta.get("content"):
                                    content_parts.append(delta["content"])
                                fr = (d.get("choices") or [{}])[0].get("finish_reason")
                                if fr:
                                    finish_reason = fr
                            except (json.JSONDecodeError, IndexError):
                                pass
        finally:
            self.stream_queues.get(user_id, {}).pop(req_id, None)

        self._audit.record_relay_event(user_id, request.method, path, 200, started_at)

        if self._completion:
            self._completion.record({
                "ts": int(started_at * 1000),
                "user_id": user_id,
                "model": body.get("model", ""),
                "messages": body.get("messages", []),
                "response_content": "".join(content_parts),
                "finish_reason": finish_reason,
                "usage": {},
                "latency_ms": max(0, int((time.time() - started_at) * 1000)),
            })

        return response
