from __future__ import annotations
import secrets
import sqlite3
import time
from typing import List, Optional

from router.domain.user import User, UserId
from router.infrastructure.repositories.base import UserRepository


class SqliteUserRepository(UserRepository):
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def save(self, user: User) -> None:
        gid = user.user_id.value
        cur = self._conn.execute("SELECT user_id FROM users WHERE user_id=?", (gid,))
        if cur.fetchone():
            raise ValueError(f"user already exists: {gid}")
        self._conn.execute(
            "INSERT INTO users (user_id, tunnel_secret, created_at) VALUES (?, ?, ?)",
            (gid, user.tunnel_secret, user.created_at),
        )

    def get(self, user_id: str) -> Optional[User]:
        row = self._conn.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
        return self._row_to_user(row) if row else None

    def get_by_secret(self, tunnel_secret: str) -> Optional[User]:
        row = self._conn.execute(
            "SELECT * FROM users WHERE tunnel_secret=?", (tunnel_secret,)
        ).fetchone()
        return self._row_to_user(row) if row else None

    def list_by_phone(self, phone: Optional[str] = None) -> List[User]:
        rows = self._conn.execute("SELECT * FROM users ORDER BY created_at").fetchall()
        return [self._row_to_user(row) for row in rows]

    def update_b_addr(self, user_id: str, addr: str, port: int, ts: int) -> None:
        self._conn.execute(
            "UPDATE users SET b_addr=?, b_port=?, b_last_seen=? WHERE user_id=?",
            (addr, port, ts, user_id),
        )

    @staticmethod
    def _row_to_user(row: sqlite3.Row) -> User:
        return User(
            user_id=UserId(row["user_id"]),
            tunnel_secret=row["tunnel_secret"],
            created_at=row["created_at"],
            b_addr=row["b_addr"],
            b_port=row["b_port"],
            b_last_seen=row["b_last_seen"],
        )
