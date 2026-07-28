from __future__ import annotations

import io
import hashlib
import hmac
import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from typing import Any, Callable

from flask import Flask, Response, g, jsonify, request, send_from_directory
from PIL import Image, ImageOps, UnidentifiedImageError
from pypinyin import lazy_pinyin

from config import Settings
from db import connect, init_terminal_db, json_object, transaction
from game_services import (
    GameError,
    daily_blind_box,
    daily_signin,
    daily_state,
    daily_train,
    compound_item,
    equip_item,
    purchase_item,
    summon_draw,
    summon_state,
    transfer_currency,
    transfer_item,
    unequip_item,
    use_inventory_item,
)
from security import hash_password, random_token, token_hash, verify_password


SESSION_COOKIE = "fanlong_session"
CSRF_COOKIE = "fanlong_csrf"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_time(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat()


def romanize_name(value: str) -> str:
    return "".join(lazy_pinyin(str(value or ""))).lower()


def summon_catalog() -> list[dict]:
    manifest = Path(__file__).resolve().with_name("summon_catalog.json")
    if manifest.is_file():
        with manifest.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, list):
            return [
                {
                    "id": str(card.get("id", "")),
                    "name": str(card.get("name", "")),
                    "rarity": str(card.get("rarity", "")),
                    "image": str(card.get("image", "")),
                }
                for card in data
                if isinstance(card, dict) and card.get("id") and card.get("name") and card.get("rarity") and card.get("image")
            ]

    root = Path(__file__).resolve().parents[1] / "assets" / "ui" / "summon-cards"
    result: list[dict] = []
    for rarity in ("R", "SR", "SSR"):
        folder = root / rarity
        if not folder.is_dir():
            continue
        for file in sorted(folder.iterdir(), key=lambda item: item.name):
            if file.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                continue
            stem = file.stem
            name = stem.replace("完整版", "").strip()
            if name.endswith(("A", "B")):
                name = name[:-1]
            if name == "李长海2":
                name = "李长海"
            result.append({
                "id": f"{rarity}/{file.name}",
                "name": name,
                "rarity": rarity,
                "image": f"assets/ui/summon-cards/{rarity}/{file.name}",
            })
    return result


def ensure_game_tables(database_path: Path) -> None:
    migration_dir = Path(__file__).resolve().with_name("migrations")
    with connect(database_path) as db:
        for migration in sorted(migration_dir.glob("*.sql")):
            db.executescript(migration.read_text(encoding="utf-8"))


