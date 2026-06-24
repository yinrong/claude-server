from __future__ import annotations
import time
from typing import Optional

from router.domain.client import Client, ClientRole
from router.application.user_service import UserService
from router.infrastructure.repositories.base import UserRepository, ClientRepository


class RegistrationService:
    def __init__(self, user_repo: UserRepository, client_repo: ClientRepository, user_svc: UserService = None):
        self._users = user_repo
        self._clients = client_repo
        self._user_svc = user_svc

    def register_b(
        self,
        user_id: str,
        client_id: str,
        *,
        public_addr: str = "",
        port: int = 0,
        version: str = "",
        hostname: str = "",
        ts: Optional[int] = None,
    ) -> dict:
        ts = ts or int(time.time())
        user = self._users.get(user_id)
        if user is None:
            raise KeyError(f"unknown user_id: {user_id}")
        client = Client(
            client_id=client_id, user_id=user_id, role=ClientRole.B,
            hostname=hostname or None, version=version or None,
            registered_at=ts, last_heartbeat=ts,
        )
        self._clients.upsert(client)
        if public_addr and port:
            self._users.update_b_addr(user_id, public_addr, port, ts)
        return {"tunnel_secret": user.tunnel_secret}

    def register_c(
        self,
        user_id: str,
        client_id: str,
        *,
        version: str = "",
        hostname: str = "",
        ts: Optional[int] = None,
    ) -> dict:
        ts = ts or int(time.time())
        user = self._users.get(user_id)
        if user is None:
            if self._user_svc:
                user = self._user_svc.create_user(user_id, ts=ts)
            else:
                raise KeyError(f"unknown user_id: {user_id}")
        client = Client(
            client_id=client_id, user_id=user_id, role=ClientRole.C,
            hostname=hostname or None, version=version or None,
            registered_at=ts, last_heartbeat=ts,
        )
        self._clients.upsert(client)
        # 重新读取 user（可能刚被 register_b 更新了 b_addr）
        user = self._users.get(user_id)
        return {
            "relay_addr": user.b_addr or "",
            "relay_port": user.b_port or 0,
            "tunnel_secret": user.tunnel_secret,
        }
