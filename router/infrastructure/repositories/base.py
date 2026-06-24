from __future__ import annotations
from abc import ABC, abstractmethod
from typing import List, Optional

from router.domain.user import User
from router.domain.client import Client, ClientRole
from router.domain.audit import AuditEvent
from router.domain.election import CandidateSnapshot


class UserRepository(ABC):
    @abstractmethod
    def save(self, user: User) -> None: ...

    @abstractmethod
    def get(self, user_id: str) -> Optional[User]: ...

    @abstractmethod
    def get_by_secret(self, tunnel_secret: str) -> Optional[User]: ...

    @abstractmethod
    def list_by_phone(self, phone: Optional[str] = None) -> List[User]: ...

    @abstractmethod
    def update_b_addr(self, user_id: str, addr: str, port: int, ts: int) -> None: ...


class ClientRepository(ABC):
    @abstractmethod
    def upsert(self, client: Client) -> Client: ...

    @abstractmethod
    def get(self, client_id: str) -> Optional[Client]: ...

    @abstractmethod
    def list_by_user(
        self, user_id: str, role: Optional[ClientRole] = None
    ) -> List[Client]: ...

    @abstractmethod
    def update_heartbeat(self, client_id: str, ts: int) -> bool: ...

    @abstractmethod
    def set_active(self, user_id: str, winner_id: str, winner_since: int) -> None: ...

    @abstractmethod
    def clear_active(self, user_id: str) -> None: ...

    @abstractmethod
    def get_candidates(self, user_id: str) -> List[CandidateSnapshot]: ...


class AuditRepository(ABC):
    @abstractmethod
    def insert_many(self, events: List[AuditEvent]) -> int: ...


from router.domain.completion import CompletionRecord  # noqa: E402


class CompletionRepository(ABC):
    @abstractmethod
    def append(self, record: CompletionRecord) -> None: ...
