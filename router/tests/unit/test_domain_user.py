import pytest
from x.domain.user import UserId, User


def test_valid_user_id_simple():
    gid = UserId("home")
    assert gid.value == "home"


def test_valid_user_id_with_dots_dashes():
    gid = UserId("my-host.local")
    assert gid.value == "my-host.local"


def test_valid_user_id_alphanumeric():
    gid = UserId("host01")
    assert gid.value == "host01"


def test_user_id_of():
    gid = UserId.of("myhost")
    assert gid.value == "myhost"


def test_invalid_starts_with_dot():
    with pytest.raises(ValueError):
        UserId(".badstart")


def test_invalid_starts_with_dash():
    with pytest.raises(ValueError):
        UserId("-badstart")


def test_invalid_special_chars():
    with pytest.raises(ValueError):
        UserId("bad!name")


def test_invalid_empty():
    with pytest.raises(ValueError):
        UserId("")


def test_invalid_too_long():
    with pytest.raises(ValueError):
        UserId("a" * 64)


def test_user_id_immutable():
    gid = UserId("home")
    with pytest.raises(Exception):
        gid.value = "other"


def test_group_frozen():
    g = User(
        user_id=UserId("home"),
        tunnel_secret="tun-abc", created_at=1000,
    )
    with pytest.raises(Exception):
        g.tunnel_secret = "other"
