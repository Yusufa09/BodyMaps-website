"""Unit tests for the case/session id path-safety guard.

These are deliberately dependency-light (no app, DB, or dataset) so they run
fast and reliably in CI and lock in the path-traversal protection added to the
file-serving endpoints in api_blueprint.
"""

import os
import pytest

from api.path_safety import is_safe_id
from werkzeug.utils import secure_filename


# ---- ids the real app produces / accepts: must pass -------------------------

@pytest.mark.parametrize("value", [
    "8854",                 # bare numeric case id (the common case)
    "17",
    "0",
    "PanTS_00008854",       # fully-qualified id
    "BDMAP_00000001",
    "case-name_1.v2",       # allowed punctuation . _ -
    "a",
    "A" * 128,              # max length
])
def test_accepts_valid_ids(value):
    assert is_safe_id(value) is True


# ---- traversal / injection payloads: must be rejected -----------------------

@pytest.mark.parametrize("value", [
    "..",                   # parent dir
    ".",                    # current dir
    "../etc/passwd",        # classic traversal
    "..%2f..%2fetc",        # % is not in the allowlist
    "a/b",                  # forward slash
    "a\\b",                 # backslash (windows separator)
    "/absolute/path",
    "\\\\server\\share",    # UNC
    "a\x00b",               # NUL byte truncation
    "a\nb",                 # newline
    "a b",                  # space
    "$(whoami)",            # shell metachars
    "a;rm -rf /",
    "évil",                 # non-ascii
    "A" * 129,              # over max length
    "",                     # empty
])
def test_rejects_traversal_and_injection(value):
    assert is_safe_id(value) is False


# ---- non-string / falsy inputs ---------------------------------------------

@pytest.mark.parametrize("value", [None, 123, 8854, 0, [], {}, b"8854", True])
def test_rejects_non_strings(value):
    assert is_safe_id(value) is False


# ---- property: anything accepted is a single, in-bounds path segment --------

@pytest.mark.parametrize("value", ["8854", "PanTS_00008854", "case-1.v2", "..foo", "-x"])
def test_accepted_ids_cannot_escape_base(value):
    """If is_safe_id accepts a value, joining it under a base must stay under it."""
    if not is_safe_id(value):
        pytest.skip("value is rejected, not relevant here")
    base = "/data/mask_only"
    resolved = os.path.normpath(os.path.join(base, value))
    assert resolved.startswith(base + os.sep)


# ---- the sink barrier: secure_filename neutralises what slips through --------

@pytest.mark.parametrize("payload,expected_no_sep", [
    ("../etc/passwd", "etc_passwd"),
    ("..", ""),
    ("a/b/c", "a_b_c"),
    ("8854", "8854"),               # transparent for real ids
    ("PanTS_00008854", "PanTS_00008854"),
])
def test_secure_filename_strips_separators(payload, expected_no_sep):
    out = secure_filename(payload)
    assert out == expected_no_sep
    assert "/" not in out and "\\" not in out and ".." not in out.split(os.sep)
