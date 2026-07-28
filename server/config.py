from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    fanlong_db_path: Path
    terminal_db_path: Path
    upload_dir: Path
    cookie_secure: bool = True
    session_days: int = 7
    trusted_proxy_key: str = ""
    cookie_domain: str = ""
    allowed_origins: tuple[str, ...] = ()
    testing: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        fanlong = os.getenv("FANLONG_DB_PATH", "").strip()
        terminal = os.getenv("TERMINAL_DB_PATH", "").strip()
        uploads = os.getenv("TERMINAL_UPLOAD_DIR", "").strip()
        missing = [
            name
            for name, value in (
                ("FANLONG_DB_PATH", fanlong),
                ("TERMINAL_DB_PATH", terminal),
                ("TERMINAL_UPLOAD_DIR", uploads),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"缺少环境变量：{', '.join(missing)}")
        return cls(
            fanlong_db_path=Path(fanlong),
            terminal_db_path=Path(terminal),
            upload_dir=Path(uploads),
            cookie_secure=_env_bool("TERMINAL_COOKIE_SECURE", True),
            session_days=max(1, int(os.getenv("TERMINAL_SESSION_DAYS", "7"))),
            trusted_proxy_key=os.getenv("TERMINAL_TRUSTED_PROXY_KEY", ""),
            cookie_domain=os.getenv("TERMINAL_COOKIE_DOMAIN", "").strip(),
            allowed_origins=tuple(
                origin.strip().rstrip("/")
                for origin in os.getenv("TERMINAL_ALLOWED_ORIGINS", "").split(",")
                if origin.strip()
            ),
        )
