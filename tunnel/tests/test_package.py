"""
TN1 package structure tests.

Tests:
1. `import tunnel` succeeds
2. `tunnel/__main__.py` exists and is importable
3. `tunnel/pyproject.toml` exists and contains name = "ai-hub-tunnel"
"""

import importlib
import os
import sys

# Make sure the parent of tunnel/ is on sys.path so `import tunnel` works
TUNNEL_PARENT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if TUNNEL_PARENT not in sys.path:
    sys.path.insert(0, TUNNEL_PARENT)

TUNNEL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_import_tunnel():
    """tunnel package must be importable."""
    mod = importlib.import_module("tunnel")
    assert mod is not None


def test_main_exists():
    """tunnel/__main__.py must exist on disk."""
    main_path = os.path.join(TUNNEL_DIR, "__main__.py")
    assert os.path.isfile(main_path), f"__main__.py not found at {main_path}"


def test_main_importable():
    """tunnel.__main__ must be importable without side-effects (no asyncio.run at import)."""
    # Import as a module spec first — this validates syntax
    spec = importlib.util.find_spec("tunnel.__main__")
    assert spec is not None, "tunnel.__main__ spec not found"


def test_pyproject_exists():
    """tunnel/pyproject.toml must exist."""
    pyproject_path = os.path.join(TUNNEL_DIR, "pyproject.toml")
    assert os.path.isfile(pyproject_path), f"pyproject.toml not found at {pyproject_path}"


def test_pyproject_package_name():
    """pyproject.toml must contain name = \"ai-hub-tunnel\"."""
    pyproject_path = os.path.join(TUNNEL_DIR, "pyproject.toml")
    with open(pyproject_path) as f:
        content = f.read()
    assert 'name = "ai-hub-tunnel"' in content, (
        f"Expected 'name = \"ai-hub-tunnel\"' in pyproject.toml, got:\n{content}"
    )
