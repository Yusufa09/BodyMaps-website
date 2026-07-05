"""Path-safety helper for user-supplied case/session ids.

Case ids arrive straight from HTTP requests and get joined into filesystem
paths (see get_panTS_id usage in api_blueprint). Defence is two-layered:

1. ``is_safe_id`` — an early-return guard that rejects obviously-invalid input
   with a 400 before it reaches the filesystem.
2. ``werkzeug.utils.secure_filename`` — applied directly at each path-
   construction site as the actual barrier (also what CodeQL recognises).

This module holds layer 1. It is kept dependency-light (only ``re``) so it can
be unit-tested in CI without importing the app, database, or dataset.
"""

import re

# Case/session ids in this dataset are short tokens like "8854" or
# "PanTS_00008854": ASCII alphanumerics plus ._- and nothing else. Notably no
# path separators, so a value that matches cannot traverse directories.
_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


def is_safe_id(value) -> bool:
    """True if ``value`` is a syntactically valid id (no traversal, no separators)."""
    return (
        isinstance(value, str)
        and bool(_SAFE_ID_RE.match(value))
        and value not in (".", "..")
    )
