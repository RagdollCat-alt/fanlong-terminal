from __future__ import annotations

import json
import io
import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from app import create_app
from config import Settings
from PIL import Image


class AuthAndProfileTest(unittest.TestCase):
    def setUp(self):
        self.temp_path = Path(tempfile.mkdtemp())
        root = self.temp_path
        game_db = root / "fanlong.db"
        terminal_db = root / "terminal.db"
        uploads = root / "uploads"
        with sqlite3.connect(game_db) as db:
            db.executescript(
                """
                CREATE TABLE users (
                    id TEXT PRIMARY KEY, uid INTEGER UNIQUE, name TEXT,
                    currency TEXT, profile TEXT, limits TEXT, created_at TEXT
                );
                CREATE TABLE game_terms (
                    key TEXT PRIMARY KEY, text TEXT, category TEXT,
                    is_hidden INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0
                );
                CREATE TABLE user_stats (
                    user_id TEXT PRIMARY KEY, stat_face INTEGER DEFAULT 0, stat_charm INTEGER DEFAULT 0,
                    stat_intel INTEGER DEFAULT 0, stat_biz INTEGER DEFAULT 0, stat_talk INTEGER DEFAULT 0,
                    stat_body INTEGER DEFAULT 0, stat_art INTEGER DEFAULT 0, stat_obed INTEGER DEFAULT 0
                );
                CREATE TABLE user_bag (user_id TEXT, item_name TEXT, count INTEGER, PRIMARY KEY(user_id, item_name));
                CREATE TABLE user_equip (
                    user_id TEXT PRIMARY KEY, hair TEXT, top1 TEXT, top2 TEXT, bottom1 TEXT, bottom2 TEXT,
                    head TEXT, neck TEXT, inner1 TEXT, inner2 TEXT, acc1 TEXT, acc2 TEXT, acc3 TEXT,
                    acc4 TEXT, acc5 TEXT, title TEXT
                );
                CREATE TABLE items (
                    name TEXT PRIMARY KEY, price INTEGER DEFAULT 0, currency TEXT DEFAULT 'yuCoin',
                    type TEXT, slot TEXT, desc TEXT, stats TEXT, effect TEXT, is_selling INTEGER DEFAULT 1,
                    condition TEXT, max_hold INTEGER DEFAULT 0, compound_recipe TEXT, sub_type TEXT,
                    param TEXT, stock_qty INTEGER DEFAULT -1
                );
                CREATE TABLE item_instances (
                    instance_id INTEGER PRIMARY KEY AUTOINCREMENT, item_name TEXT NOT NULL,
                    user_id TEXT NOT NULL, currency_given INTEGER DEFAULT 0
                );
                CREATE TABLE game_config (key TEXT PRIMARY KEY, value, desc TEXT);
                CREATE TABLE drama_archives (
                    id INTEGER PRIMARY KEY, title TEXT, date_str TEXT, content TEXT, participants TEXT,
                    note TEXT, recorder TEXT, group_id TEXT, is_deleted INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            db.execute(
                "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                (
                    "10001",
                    20001,
                    "奚行简",
                    json.dumps({"yuCoin": 100, "reputation": 8}, ensure_ascii=False),
                    json.dumps({"年龄": "27", "职位": "执理事", "备注": "测试备注"}, ensure_ascii=False),
                    "{}",
                ),
            )
            db.executemany(
                "INSERT INTO game_terms (key, text, is_hidden, sort_order) VALUES (?, ?, ?, ?)",
                [
                    ("profile_name", "姓名", 1, 1),
                    ("profile_age", "年龄", 1, 2),
                    ("profile_job", "职位", 1, 3),
                    ("profile_note", "备注", 1, 4),
                    ("profile_secret", "隐藏字段", 0, 5),
                ],
            )
            db.execute("INSERT INTO user_stats VALUES ('10001', 10, 10, 10, 10, 10, 10, 10, 10)")
            db.execute(
                "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
                ("10002", 20002, "虞景", json.dumps({"yuCoin": 5, "reputation": 1}), "{}", "{}"),
            )
            db.execute("INSERT INTO items (name, type, sub_type) VALUES ('幸运碎片', 'consumable', 'normal')")
            db.execute("INSERT INTO items (name, type, sub_type, effect) VALUES ('形体课', 'consumable', 'normal', ?)", (json.dumps({"体能": 2}, ensure_ascii=False),))
            db.execute("INSERT INTO items (name, type, sub_type, effect, param) VALUES ('自选礼包', 'consumable', 'optional_pack', ?, ?)", (json.dumps({"amount": 5}), json.dumps(["颜值", "魅力"], ensure_ascii=False)))
            db.execute("INSERT INTO items (name, type, slot, stats) VALUES ('测试大衣', 'equip', 'top', ?)", (json.dumps({"魅力": 3}, ensure_ascii=False),))
            db.execute("INSERT INTO items (name, type, slot, stats) VALUES ('旧衣', 'equip', 'top', '{}')")
            db.execute("INSERT INTO items (name, type, slot, stats) VALUES ('测试徽章', 'equip', 'accessory', '{}')")
            db.execute("INSERT INTO user_bag VALUES ('10001', '幸运碎片', 3)")
            db.execute("INSERT INTO user_bag VALUES ('10001', '形体课', 2)")
            db.execute("INSERT INTO user_bag VALUES ('10001', '自选礼包', 1)")
            db.execute("INSERT INTO user_bag VALUES ('10001', '测试大衣', 1)")
            db.execute("INSERT INTO user_bag VALUES ('10001', '测试徽章', 1)")
            db.execute("INSERT INTO user_equip (user_id, top1, acc1, acc2, acc3, acc4) VALUES ('10001', '旧衣', '旧配饰1', '旧配饰2', '旧配饰3', '旧配饰4')")
            db.execute("INSERT INTO drama_archives (id, title, date_str, content, participants, note, recorder) VALUES (1, '测试戏录', '虞历一月', '第一段\n第二段', '奚行简、虞景', '测试备注', '管理员')")
            db.executemany(
                "INSERT INTO game_config (key, value) VALUES (?, ?)",
                [
                    ("signin_reward_min", 5), ("signin_reward_max", 5),
                    ("daily_train_limit", 2), ("stat_cap", 500),
                    ("daily_box_limit", 10), ("box_cost", 4),
                    ("box_reward_min", -2), ("box_reward_max", -2),
                    ("box_fragment_name", "幸运碎片"), ("box_fragment_rate", 0),
                    ("transfer_enabled", 1), ("transfer_daily_limit", 20),
                    ("transfer_monthly_ratio", 50), ("transfer_monthly_min_limit", 100),
                    ("exchange_rate", 200), ("transfer_cleanup_blocklist", ""),
                    ("drama_public_base_url", "https://web.rpg0707.com/drama.html"),
                    ("drama_public_secret", "test-secret"),
                ],
            )
            for migration in sorted((SERVER_DIR / "migrations").glob("*.sql")):
                db.executescript(migration.read_text(encoding="utf-8"))
        settings = Settings(
            fanlong_db_path=game_db,
            terminal_db_path=terminal_db,
            upload_dir=uploads,
            cookie_secure=False,
            session_days=7,
            testing=True,
        )
        self.app = create_app(settings)
        self.app.testing = True
        self.client = self.app.test_client()

    def tearDown(self):
        self.client._context_stack.close()
        shutil.rmtree(self.temp_path, ignore_errors=True)

    def csrf(self) -> str:
        cookie = self.client.get_cookie("fanlong_csrf")
        self.assertIsNotNone(cookie)
        return cookie.value

    def test_first_password_is_atomic_and_profile_is_dynamic(self):
        response = self.client.post("/api/auth/initialize", json={"qq": "10001", "password": "strong-pass-1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["code"], "ACCOUNT_CREATED")

        duplicate = self.client.post("/api/auth/initialize", json={"qq": "10001", "password": "different-pass"})
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.json["code"], "ACCOUNT_EXISTS")

        me = self.client.get("/api/me")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json["data"]["currency"]["yuCoin"], 100)
        self.assertEqual(
            [field["label"] for field in me.json["data"]["profile"]],
            ["姓名", "年龄", "职位", "备注"],
        )

        profile = self.client.get("/api/social/users/10001")
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.json["data"]["profile"][-1]["value"], "测试备注")

    def test_auth_accepts_name_or_uid_and_resolves_real_player(self):
        initialized = self.client.post("/api/auth/initialize", json={"qq": "奚行简", "password": "strong-pass-1"})
        self.assertEqual(initialized.status_code, 200)

        me = self.client.get("/api/me")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json["data"]["qq"], "10001")
        self.assertEqual(me.json["data"]["name"], "奚行简")

        logout = self.client.post("/api/auth/logout", headers={"X-CSRF-Token": self.csrf()})
        self.assertEqual(logout.status_code, 200)

        login = self.client.post("/api/auth/login", json={"qq": "20001", "password": "strong-pass-1"})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(self.client.get("/api/me").json["data"]["name"], "奚行简")

    def test_write_route_requires_csrf_and_login_survives_logout(self):
        self.client.post("/api/auth/initialize", json={"qq": "10001", "password": "strong-pass-1"})
        denied = self.client.post("/api/auth/logout")
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.json["code"], "CSRF_INVALID")

        logout = self.client.post("/api/auth/logout", headers={"X-CSRF-Token": self.csrf()})
        self.assertEqual(logout.status_code, 200)
        self.assertFalse(self.client.get("/api/auth/status").json["data"]["authenticated"])

        bad_login = self.client.post("/api/auth/login", json={"qq": "10001", "password": "wrong-pass-1"})
        self.assertEqual(bad_login.status_code, 401)
        good_login = self.client.post("/api/auth/login", json={"qq": "10001", "password": "strong-pass-1"})
        self.assertEqual(good_login.status_code, 200)

    def test_allowed_origin_receives_credentialed_cors_headers(self):
        settings = self.app.config["TERMINAL_SETTINGS"]
        object.__setattr__(settings, "allowed_origins", ("https://terminal.rpg0707.com",))
        response = self.client.options(
            "/api/auth/login",
            headers={
                "Origin": "https://terminal.rpg0707.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "https://terminal.rpg0707.com")
        self.assertEqual(response.headers.get("Access-Control-Allow-Credentials"), "true")
        self.assertIn("DELETE", response.headers.get("Access-Control-Allow-Methods", ""))
        self.assertIn("Authorization", response.headers.get("Access-Control-Allow-Headers", ""))

        blocked = self.client.get("/api/health", headers={"Origin": "https://example.com"})
        self.assertIsNone(blocked.headers.get("Access-Control-Allow-Origin"))

    def test_bearer_session_survives_without_cross_site_cookies(self):
        initialized = self.client.post(
            "/api/auth/initialize",
            json={"qq": "10001", "password": "strong-pass-1"},
        )
        session_token = initialized.json["data"]["sessionToken"]
        csrf_token = initialized.json["data"]["csrfToken"]
        self.client.delete_cookie("fanlong_session")
        self.client.delete_cookie("fanlong_csrf")

        headers = {"Authorization": f"Bearer {session_token}"}
        self.assertTrue(self.client.get("/api/auth/status", headers=headers).json["data"]["authenticated"])
        logout = self.client.post(
            "/api/auth/logout",
            headers={**headers, "X-CSRF-Token": csrf_token},
        )
        self.assertEqual(logout.status_code, 200)
        self.assertFalse(self.client.get("/api/auth/status", headers=headers).json["data"]["authenticated"])

    def test_avatar_upload_is_reencoded_and_mapped(self):
        self.client.post("/api/auth/initialize", json={"qq": "10001", "password": "strong-pass-1"})
        image_bytes = io.BytesIO()
        Image.new("RGB", (320, 320), (25, 35, 65)).save(image_bytes, format="PNG")
        image_bytes.seek(0)
        response = self.client.post(
            "/api/me/avatar",
            data={"avatar": (image_bytes, "avatar.png")},
            headers={"X-CSRF-Token": self.csrf()},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["data"]["avatarUrl"].endswith(".webp"))
        avatar = self.client.get(response.json["data"]["avatarUrl"])
        self.assertEqual(avatar.status_code, 200)
        self.assertEqual(avatar.content_type, "image/webp")
        avatar.close()

    def test_daily_writes_each_draw_and_reuses_idempotent_result(self):
        self.client.post("/api/auth/initialize", json={"qq": "10001", "password": "strong-pass-1"})
        headers = {"X-CSRF-Token": self.csrf(), "Idempotency-Key": "signin-once"}
        first = self.client.post("/api/daily/signin", headers=headers)
        duplicate = self.client.post("/api/daily/signin", headers=headers)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json["data"]["batchId"], duplicate.json["data"]["batchId"])

        blind = self.client.post(
            "/api/daily/blind-box",
            json={"count": 10},
            headers={"X-CSRF-Token": self.csrf(), "Idempotency-Key": "blind-ten-once"},
        )
        self.assertEqual(blind.status_code, 200)
        self.assertEqual(len(blind.json["data"]["results"]), 10)
        self.assertEqual(blind.json["data"]["totalReward"], -20)
        state = self.client.get("/api/daily").json["data"]
        self.assertEqual(state["blindBox"]["used"], 10)
        self.assertEqual(len([log for log in state["logs"] if log["type"] == "blind_box"]), 10)
        self.assertEqual(state["currency"]["yuCoin"], 45)

    def test_social_currency_and_item_transfer_are_transactional(self):
        self.client.post("/api/auth/initialize", json={"qq": "10001", "password": "strong-pass-1"})
        currency = self.client.post(
            "/api/social/transfer-currency",
            json={"targetId": "10002", "currency": "yuCoin", "amount": 10},
            headers={"X-CSRF-Token": self.csrf(), "Idempotency-Key": "currency-once"},
        )
        self.assertEqual(currency.status_code, 200)
        self.assertEqual(currency.json["data"]["senderBalance"], 90)
        duplicate = self.client.post(
            "/api/social/transfer-currency",
            json={"targetId": "10002", "currency": "yuCoin", "amount": 10},
            headers={"X-CSRF-Token": self.csrf(), "Idempotency-Key": "currency-once"},
        )
        self.assertEqual(duplicate.json["data"]["senderBalance"], 90)

        item = self.client.post(
            "/api/social/transfer-item",
            json={"targetId": "10002", "item": "幸运碎片", "amount": 2},
            headers={"X-CSRF-Token": self.csrf(), "Idempotency-Key": "item-once"},
        )
        self.assertEqual(item.status_code, 200)
        self.assertEqual(item.json["data"]["senderRemaining"], 1)

    def test_inventory_wardrobe_and_drama_actions_use_real_state(self):
        self.client.post("/api/auth/initialize", json={"qq": "10001", "password": "strong-pass-1"})
        base_headers = {"X-CSRF-Token": self.csrf()}

        used = self.client.post(
            "/api/inventory/use",
            json={"item": "形体课", "count": 2},
            headers={**base_headers, "Idempotency-Key": "use-body-course"},
        )
        self.assertEqual(used.status_code, 200)
        self.assertEqual(used.json["data"]["remaining"], 0)
        self.assertEqual(used.json["data"]["changes"][0]["after"], 14)

        optional = self.client.post(
            "/api/inventory/use",
            json={"item": "自选礼包", "count": 1, "choice": "颜值"},
            headers={**base_headers, "Idempotency-Key": "use-optional-pack"},
        )
        self.assertEqual(optional.status_code, 200)
        self.assertEqual(optional.json["data"]["changes"][0]["after"], 15)

        equipped = self.client.post(
            "/api/wardrobe/equip",
            json={"item": "测试大衣"},
            headers={**base_headers, "Idempotency-Key": "equip-coat"},
        )
        self.assertEqual(equipped.status_code, 200)
        self.assertEqual(equipped.json["data"]["slot"], "top2")
        self.assertIsNone(equipped.json["data"]["replaced"])
        wardrobe = self.client.get("/api/wardrobe").json["data"]
        coat = next(item for item in wardrobe["items"] if item["name"] == "测试大衣")
        self.assertEqual(coat["slotGroup"], "top")
        self.assertEqual(coat["equippedSlots"], ["top2"])

        accessory = self.client.post(
            "/api/wardrobe/equip",
            json={"item": "测试徽章"},
            headers={**base_headers, "Idempotency-Key": "equip-accessory"},
        )
        self.assertEqual(accessory.status_code, 200)
        self.assertEqual(accessory.json["data"]["slot"], "acc5")

        unequipped = self.client.post(
            "/api/wardrobe/unequip",
            json={"item": "测试大衣", "slot": "top2"},
            headers={**base_headers, "Idempotency-Key": "unequip-coat"},
        )
        self.assertEqual(unequipped.status_code, 200)
        self.assertEqual(unequipped.json["data"]["owned"], 1)

        detail = self.client.get("/api/dramas/1")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json["data"]["content"], "第一段\n第二段")
        favorite = self.client.post("/api/dramas/1/favorite", headers=base_headers)
        self.assertTrue(favorite.json["data"]["favorite"])
        favorite_list = self.client.get("/api/dramas?filter=favorite").json["data"]["items"]
        self.assertEqual([item["id"] for item in favorite_list], [1])
        unfavorite = self.client.delete("/api/dramas/1/favorite", headers=base_headers)
        self.assertFalse(unfavorite.json["data"]["favorite"])
        favorite_list = self.client.get("/api/dramas?filter=favorite").json["data"]["items"]
        self.assertEqual(favorite_list, [])
        share = self.client.post("/api/dramas/1/share", headers=base_headers)
        self.assertIn("https://web.rpg0707.com/drama.html?id=1&sig=", share.json["data"]["url"])

    def test_summon_draw_persists_cards_and_ten_draw_has_sr_or_better(self):
        self.client.post("/api/auth/initialize", json={"qq": "10001", "password": "strong-pass-1"})
        response = self.client.post(
            "/api/summon/draw",
            json={"count": 10},
            headers={"X-CSRF-Token": self.csrf(), "Idempotency-Key": "summon-ten-once"},
        )
        self.assertEqual(response.status_code, 200)
        results = response.json["data"]["results"]
        self.assertEqual(len(results), 10)
        self.assertTrue(any(card["rarity"] in {"SR", "SSR"} for card in results))
        self.assertEqual(response.json["data"]["cost"], 20)
        self.assertEqual(response.json["data"]["balance"], 80)
        overview = self.client.get("/api/summon")
        self.assertEqual(overview.json["data"]["prices"], {"single": 2, "ten": 20})
        self.assertEqual(overview.json["data"]["rates"], {"R": 80, "SR": 19, "SSR": 1})
        self.assertGreater(len(overview.json["data"]["cards"]), 0)
        self.assertEqual(len(overview.json["data"]["history"]), 10)


if __name__ == "__main__":
    unittest.main()
