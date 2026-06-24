from __future__ import annotations
import secrets
import time
from typing import List, Optional

from router.domain.user import User, UserId
from router.infrastructure.repositories.base import UserRepository


class UserService:
    def __init__(self, user_repo: UserRepository):
        self._users = user_repo

    def create_user(
        self,
        user_id: str,
        *,
        tunnel_secret: Optional[str] = None,
        ts: Optional[int] = None,
    ) -> User:
        gid = UserId.of(user_id)
        secret = tunnel_secret or ("tun-" + secrets.token_urlsafe(32))
        ts = ts or int(time.time())
        user = User(
            user_id=gid,
            tunnel_secret=secret, created_at=ts,
        )
        self._users.save(user)
        return user

    def get_or_create_user(self, user_id: str) -> User:
        existing = self._users.get(user_id)
        if existing:
            return existing
        return self.create_user(user_id)

    def get_user(self, user_id: str) -> Optional[User]:
        return self._users.get(user_id)

    def list_users(self, phone: Optional[str] = None) -> List[User]:
        return self._users.list_by_phone(phone)
