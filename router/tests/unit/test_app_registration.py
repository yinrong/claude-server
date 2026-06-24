import pytest
from x.application.user_service import UserService
from x.application.registration_service import RegistrationService
from x.infrastructure.repositories.in_memory.user_repo import InMemoryUserRepository
from x.infrastructure.repositories.in_memory.client_repo import InMemoryClientRepository
from x.domain.client import ClientRole


def make_services():
    user_repo = InMemoryUserRepository()
    client_repo = InMemoryClientRepository()
    user_svc = UserService(user_repo)
    reg_svc = RegistrationService(user_repo, client_repo, user_svc=user_svc)
    return user_svc, reg_svc, client_repo


def test_register_b_returns_tunnel_secret():
    user_svc, reg_svc, _ = make_services()
    user_svc.create_user("host1", tunnel_secret="tun-test")
    result = reg_svc.register_b("host1", "b-001",
                                public_addr="1.2.3.4", port=443, hostname="host")
    assert result["tunnel_secret"] == "tun-test"


def test_register_b_unknown_group_raises():
    _, reg_svc, _ = make_services()
    with pytest.raises(KeyError):
        reg_svc.register_b("ghost-host", "b-001")


def test_register_b_updates_b_addr():
    user_svc, reg_svc, _ = make_services()
    user_svc.create_user("host3")
    reg_svc.register_b("host3", "b-h3",
                       public_addr="5.6.7.8", port=9443)
    user = user_svc.get_user("host3")
    assert user.b_addr == "5.6.7.8"
    assert user.b_port == 9443


def test_register_c_relay_addr_reflects_b():
    user_svc, reg_svc, _ = make_services()
    user_svc.create_user("host4", tunnel_secret="tun-t4")
    reg_svc.register_b("host4", "b-h4",
                       public_addr="9.9.9.9", port=8443)
    result = reg_svc.register_c("host4", "c-h4")
    assert result["relay_addr"] == "9.9.9.9"
    assert result["relay_port"] == 8443
    assert result["tunnel_secret"] == "tun-t4"


def test_register_c_no_b_gives_empty_addr():
    user_svc, reg_svc, _ = make_services()
    user_svc.create_user("host5", tunnel_secret="tun-t5")
    result = reg_svc.register_c("host5", "c-h5")
    assert result["relay_addr"] == ""
    assert result["relay_port"] == 0


def test_register_b_creates_client():
    user_svc, reg_svc, client_repo = make_services()
    user_svc.create_user("host6")
    reg_svc.register_b("host6", "b-h6", hostname="myhost")
    c = client_repo.get("b-h6")
    assert c is not None
    assert c.role == ClientRole.B
    assert c.hostname == "myhost"


def test_register_idempotent_updates_version():
    user_svc, reg_svc, client_repo = make_services()
    user_svc.create_user("host7")
    reg_svc.register_b("host7", "b-h7", version="0.1")
    reg_svc.register_b("host7", "b-h7", version="0.2")
    c = client_repo.get("b-h7")
    assert c.version == "0.2"
    clients = client_repo.list_by_user("host7")
    assert len(clients) == 1


def test_register_c_auto_creates_group():
    """tunnel 注册时，若 group 不存在，自动创建"""
    user_svc, reg_svc, _ = make_services()
    result = reg_svc.register_c("new-host", "c-new")
    assert result["tunnel_secret"].startswith("tun-")
    user = user_svc.get_user("new-host")
    assert user is not None
