from __future__ import annotations
import threading
from typing import Dict, List, Optional

from router.domain.user import User
from router.infrastructure.repositories.base import UserRepository


class InMemoryUserRepository(UserRepository):
    def __init__(self):
        self._store: Dict[str, User] = {}
        self._lock = threading.Lock()

    def save(self, user: User) -> None:
        with self._lock:
            gid = user.user_id.value
            if gid in self._store:
                raise ValueError(f"user already exists: {gid}")
            self._store[gid] = user

    def get(self, user_id: str) -> Optional[User]:
        return self._store.get(user_id)

    def get_by_secret(self, tunnel_secret: str) -> Optional[User]:
        return next(
            (g for g in self._store.values() if g.tunnel_secret == tunnel_secret), None
        )

    def list_by_phone(self, phone: Optional[str] = None) -> List[User]:
        return sorted(self._store.values(), key=lambda g: g.created_at)

    def update_b_addr(self, user_id: str, addr: str, port: int, ts: int) -> None:
        with self._lock:
            g = self._store.get(user_id)
            if g:
                self._store[user_id] = User(
                    user_id=g.user_id,
                    tunnel_secret=g.tunnel_secret, created_at=g.created_at,
                    b_addr=addr, b_port=port, b_last_seen=ts,
                )
