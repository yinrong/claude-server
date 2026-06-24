from __future__ import annotations
import re
from dataclasses import dataclass
from typing import Optional

_GROUP_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$")


@dataclass(frozen=True)
class UserId:
    value: str

    def __post_init__(self):
        if not _GROUP_ID_RE.match(self.value):
            raise ValueError(
                f"user_id must be 1-63 chars [A-Za-z0-9_.-] starting with alphanumeric, got: {self.value!r}"
            )

    @classmethod
    def of(cls, value: str) -> "UserId":
        return cls(value)


@dataclass(frozen=True)
class User:
    user_id: UserId
    tunnel_secret: str
    created_at: int
    b_addr: Optional[str] = None
    b_port: Optional[int] = None
    b_last_seen: Optional[int] = None
