#!/usr/bin/env python3
"""Reuse the Jakarta site's public Google client ID without printing its value."""

from pathlib import Path
import re
import secrets
import sys


def assignments(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    result = {}
    for line in path.read_text().splitlines():
        match = re.match(r"^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$", line)
        if match:
            result[match[1]] = match[2]
    return result


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    destination = root / ".dev.vars"
    sources = (
        Path.home() / "GithubRepo/playground/aws/jakarta-website/.env",
        Path.home() / "GithubRepo/playground/aws/jakarta-backend/.env",
    )
    client_id = None
    for source in sources:
        values = assignments(source)
        client_id = values.get("PUBLIC_GOOGLE_CLIENT_ID") or values.get("GOOGLE_CLIENT_ID")
        if client_id:
            break
    if not client_id:
        print("Existing Google client ID not found in the Jakarta project configurations.", file=sys.stderr)
        return 1
    existing = destination.read_text().splitlines() if destination.exists() else []
    kept = [
        line for line in existing
        if not re.match(r"^\s*(?:GOOGLE_CLIENT_ID|LOCAL_DEV)\s*=", line)
    ]
    if not assignments(destination).get("SECRET_SESSION_KEY"):
        kept.append(f"SECRET_SESSION_KEY={secrets.token_urlsafe(48)}")
    destination.write_text("\n".join(kept + ["LOCAL_DEV=true", f"GOOGLE_CLIENT_ID={client_id}"]) + "\n")
    destination.chmod(0o600)
    print("Configured ignored .dev.vars using the existing Google client ID.")
    print("Local fixture login is enabled; do not use this file for deployment.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
