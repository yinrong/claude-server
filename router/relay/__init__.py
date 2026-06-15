# Legacy MultiTenantRelay(db=conn) — used by server.py create_app
from router.relay_legacy import MultiTenantRelay  # noqa: F401

# New DDD-style relay — used by presentation/app_factory.py
from .multi_tenant import MultiTenantRelay as MultiTenantRelayV2  # noqa: F401