def create_app(settings: Settings | None = None) -> Flask:
    app = Flask(__name__)
    app.config["JSON_AS_ASCII"] = False
    active = settings or Settings.from_env()
    app.config["TERMINAL_SETTINGS"] = active

    if not active.fanlong_db_path.is_file():
        raise RuntimeError(f"找不到 fanlong.db：{active.fanlong_db_path}")
    init_terminal_db(active.terminal_db_path)
    ensure_game_tables(active.fanlong_db_path)
    active.upload_dir.mkdir(parents=True, exist_ok=True)

    def payload(ok: bool, code: str, message: str, data: Any = None, status: int = 200):
        body = {
            "ok": ok,
            "code": code,
            "message": message,
            "data": data,
            "requestId": getattr(g, "request_id", None),
        }
        return jsonify(body), status

    def audit(qq_id: str | None, action: str, target: str | None, result: str) -> None:
        with connect(active.terminal_db_path) as db:
            db.execute(
                "INSERT INTO web_audit_logs (qq_id, action, target, result, ip, request_id) VALUES (?, ?, ?, ?, ?, ?)",
                (qq_id, action, target, result, request.remote_addr, g.request_id),
            )

    def set_auth_cookies(response: Response, session_token: str, csrf_token: str) -> None:
        lifetime = active.session_days * 86400
        cookie_domain = active.cookie_domain or None
        response.set_cookie(
            SESSION_COOKIE,
            session_token,
            max_age=lifetime,
            httponly=True,
            secure=active.cookie_secure,
            samesite="Lax",
            path="/",
            domain=cookie_domain,
        )
        response.set_cookie(
            CSRF_COOKIE,
            csrf_token,
            max_age=lifetime,
            httponly=False,
            secure=active.cookie_secure,
            samesite="Lax",
            path="/",
            domain=cookie_domain,
        )

    def clear_auth_cookies(response: Response) -> None:
        cookie_domain = active.cookie_domain or None
        response.delete_cookie(SESSION_COOKIE, path="/", secure=active.cookie_secure, samesite="Lax", domain=cookie_domain)
        response.delete_cookie(CSRF_COOKIE, path="/", secure=active.cookie_secure, samesite="Lax", domain=cookie_domain)

    def create_session(db: sqlite3.Connection, qq_id: str) -> tuple[str, str]:
        session_token = random_token()
        csrf_token = random_token(24)
        db.execute(
            "INSERT INTO web_sessions (session_hash, qq_id, csrf_hash, expires_at) VALUES (?, ?, ?, ?)",
            (
                token_hash(session_token),
                qq_id,
                token_hash(csrf_token),
                iso_time(utc_now() + timedelta(days=active.session_days)),
            ),
        )
        return session_token, csrf_token

    def bearer_token() -> str:
        authorization = request.headers.get("Authorization", "")
        scheme, _, value = authorization.partition(" ")
        return value.strip() if scheme.lower() == "bearer" else ""

    def current_session() -> sqlite3.Row | None:
        raw = bearer_token() or request.cookies.get(SESSION_COOKIE, "")
        if not raw:
            return None
        with connect(active.terminal_db_path) as db:
            return db.execute(
                """
                SELECT s.*, a.status, a.must_change_password
                FROM web_sessions s
                JOIN player_accounts a ON a.qq_id=s.qq_id
                WHERE s.session_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.status='active'
                """,
                (token_hash(raw), iso_time(utc_now())),
            ).fetchone()

    def auth_required(write: bool = False, allow_forced_change: bool = False):
        def decorate(view: Callable):
            @wraps(view)
            def wrapped(*args, **kwargs):
                session = current_session()
                if session is None:
                    return payload(False, "AUTH_REQUIRED", "登录状态已失效，请重新登录", status=401)
                if session["must_change_password"] and not allow_forced_change:
                    return payload(False, "PASSWORD_CHANGE_REQUIRED", "请先修改临时密码", status=403)
                if write:
                    csrf = request.headers.get("X-CSRF-Token", "")
                    cookie_csrf = request.cookies.get(CSRF_COOKIE, "")
                    csrf_matches_transport = bool(bearer_token()) or csrf == cookie_csrf
                    if not csrf or not csrf_matches_transport or token_hash(csrf) != session["csrf_hash"]:
                        return payload(False, "CSRF_INVALID", "安全校验失败，请刷新后重试", status=403)
                g.qq_id = session["qq_id"]
                g.session = session
                return view(*args, **kwargs)

            return wrapped

        return decorate

    def request_json() -> dict:
        value = request.get_json(silent=True)
        return value if isinstance(value, dict) else {}

    def validate_credentials(body: dict) -> tuple[str, str, tuple | None]:
        qq_id = str(body.get("qq", "")).strip()
        password = str(body.get("password", ""))
        if not qq_id.isdigit() or len(qq_id) > 20:
            return "", "", payload(False, "INVALID_INPUT", "账号或密码格式不正确", status=400)
        if len(password) < 8 or len(password) > 128:
            return "", "", payload(False, "INVALID_INPUT", "密码需为8至128位", status=400)
        return qq_id, password, None

    def player_exists(qq_id: str) -> bool:
        with connect(active.fanlong_db_path) as db:
            return db.execute("SELECT 1 FROM users WHERE id=?", (qq_id,)).fetchone() is not None

    def auth_rate_limited(qq_id: str) -> bool:
        with connect(active.terminal_db_path) as db:
            count = db.execute(
                """
                SELECT COUNT(*) FROM auth_attempts
                WHERE succeeded=0 AND created_at>=datetime('now', '-15 minutes') AND (qq_id=? OR ip=?)
                """,
                (qq_id, request.remote_addr),
            ).fetchone()[0]
        return count >= 10

    def record_auth_attempt(qq_id: str, succeeded: bool) -> None:
        with connect(active.terminal_db_path) as db:
            db.execute(
                "INSERT INTO auth_attempts (qq_id, ip, succeeded) VALUES (?, ?, ?)",
                (qq_id, request.remote_addr, int(succeeded)),
            )

    @app.before_request
    def assign_request_id():
        g.request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex

    @app.after_request
    def response_headers(response: Response):
        response.headers["X-Request-Id"] = g.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Cache-Control"] = "no-store" if request.path.startswith("/api/") else response.headers.get("Cache-Control", "")
        origin = request.headers.get("Origin", "").rstrip("/")
        if origin and origin in active.allowed_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-CSRF-Token, Idempotency-Key"
            response.headers.add("Vary", "Origin")
        return response

    @app.get("/api/health")
    def health():
        with connect(active.fanlong_db_path) as game_db, connect(active.terminal_db_path) as terminal_db:
            game_db.execute("SELECT 1").fetchone()
            terminal_db.execute("SELECT 1").fetchone()
        return payload(True, "OK", "服务正常", {"database": "ok"})

    @app.get("/api/auth/status")
    def auth_status():
        session = current_session()
        if session is None:
            return payload(True, "ANONYMOUS", "未登录", {"authenticated": False})
        return payload(
            True,
            "OK",
            "已登录",
            {
                "authenticated": True,
                "qq": session["qq_id"],
                "mustChangePassword": bool(session["must_change_password"]),
            },
        )

    @app.post("/api/auth/initialize")
    def auth_initialize():
        qq_id, password, error = validate_credentials(request_json())
        if error:
            return error
        if auth_rate_limited(qq_id):
            return payload(False, "RATE_LIMITED", "尝试次数过多，请15分钟后再试", status=429)
        if not player_exists(qq_id):
            record_auth_attempt(qq_id, False)
            audit(qq_id, "auth.initialize", qq_id, "player_not_found")
            return payload(False, "ACCOUNT_OR_PASSWORD_INVALID", "账号或密码错误", status=400)
        try:
            with transaction(active.terminal_db_path, immediate=True) as db:
                if db.execute("SELECT 1 FROM player_accounts WHERE qq_id=?", (qq_id,)).fetchone():
                    return payload(False, "ACCOUNT_EXISTS", "该账号已完成首次设密，请直接登录", status=409)
                db.execute(
                    "INSERT INTO player_accounts (qq_id, password_hash) VALUES (?, ?)",
                    (qq_id, hash_password(password)),
                )
                session_token, csrf_token = create_session(db, qq_id)
            audit(qq_id, "auth.initialize", qq_id, "success")
            record_auth_attempt(qq_id, True)
        except sqlite3.IntegrityError:
            audit(qq_id, "auth.initialize", qq_id, "race_lost")
            return payload(False, "ACCOUNT_EXISTS", "该账号已完成首次设密，请直接登录", status=409)
        response, status = payload(True, "ACCOUNT_CREATED", "首次设密成功", {
            "mustChangePassword": False,
            "csrfToken": csrf_token,
            "sessionToken": session_token,
        })
        set_auth_cookies(response, session_token, csrf_token)
        return response, status

    @app.post("/api/auth/login")
    def auth_login():
        qq_id, password, error = validate_credentials(request_json())
        if error:
            return error
        if auth_rate_limited(qq_id):
            return payload(False, "RATE_LIMITED", "尝试次数过多，请15分钟后再试", status=429)
        with connect(active.terminal_db_path) as db:
            account = db.execute("SELECT * FROM player_accounts WHERE qq_id=?", (qq_id,)).fetchone()
        if account is None or account["status"] != "active" or not verify_password(password, account["password_hash"]):
            record_auth_attempt(qq_id, False)
            audit(qq_id, "auth.login", qq_id, "failed")
            return payload(False, "ACCOUNT_OR_PASSWORD_INVALID", "账号或密码错误", status=401)
        with transaction(active.terminal_db_path, immediate=True) as db:
            db.execute("UPDATE player_accounts SET last_login_at=?, updated_at=CURRENT_TIMESTAMP WHERE qq_id=?", (iso_time(utc_now()), qq_id))
            session_token, csrf_token = create_session(db, qq_id)
        audit(qq_id, "auth.login", qq_id, "success")
        record_auth_attempt(qq_id, True)
        response, status = payload(
            True,
            "OK",
            "登录成功",
            {
                "mustChangePassword": bool(account["must_change_password"]),
                "csrfToken": csrf_token,
                "sessionToken": session_token,
            },
        )
        set_auth_cookies(response, session_token, csrf_token)
        return response, status

    @app.post("/api/auth/logout")
    @auth_required(write=True, allow_forced_change=True)
    def auth_logout():
        with connect(active.terminal_db_path) as db:
            db.execute("UPDATE web_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE session_hash=?", (g.session["session_hash"],))
        audit(g.qq_id, "auth.logout", g.qq_id, "success")
        response, status = payload(True, "OK", "已退出登录")
        clear_auth_cookies(response)
        return response, status

    @app.post("/api/auth/password/change")
    @auth_required(write=True, allow_forced_change=True)
    def password_change():
        body = request_json()
        current_password = str(body.get("currentPassword", ""))
        new_password = str(body.get("newPassword", ""))
        if len(new_password) < 8 or len(new_password) > 128:
            return payload(False, "INVALID_INPUT", "新密码需为8至128位", status=400)
        with transaction(active.terminal_db_path, immediate=True) as db:
            account = db.execute("SELECT * FROM player_accounts WHERE qq_id=?", (g.qq_id,)).fetchone()
            if account is None or not verify_password(current_password, account["password_hash"]):
                return payload(False, "ACCOUNT_OR_PASSWORD_INVALID", "当前密码错误", status=400)
            db.execute(
                "UPDATE player_accounts SET password_hash=?, must_change_password=0, updated_at=CURRENT_TIMESTAMP WHERE qq_id=?",
                (hash_password(new_password), g.qq_id),
            )
            db.execute("UPDATE web_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE qq_id=?", (g.qq_id,))
            session_token, csrf_token = create_session(db, g.qq_id)
        audit(g.qq_id, "auth.password.change", g.qq_id, "success")
        response, status = payload(True, "OK", "密码修改成功", {
            "csrfToken": csrf_token,
            "sessionToken": session_token,
        })
        set_auth_cookies(response, session_token, csrf_token)
        return response, status

    def current_user_row() -> sqlite3.Row | None:
        with connect(active.fanlong_db_path) as db:
            return db.execute("SELECT * FROM users WHERE id=?", (g.qq_id,)).fetchone()

    def avatar_url(qq_id: str) -> str | None:
        with connect(active.terminal_db_path) as db:
            row = db.execute("SELECT file_key FROM user_avatars WHERE qq_id=?", (qq_id,)).fetchone()
        return f"/api/avatars/{row['file_key']}" if row else None

    def visible_profile(db: sqlite3.Connection, user: sqlite3.Row) -> list[dict]:
        profile = json_object(user["profile"])
        rows = db.execute(
            "SELECT key, text FROM game_terms WHERE key LIKE 'profile_%' AND is_hidden=1 ORDER BY sort_order, rowid"
        ).fetchall()
        result = []
        for row in rows:
            value = user["name"] if row["key"] == "profile_name" else profile.get(row["text"], "")
            if not value and row["key"] == "profile_job":
                value = profile.get("官职", "")
            if not value and row["key"] == "profile_citizen":
                value = profile.get("籍贯", "")
            result.append({"key": row["key"], "label": row["text"], "value": str(value or "")})
        return result

    @app.get("/api/me")
    @auth_required()
    def me():
        with connect(active.fanlong_db_path) as db:
            user = db.execute("SELECT * FROM users WHERE id=?", (g.qq_id,)).fetchone()
            if user is None:
                return payload(False, "PLAYER_NOT_FOUND", "角色档案不存在", status=404)
            currency = json_object(user["currency"])
            profile_fields = visible_profile(db, user)
        return payload(
            True,
            "OK",
            "读取成功",
            {
                "qq": user["id"],
                "uid": user["uid"],
                "name": user["name"],
                "romanName": romanize_name(user["name"]),
                "avatarUrl": avatar_url(g.qq_id),
                "currency": {"yuCoin": currency.get("yuCoin", 0), "reputation": currency.get("reputation", 0)},
                "profile": profile_fields,
            },
        )

    def term_maps(db: sqlite3.Connection, prefix: str) -> tuple[dict[str, str], list[str]]:
        rows = db.execute(
            "SELECT key, text FROM game_terms WHERE key LIKE ? AND is_hidden=1 ORDER BY sort_order, rowid",
            (f"{prefix}%",),
        ).fetchall()
        return ({row["key"]: row["text"] for row in rows}, [row["key"] for row in rows])

    @app.get("/api/me/stats")
    @auth_required()
    def me_stats():
        with connect(active.fanlong_db_path) as db:
            base = db.execute("SELECT * FROM user_stats WHERE user_id=?", (g.qq_id,)).fetchone()
            equip = db.execute("SELECT * FROM user_equip WHERE user_id=?", (g.qq_id,)).fetchone()
            labels, ordered = term_maps(db, "stat_")
            base_values = {key: int(base[key] or 0) if base and key in base.keys() else 0 for key in ordered}
            bonuses = {key: 0 for key in ordered}
            bonus_sources: list[dict] = []
            equipped_names = [equip[key] for key in equip.keys() if key != "user_id" and equip[key]] if equip else []
            for item_name in equipped_names:
                item = db.execute("SELECT stats FROM items WHERE name=?", (item_name,)).fetchone()
                item_stats = json_object(item["stats"]) if item else {}
                source_values = []
                for key in ordered:
                    label = labels[key]
                    value = item_stats.get(label, item_stats.get(key, 0))
                    if key == "stat_obed" and not value:
                        value = item_stats.get("服从/威慑", 0)
                    if isinstance(value, (int, float)) and value:
                        bonuses[key] += int(value)
                        source_values.append({"label": label, "value": int(value)})
                if source_values:
                    bonus_sources.append({"item": item_name, "values": source_values})
            stats = [
                {
                    "key": key,
                    "label": labels[key],
                    "base": base_values[key],
                    "bonus": bonuses[key],
                    "total": base_values[key] + bonuses[key],
                }
                for key in ordered
            ]
        return payload(True, "OK", "读取成功", {"stats": stats, "total": sum(item["total"] for item in stats), "bonusSources": bonus_sources})

    @app.get("/api/inventory")
    @auth_required()
    def inventory():
        with connect(active.fanlong_db_path) as db:
            rows = db.execute(
                """
                SELECT b.item_name, b.count, i.type, i.slot, i.desc, i.stats, i.effect, i.sub_type, i.param
                FROM user_bag b LEFT JOIN items i ON i.name=b.item_name
                WHERE b.user_id=? AND b.count>0 ORDER BY i.type, b.item_name
                """,
                (g.qq_id,),
            ).fetchall()
        items = [
            {
                "name": row["item_name"],
                "count": row["count"],
                "type": row["type"] or "unknown",
                "slot": row["slot"],
                "description": row["desc"] or "暂无说明",
                "stats": json_object(row["stats"]),
                "effect": json_object(row["effect"]),
                "subType": row["sub_type"],
                "param": json.loads(row["param"] or "[]") if row["param"] else [],
            }
            for row in rows
        ]
        return payload(True, "OK", "读取成功", {"items": items})

    @app.post("/api/inventory/use")
    @auth_required(write=True)
    def inventory_use():
        body = request.get_json(silent=True) or {}
        try:
            count = int(body.get("count", 1))
        except (TypeError, ValueError):
            count = 0
        result = use_inventory_item(
            active.fanlong_db_path,
            g.qq_id,
            body.get("item", ""),
            count,
            body.get("choice", ""),
            idempotency_key(),
        )
        audit(g.qq_id, "inventory.use", result["item"], "success")
        return payload(True, "OK", "使用成功", result)

    @app.get("/api/wardrobe")
    @auth_required()
    def wardrobe():
        with connect(active.fanlong_db_path) as db:
            equip = db.execute("SELECT * FROM user_equip WHERE user_id=?", (g.qq_id,)).fetchone()
            bag = {row["item_name"]: row["count"] for row in db.execute("SELECT item_name, count FROM user_bag WHERE user_id=?", (g.qq_id,)).fetchall()}
            rows = db.execute(
                "SELECT * FROM items WHERE type='equip' ORDER BY slot, rowid"
            ).fetchall()
        equipped_slots = {key: equip[key] for key in equip.keys() if key != "user_id"} if equip else {}
        equipped_counts: dict[str, int] = {}
        for item_name in equipped_slots.values():
            if item_name:
                equipped_counts[item_name] = equipped_counts.get(item_name, 0) + 1
        items = []
        for row in rows:
            owned = int(bag.get(row["name"], 0)) + equipped_counts.get(row["name"], 0)
            slots = [key for key, value in equipped_slots.items() if value == row["name"]]
            items.append(
                {
                    "name": row["name"], "price": row["price"], "currency": row["currency"],
                    "slot": row["slot"], "description": row["desc"] or "暂无说明",
                    "stats": json_object(row["stats"]), "isSelling": bool(row["is_selling"]),
                    "stock": row["stock_qty"], "owned": owned, "equippedSlots": slots,
                }
            )
        items.sort(key=lambda item: (0 if item["equippedSlots"] else 1 if item["owned"] else 2, item["name"]))
        return payload(True, "OK", "读取成功", {"items": items, "equipped": equipped_slots})

    @app.post("/api/wardrobe/equip")
    @auth_required(write=True)
    def wardrobe_equip():
        body = request.get_json(silent=True) or {}
        result = equip_item(active.fanlong_db_path, g.qq_id, body.get("item", ""), body.get("slot", ""), idempotency_key())
        audit(g.qq_id, "wardrobe.equip", result["item"], "success")
        return payload(True, "OK", "穿戴成功", result)

    @app.post("/api/wardrobe/unequip")
    @auth_required(write=True)
    def wardrobe_unequip():
        body = request.get_json(silent=True) or {}
        result = unequip_item(active.fanlong_db_path, g.qq_id, body.get("item", ""), body.get("slot", ""), idempotency_key())
        audit(g.qq_id, "wardrobe.unequip", result["item"], "success")
        return payload(True, "OK", "卸下成功", result)

    @app.get("/api/shop")
    @auth_required()
    def shop():
        with connect(active.fanlong_db_path) as db:
            bag = {row["item_name"]: row["count"] for row in db.execute("SELECT item_name, count FROM user_bag WHERE user_id=?", (g.qq_id,)).fetchall()}
            rows = db.execute(
                """
                SELECT * FROM items
                WHERE is_selling=1 AND (price>=0 OR (compound_recipe IS NOT NULL AND compound_recipe NOT IN ('', '{}')))
                ORDER BY currency, rowid
                """
            ).fetchall()
        items = []
        for row in rows:
            recipe = json_object(row["compound_recipe"])
            items.append(
                {
                    "name": row["name"], "price": row["price"], "currency": row["currency"],
                    "type": row["type"], "slot": row["slot"], "description": row["desc"] or "暂无说明",
                    "condition": json_object(row["condition"]), "maxHold": row["max_hold"] or 0,
                    "stock": row["stock_qty"], "owned": int(bag.get(row["name"], 0)), "recipe": recipe,
                    "channel": "compound" if recipe else ("reputation" if row["currency"] == "reputation" else "yuCoin"),
                }
            )
        return payload(True, "OK", "读取成功", {"items": items})

    @app.post("/api/shop/purchase")
    @auth_required(write=True)
    def shop_purchase():
        body = request_json()
        try:
            count = int(body.get("count", 1))
        except (TypeError, ValueError):
            count = 0
        result = purchase_item(active.fanlong_db_path, g.qq_id, body.get("item", ""), count, idempotency_key())
        audit(g.qq_id, "shop.purchase", result["item"], "success")
        return payload(True, "OK", "购买成功", result)

    @app.post("/api/shop/compound")
    @auth_required(write=True)
    def shop_compound():
        body = request_json()
        try:
            count = int(body.get("count", 1))
        except (TypeError, ValueError):
            count = 0
        result = compound_item(active.fanlong_db_path, g.qq_id, body.get("item", ""), count, idempotency_key())
        audit(g.qq_id, "shop.compound", result["item"], "success")
        return payload(True, "OK", "兑换成功", result)

    def drama_data(row: sqlite3.Row, favorite: bool = False, include_content: bool = False) -> dict:
        data = {
            "id": row["id"], "title": row["title"] or "未命名剧情", "date": row["date_str"] or "",
            "participants": row["participants"] or "", "note": row["note"] or "",
            "recorder": row["recorder"] or "", "createdAt": row["created_at"],
            "words": len(row["content"] or ""), "favorite": favorite,
        }
        if include_content:
            data["content"] = row["content"] or ""
        return data

    @app.get("/api/dramas")
    @auth_required()
    def dramas():
        filter_name = request.args.get("filter", "all")
        page = max(1, request.args.get("page", 1, type=int))
        page_size = min(50, max(1, request.args.get("pageSize", 20, type=int)))
        with connect(active.terminal_db_path) as terminal:
            favorite_ids = {row["drama_id"] for row in terminal.execute("SELECT drama_id FROM drama_favorites WHERE qq_id=?", (g.qq_id,)).fetchall()}
        with connect(active.fanlong_db_path) as db:
            user = db.execute("SELECT name FROM users WHERE id=?", (g.qq_id,)).fetchone()
            where = ["is_deleted=0"]
            params: list[Any] = []
            if filter_name == "mine":
                where.append("(participants LIKE ? OR participants LIKE ?)")
                params.extend([f"%{user['name']}%", f"%{g.qq_id}%"])
            elif filter_name == "today":
                where.append("date(created_at, 'localtime')=date('now', 'localtime')")
            elif filter_name == "favorite":
                if not favorite_ids:
                    return payload(True, "OK", "读取成功", {"items": [], "page": page, "pageSize": page_size})
                where.append(f"id IN ({','.join('?' for _ in favorite_ids)})")
                params.extend(sorted(favorite_ids))
            params.extend([page_size, (page - 1) * page_size])
            rows = db.execute(
                f"SELECT * FROM drama_archives WHERE {' AND '.join(where)} ORDER BY id DESC LIMIT ? OFFSET ?",
                params,
            ).fetchall()
        entries = [drama_data(row, row["id"] in favorite_ids) for row in rows]
        return payload(True, "OK", "读取成功", {"items": entries, "page": page, "pageSize": page_size})

    @app.get("/api/dramas/<int:drama_id>")
    @auth_required()
    def drama_detail(drama_id: int):
        with connect(active.fanlong_db_path) as db:
            row = db.execute("SELECT * FROM drama_archives WHERE id=? AND is_deleted=0", (drama_id,)).fetchone()
        if row is None:
            return payload(False, "DRAMA_NOT_FOUND", "剧情记录不存在", status=404)
        with connect(active.terminal_db_path) as terminal:
            favorite = terminal.execute("SELECT 1 FROM drama_favorites WHERE qq_id=? AND drama_id=?", (g.qq_id, drama_id)).fetchone() is not None
        return payload(True, "OK", "读取成功", drama_data(row, favorite, include_content=True))

    @app.post("/api/dramas/<int:drama_id>/favorite")
    @auth_required(write=True)
    def drama_favorite(drama_id: int):
        with connect(active.fanlong_db_path) as db:
            exists = db.execute("SELECT 1 FROM drama_archives WHERE id=? AND is_deleted=0", (drama_id,)).fetchone()
        if not exists:
            return payload(False, "DRAMA_NOT_FOUND", "剧情记录不存在", status=404)
        with connect(active.terminal_db_path) as db:
            db.execute("INSERT OR IGNORE INTO drama_favorites (qq_id, drama_id) VALUES (?, ?)", (g.qq_id, drama_id))
        return payload(True, "OK", "已收藏", {"favorite": True})

    @app.delete("/api/dramas/<int:drama_id>/favorite")
    @auth_required(write=True)
    def drama_unfavorite(drama_id: int):
        with connect(active.terminal_db_path) as db:
            db.execute("DELETE FROM drama_favorites WHERE qq_id=? AND drama_id=?", (g.qq_id, drama_id))
        return payload(True, "OK", "已取消收藏", {"favorite": False})

    @app.post("/api/dramas/<int:drama_id>/share")
    @auth_required(write=True)
    def drama_share(drama_id: int):
        with connect(active.fanlong_db_path) as db:
            exists = db.execute("SELECT 1 FROM drama_archives WHERE id=? AND is_deleted=0", (drama_id,)).fetchone()
            settings_rows = db.execute("SELECT key, value FROM game_config WHERE key IN ('drama_public_base_url', 'drama_public_secret')").fetchall()
        if not exists:
            return payload(False, "DRAMA_NOT_FOUND", "剧情记录不存在", status=404)
        values = {row["key"]: str(row["value"] or "") for row in settings_rows}
        base = values.get("drama_public_base_url", "").strip()
        secret = values.get("drama_public_secret", "").strip()
        if not base or not secret:
            return payload(False, "SHARE_DISABLED", "分享功能暂不可用", status=503)
        signature = hmac.new(secret.encode("utf-8"), str(drama_id).encode("utf-8"), hashlib.sha256).hexdigest()
        return payload(True, "OK", "分享链接已生成", {"url": f"{base}?id={drama_id}&sig={signature}"})

    def idempotency_key() -> str:
        return request.headers.get("Idempotency-Key", "").strip()

    @app.get("/api/daily")
    @auth_required()
    def daily_get():
        return payload(True, "OK", "读取成功", daily_state(active.fanlong_db_path, g.qq_id))

    @app.get("/api/daily/logs")
    @auth_required()
    def daily_logs():
        state = daily_state(active.fanlong_db_path, g.qq_id)
        return payload(True, "OK", "读取成功", {"date": state["date"], "logs": state["logs"]})

    @app.post("/api/daily/signin")
    @auth_required(write=True)
    def daily_signin_route():
        result = daily_signin(active.fanlong_db_path, g.qq_id, idempotency_key())
        audit(g.qq_id, "daily.signin", result["batchId"], "success")
        return payload(True, "OK", "签到成功", result)

    @app.post("/api/daily/train")
    @auth_required(write=True)
    def daily_train_route():
        result = daily_train(active.fanlong_db_path, g.qq_id, idempotency_key())
        audit(g.qq_id, "daily.train", result["batchId"], "success")
        return payload(True, "OK", "训练完成", result)

    @app.post("/api/daily/blind-box")
    @auth_required(write=True)
    def daily_blind_box_route():
        result = daily_blind_box(active.fanlong_db_path, g.qq_id, int(request_json().get("count", 1)), idempotency_key())
        audit(g.qq_id, "daily.blind_box", result["batchId"], "success")
        return payload(True, "OK", "盲盒开启完成", result)

    @app.get("/api/avatars/<file_key>")
    def avatar_file(file_key: str):
        if not file_key.endswith(".webp") or any(part in file_key for part in ("/", "\\", "..")):
            return payload(False, "NOT_FOUND", "头像不存在", status=404)
        return send_from_directory(active.upload_dir, file_key, mimetype="image/webp", max_age=3600)

    @app.post("/api/me/avatar")
    @auth_required(write=True)
    def avatar_upload():
        if request.content_length and request.content_length > 5 * 1024 * 1024:
            return payload(False, "FILE_TOO_LARGE", "头像文件不能超过5MB", status=413)
        uploaded = request.files.get("avatar")
        if uploaded is None:
            return payload(False, "INVALID_INPUT", "请选择头像文件", status=400)
        try:
            image = Image.open(io.BytesIO(uploaded.read()))
            image.verify()
            uploaded.stream.seek(0)
            image = Image.open(uploaded.stream)
            image = ImageOps.exif_transpose(image).convert("RGB")
            if image.width < 128 or image.height < 128 or image.width > 8000 or image.height > 8000:
                return payload(False, "INVALID_IMAGE_SIZE", "头像尺寸需在128至8000像素之间", status=400)
            image.thumbnail((640, 640), Image.Resampling.LANCZOS)
        except (UnidentifiedImageError, OSError, ValueError):
            return payload(False, "INVALID_IMAGE", "头像文件已损坏或格式不支持", status=400)

        file_key = f"{uuid.uuid4().hex}.webp"
        destination = active.upload_dir / file_key
        temporary = active.upload_dir / f".{file_key}.tmp"
        image.save(temporary, format="WEBP", quality=88, method=6)
        temporary.replace(destination)
        with transaction(active.terminal_db_path, immediate=True) as db:
            db.execute(
                """
                INSERT INTO user_avatars (qq_id, file_key) VALUES (?, ?)
                ON CONFLICT(qq_id) DO UPDATE SET file_key=excluded.file_key, updated_at=CURRENT_TIMESTAMP
                """,
                (g.qq_id, file_key),
            )
        audit(g.qq_id, "avatar.upload", file_key, "success")
        return payload(True, "OK", "头像已更新", {"avatarUrl": f"/api/avatars/{file_key}"})

    @app.get("/api/social/search")
    @auth_required()
    def social_search():
        query = request.args.get("q", "").strip()
        if not query:
            return payload(False, "INVALID_INPUT", "请输入玩家姓名、UID或QQ号", status=400)
        with connect(active.fanlong_db_path) as db:
            user = db.execute(
                "SELECT id, uid, name FROM users WHERE name=? OR id=? OR CAST(uid AS TEXT)=? LIMIT 1",
                (query, query, query),
            ).fetchone()
        if user is None:
            return payload(False, "PLAYER_NOT_FOUND", "未找到该玩家", status=404)
        return payload(True, "OK", "已找到玩家", {"id": user["id"], "uid": user["uid"], "name": user["name"], "avatarUrl": avatar_url(user["id"])})

    @app.get("/api/social/users/<target_id>")
    @auth_required()
    def social_profile(target_id: str):
        with connect(active.fanlong_db_path) as db:
            user = db.execute("SELECT * FROM users WHERE id=? OR CAST(uid AS TEXT)=? LIMIT 1", (target_id, target_id)).fetchone()
            if user is None:
                return payload(False, "PLAYER_NOT_FOUND", "未找到该玩家", status=404)
            fields = visible_profile(db, user)
        return payload(
            True,
            "OK",
            "读取成功",
            {"name": user["name"], "avatarUrl": avatar_url(user["id"]), "profile": fields},
        )

    @app.post("/api/social/transfer-currency")
    @auth_required(write=True)
    def social_transfer_currency():
        body = request_json()
        try:
            amount = int(body.get("amount", 0))
        except (TypeError, ValueError):
            amount = 0
        result = transfer_currency(
            active.fanlong_db_path,
            g.qq_id,
            str(body.get("targetId", "")).strip(),
            str(body.get("currency", "yuCoin")),
            amount,
            idempotency_key(),
        )
        audit(g.qq_id, "social.transfer_currency", result["target"]["id"], "success")
        return payload(True, "OK", "赠送成功", result)

    @app.post("/api/social/transfer-item")
    @auth_required(write=True)
    def social_transfer_item():
        body = request_json()
        try:
            amount = int(body.get("amount", 0))
        except (TypeError, ValueError):
            amount = 0
        result = transfer_item(
            active.fanlong_db_path,
            g.qq_id,
            str(body.get("targetId", "")).strip(),
            str(body.get("item", "")),
            amount,
            idempotency_key(),
        )
        audit(g.qq_id, "social.transfer_item", result["target"]["id"], "success")
        return payload(True, "OK", "赠送成功", result)

    @app.get("/api/summon")
    @auth_required()
    def summon_overview():
        result = summon_state(active.fanlong_db_path, g.qq_id)
        result["catalogSize"] = len(summon_catalog())
        return payload(True, "OK", "读取成功", result)

    @app.post("/api/summon/draw")
    @auth_required(write=True)
    def summon_draw_route():
        body = request_json()
        try:
            count = int(body.get("count", 1))
        except (TypeError, ValueError):
            count = 0
        result = summon_draw(active.fanlong_db_path, g.qq_id, count, summon_catalog(), idempotency_key())
        audit(g.qq_id, "summon.draw", str(count), "success")
        return payload(True, "OK", "召集完成", result)

    @app.errorhandler(404)
    def not_found(_error):
        return payload(False, "NOT_FOUND", "接口不存在", status=404)

    @app.errorhandler(GameError)
    def game_error(error: GameError):
        return payload(False, error.code, error.message, status=error.status)

    @app.errorhandler(Exception)
    def unexpected(error):
        app.logger.exception("request failed: %s", error)
        return payload(False, "INTERNAL_ERROR", "服务暂时不可用", status=500)

    return app


if __name__ == "__main__":
    from waitress import serve

    serve(create_app(), host="127.0.0.1", port=5002, threads=8)
