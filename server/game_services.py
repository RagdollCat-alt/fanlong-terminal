from __future__ import annotations

import json
import math
import random
import re
import uuid
from datetime import datetime
from pathlib import Path

from db import connect, json_object, transaction


class GameError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


RNG = random.SystemRandom()
STAT_FALLBACK = ["stat_face", "stat_charm", "stat_intel", "stat_biz", "stat_talk", "stat_body", "stat_art", "stat_obed"]
EQUIP_SINGLE_SLOTS = {"hair", "head", "neck", "title"}
EQUIP_SLOT_GROUPS = {
    "top": ["top1", "top2"],
    "bottom": ["bottom1", "bottom2"],
    "interior": ["inner1", "inner2"],
    "accessory": ["acc1", "acc2", "acc3", "acc4", "acc5"],
}
EQUIP_EXACT_SLOTS = {
    "hair", "top1", "top2", "bottom1", "bottom2", "head", "neck",
    "inner1", "inner2", "acc1", "acc2", "acc3", "acc4", "acc5", "title",
}
EQUIP_SLOT_DISPLAY_GROUPS = {
    "top1": "top", "top2": "top",
    "bottom1": "bottom", "bottom2": "bottom",
    "inner1": "interior", "inner2": "interior",
    "acc1": "accessory", "acc2": "accessory", "acc3": "accessory", "acc4": "accessory", "acc5": "accessory",
}
EQUIP_LEGACY_SLOT_FALLBACKS = {"top1": "top", "bottom1": "bottom"}
LOCKED_EQUIP_ITEMS = {"家徽烙印•罪"}
STAT_DEFAULT_LABELS = {
    "stat_face": "颜值", "stat_charm": "魅力", "stat_intel": "智力", "stat_biz": "商业",
    "stat_talk": "口才", "stat_body": "体能", "stat_art": "才艺", "stat_obed": "服从/威慑",
}
LUCKY_FRAGMENT_NAME = "幸运碎片"
LUCKY_PACK_NAME = "幸运礼包"
LUCKY_PACK_COST = 5
LUCKY_PACK_STAT_AMOUNT = 5
LUCKY_PACK_CHOICES = ["颜值", "魅力", "智力", "商业", "口才", "体能", "才艺", "威慑"]


def equip_slot_group(slot: str) -> str:
    return EQUIP_SLOT_DISPLAY_GROUPS.get(str(slot or ""), str(slot or ""))


def _equip_value(equip, slot: str):
    if slot in equip.keys():
        return equip[slot]
    fallback = EQUIP_LEGACY_SLOT_FALLBACKS.get(slot)
    if fallback and fallback in equip.keys():
        return equip[fallback]
    return None


def _equip_db_slot(equip, slot: str) -> str:
    if slot in equip.keys():
        return slot
    fallback = EQUIP_LEGACY_SLOT_FALLBACKS.get(slot)
    if fallback and fallback in equip.keys():
        return fallback
    return slot


def _available_equip_slots(equip) -> set[str]:
    keys = set(equip.keys())
    slots = {slot for slot in EQUIP_EXACT_SLOTS if slot in keys}
    for slot, fallback in EQUIP_LEGACY_SLOT_FALLBACKS.items():
        if slot not in slots and fallback in keys:
            slots.add(slot)
    return slots


def _config(db, key: str, default, cast=int):
    row = db.execute("SELECT value FROM game_config WHERE key=?", (key,)).fetchone()
    try:
        return cast(row["value"]) if row else default
    except (TypeError, ValueError):
        return default


def _term(db, key: str, default: str) -> str:
    row = db.execute("SELECT text FROM game_terms WHERE key=?", (key,)).fetchone()
    return str(row["text"] or default) if row else default


def _dates() -> tuple[str, str]:
    now = datetime.now()
    return now.strftime("%Y-%m-%d"), now.strftime("%a %b %d %Y")


def _load_user(db, qq_id: str):
    row = db.execute("SELECT * FROM users WHERE id=?", (qq_id,)).fetchone()
    if row is None:
        raise GameError("PLAYER_NOT_FOUND", "角色档案不存在", 404)
    return row, json_object(row["currency"]), json_object(row["limits"])


def _same_term(left: object, right: object) -> bool:
    return str(left or "").replace("_", "/").strip() == str(right or "").replace("_", "/").strip()


def _stat_labels(db) -> dict[str, str]:
    labels = STAT_DEFAULT_LABELS.copy()
    rows = db.execute("SELECT key, text FROM game_terms WHERE key LIKE 'stat_%'").fetchall()
    for row in rows:
        if row["key"] in labels and row["text"]:
            labels[row["key"]] = row["text"]
    return labels


def _stat_key(db, value: object) -> str | None:
    for key, label in _stat_labels(db).items():
        if value == key or _same_term(value, label) or _same_term(value, STAT_DEFAULT_LABELS[key]):
            return key
        if key == "stat_obed" and str(value or "") in {"服从", "威慑"}:
            return key
    return None


def _apply_bonus_map(db, qq_id: str, currency: dict, bonus_map: dict, count: int = 1) -> list[dict]:
    changes: list[dict] = []
    stats = db.execute("SELECT * FROM user_stats WHERE user_id=?", (qq_id,)).fetchone()
    labels = _stat_labels(db)
    cap = _config(db, "stat_cap", 500)
    for raw_key, raw_value in (bonus_map or {}).items():
        if not isinstance(raw_value, (int, float)):
            continue
        amount = int(raw_value * count)
        if raw_key in {"yuCoin", "yuyuan", "虞元", "金币"}:
            before = int(currency.get("yuCoin", 0) or 0)
            currency["yuCoin"] = before + amount
            changes.append({"type": "currency", "key": "yuCoin", "label": "虞元", "amount": amount, "before": before, "after": currency["yuCoin"]})
            continue
        if raw_key in {"reputation", "名誉"}:
            before = int(currency.get("reputation", 0) or 0)
            currency["reputation"] = before + amount
            changes.append({"type": "currency", "key": "reputation", "label": "名誉", "amount": amount, "before": before, "after": currency["reputation"]})
            continue
        key = _stat_key(db, raw_key)
        if not key or stats is None:
            continue
        before = int(stats[key] or 0)
        after = before + amount
        if amount > 0:
            after = min(cap, after)
        actual = after - before
        db.execute(f"UPDATE user_stats SET {key}=? WHERE user_id=?", (after, qq_id))
        changes.append({"type": "stat", "key": key, "label": labels[key], "amount": actual, "before": before, "after": after})
    return changes


def _cached_operation(db, key: str, qq_id: str, action: str):
    if not key or len(key) > 120:
        raise GameError("IDEMPOTENCY_KEY_REQUIRED", "缺少有效的防重复提交标识", 400)
    row = db.execute(
        "SELECT response_json FROM web_operation_records WHERE idempotency_key=? AND user_id=? AND action=?",
        (key, qq_id, action),
    ).fetchone()
    return json.loads(row["response_json"]) if row else None


def _store_operation(db, key: str, qq_id: str, action: str, result: dict) -> None:
    db.execute(
        "INSERT INTO web_operation_records (idempotency_key, user_id, action, response_json) VALUES (?, ?, ?, ?)",
        (key, qq_id, action, json.dumps(result, ensure_ascii=False)),
    )


def daily_state(path: Path, qq_id: str) -> dict:
    action_date, robot_date = _dates()
    with connect(path) as db:
        _row, currency, limits = _load_user(db, qq_id)
        sign_used = limits.get("lastSign") == robot_date
        train_used = int(limits.get("trainCount", 0) or 0) if limits.get("lastTrain") == robot_date else 0
        box_used = int(limits.get("luckyBagCount", 0) or 0) if limits.get("lastLuckyBag") == robot_date else 0
        logs = db.execute(
            "SELECT * FROM daily_action_logs WHERE user_id=? AND action_date=? ORDER BY id",
            (qq_id, action_date),
        ).fetchall()
        return {
            "date": action_date,
            "currency": currency,
            "signin": {"used": int(sign_used), "limit": 1},
            "training": {"used": train_used, "limit": _config(db, "daily_train_limit", 2)},
            "blindBox": {"used": box_used, "limit": _config(db, "daily_box_limit", 10), "cost": _config(db, "box_cost", 4)},
            "logs": [
                {
                    "id": row["id"], "type": row["action_type"], "batchId": row["batch_id"],
                    "sequence": row["sequence_no"], "cost": row["cost"],
                    "reward": json_object(row["reward_json"]), "createdAt": row["created_at"],
                }
                for row in logs
            ],
        }


def daily_signin(path: Path, qq_id: str, idempotency_key: str) -> dict:
    action_date, robot_date = _dates()
    with transaction(path, immediate=True) as db:
        cached = _cached_operation(db, idempotency_key, qq_id, "daily.signin")
        if cached:
            return cached
        row, currency, limits = _load_user(db, qq_id)
        if limits.get("lastSign") == robot_date:
            raise GameError("DAILY_LIMIT_REACHED", "今日已经签到")
        reward = RNG.randint(_config(db, "signin_reward_min", 0), _config(db, "signin_reward_max", 10))
        reward_type = _term(db, "config_signin_currency", "yuCoin")
        currency_key = "reputation" if reward_type == "reputation" else "yuCoin"
        currency[currency_key] = int(currency.get(currency_key, 0) or 0) + reward
        limits["lastSign"] = robot_date
        db.execute("UPDATE users SET currency=?, limits=? WHERE id=?", (json.dumps(currency, ensure_ascii=False), json.dumps(limits, ensure_ascii=False), qq_id))
        batch = uuid.uuid4().hex
        reward_data = {"currency": currency_key, "amount": reward, "balance": currency[currency_key]}
        db.execute(
            "INSERT INTO daily_action_logs (user_id, action_date, action_type, batch_id, reward_json) VALUES (?, ?, 'signin', ?, ?)",
            (qq_id, action_date, batch, json.dumps(reward_data, ensure_ascii=False)),
        )
        result = {"batchId": batch, "reward": reward_data, "state": {"used": 1, "limit": 1}, "currency": currency}
        _store_operation(db, idempotency_key, qq_id, "daily.signin", result)
        return result


def daily_train(path: Path, qq_id: str, idempotency_key: str) -> dict:
    action_date, robot_date = _dates()
    with transaction(path, immediate=True) as db:
        cached = _cached_operation(db, idempotency_key, qq_id, "daily.train")
        if cached:
            return cached
        _row, _currency, limits = _load_user(db, qq_id)
        if limits.get("lastTrain") != robot_date:
            limits["lastTrain"] = robot_date
            limits["trainCount"] = 0
        limit = _config(db, "daily_train_limit", 2)
        used = int(limits.get("trainCount", 0) or 0)
        if used >= limit:
            raise GameError("DAILY_LIMIT_REACHED", f"今日训练次数已达上限（{limit}次）")
        stat_rows = db.execute(
            "SELECT key, text FROM game_terms WHERE key LIKE 'stat_%' AND is_hidden=1 ORDER BY sort_order, rowid"
        ).fetchall()
        keys = [row["key"] for row in stat_rows] or STAT_FALLBACK
        labels = {row["key"]: row["text"] for row in stat_rows}
        key = RNG.choice(keys)
        stat = db.execute("SELECT * FROM user_stats WHERE user_id=?", (qq_id,)).fetchone()
        if stat is None:
            raise GameError("STATS_NOT_FOUND", "玩家属性数据不存在", 409)
        before = int(stat[key] or 0)
        cap = _config(db, "stat_cap", 500)
        changed = before < cap
        if changed:
            db.execute(f"UPDATE user_stats SET {key}={key}+1 WHERE user_id=?", (qq_id,))
        limits["trainCount"] = used + 1
        db.execute("UPDATE users SET limits=? WHERE id=?", (json.dumps(limits, ensure_ascii=False), qq_id))
        batch = uuid.uuid4().hex
        reward_data = {"statKey": key, "label": labels.get(key, key), "amount": 1 if changed else 0, "before": before, "after": before + (1 if changed else 0), "cap": cap}
        db.execute(
            "INSERT INTO daily_action_logs (user_id, action_date, action_type, batch_id, reward_json) VALUES (?, ?, 'training', ?, ?)",
            (qq_id, action_date, batch, json.dumps(reward_data, ensure_ascii=False)),
        )
        result = {"batchId": batch, "reward": reward_data, "state": {"used": used + 1, "limit": limit}}
        _store_operation(db, idempotency_key, qq_id, "daily.train", result)
        return result


def daily_blind_box(path: Path, qq_id: str, count: int, idempotency_key: str) -> dict:
    if count not in (1, 10):
        raise GameError("INVALID_INPUT", "盲盒次数只能为1或10")
    action_date, robot_date = _dates()
    action = f"daily.blind_box.{count}"
    with transaction(path, immediate=True) as db:
        cached = _cached_operation(db, idempotency_key, qq_id, action)
        if cached:
            return cached
        _row, currency, limits = _load_user(db, qq_id)
        if limits.get("lastLuckyBag") != robot_date:
            limits["lastLuckyBag"] = robot_date
            limits["luckyBagCount"] = 0
        limit = _config(db, "daily_box_limit", 10)
        used = int(limits.get("luckyBagCount", 0) or 0)
        if used + count > limit:
            raise GameError("DAILY_LIMIT_REACHED", f"今日盲盒剩余次数不足（{limit - used}/{limit}）")
        unit_cost = _config(db, "box_cost", 4)
        total_cost = unit_cost * count
        balance = int(currency.get("yuCoin", 0) or 0)
        if balance < total_cost:
            raise GameError("BALANCE_INSUFFICIENT", f"余额不足，需要{total_cost}虞元，当前{balance}虞元")
        currency["yuCoin"] = balance - total_cost
        reward_min = _config(db, "box_reward_min", -2)
        reward_max = max(reward_min, _config(db, "box_reward_max", 8))
        reward_type = _term(db, "config_box_currency", "yuCoin")
        reward_key = "reputation" if reward_type == "reputation" else "yuCoin"
        fragment_name = str(_config(db, "box_fragment_name", "幸运碎片", str))
        fragment_rate = float(_config(db, "box_fragment_rate", 15, float))
        item_exists = db.execute("SELECT 1 FROM items WHERE name=?", (fragment_name,)).fetchone() is not None
        batch = uuid.uuid4().hex
        results = []
        fragment_count = 0
        for sequence in range(1, count + 1):
            prize = RNG.randint(reward_min, reward_max)
            currency[reward_key] = int(currency.get(reward_key, 0) or 0) + prize
            if reward_key == "reputation":
                unit = "名誉"
                comment = "🎁 盲盒开启！"
                net = None
            else:
                unit = "虞元"
                net = prize - unit_cost
                if net >= 3:
                    comment = "✨ 欧皇附体！"
                elif net > 0:
                    comment = "小赚一笔。"
                elif net == 0:
                    comment = "保本不亏。"
                elif net >= -3:
                    comment = "小亏一点。"
                else:
                    comment = "😭 非酋"
            fragment = bool(item_exists and RNG.uniform(0, 100) <= fragment_rate)
            fragment_count += int(fragment)
            reward_data = {
                "currency": reward_key,
                "amount": prize,
                "unit": unit,
                "cost": unit_cost,
                "net": net,
                "comment": comment,
                "fragment": fragment_name if fragment else None,
                "fragmentName": fragment_name,
            }
            results.append(reward_data)
            db.execute(
                "INSERT INTO daily_action_logs (user_id, action_date, action_type, batch_id, sequence_no, cost, reward_json) VALUES (?, ?, 'blind_box', ?, ?, ?, ?)",
                (qq_id, action_date, batch, sequence, unit_cost, json.dumps(reward_data, ensure_ascii=False)),
            )
        if fragment_count:
            db.execute(
                """
                INSERT INTO user_bag (user_id, item_name, count) VALUES (?, ?, ?)
                ON CONFLICT(user_id, item_name) DO UPDATE SET count=count+excluded.count
                """,
                (qq_id, fragment_name, fragment_count),
            )
        limits["luckyBagCount"] = used + count
        db.execute("UPDATE users SET currency=?, limits=? WHERE id=?", (json.dumps(currency, ensure_ascii=False), json.dumps(limits, ensure_ascii=False), qq_id))
        result = {
            "batchId": batch, "count": count, "cost": total_cost, "results": results,
            "totalReward": sum(item["amount"] for item in results), "fragment": {"name": fragment_name, "count": fragment_count},
            "rewardCurrency": reward_key,
            "unit": "名誉" if reward_key == "reputation" else "虞元",
            "net": (sum(item["amount"] for item in results) - total_cost) if reward_key == "yuCoin" else None,
            "state": {"used": used + count, "limit": limit}, "currency": currency,
        }
        _store_operation(db, idempotency_key, qq_id, action, result)
        return result


def _config_enabled(db, key: str, default: bool = True) -> bool:
    value = str(_config(db, key, "1" if default else "0", str)).strip().lower()
    return value not in {"0", "false", "off", "no", "n", "否", "关闭"}


def _blocked_identifiers(value) -> set[str]:
    text = str(value or "").strip()
    if not text:
        return set()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return {str(item).strip() for item in parsed if str(item).strip()}
    except (TypeError, ValueError, json.JSONDecodeError):
        pass
    return {part for part in re.split(r"[,\n，、\s]+", text) if part}


def _check_transfer_common(db, sender, profile: dict) -> None:
    if not _config_enabled(db, "transfer_enabled", True):
        raise GameError("TRANSFER_DISABLED", "当前已关闭玩家转账与赠送功能", 403)
    blocked = _blocked_identifiers(_config(db, "transfer_cleanup_blocklist", "", str))
    identifiers = {str(sender["id"]), str(sender["uid"] or ""), str(sender["name"] or ""), str(profile.get("姓名", ""))}
    if blocked & {value for value in identifiers if value}:
        raise GameError("TRANSFER_BLOCKED", "当前KPI未达标，无法转出资产", 403)


def _prepare_transfer_limits(db, currency: dict, limits: dict) -> tuple[dict, int, int]:
    now = datetime.now()
    day = now.strftime("%Y-%m-%d")
    month = now.strftime("%Y-%m")
    exchange = max(1, _config(db, "exchange_rate", 1000))
    asset_value = max(0, int(currency.get("yuCoin", 0) or 0)) + max(0, int(currency.get("reputation", 0) or 0)) * exchange
    if limits.get("transfer_day") != day:
        limits["transfer_day"] = day
        limits["transfer_day_out_value"] = 0
    if limits.get("transfer_month") != month:
        limits["transfer_month"] = month
        limits["transfer_month_out_value"] = 0
        limits["transfer_month_base_value"] = asset_value
    limits.setdefault("transfer_month_base_value", asset_value)
    return limits, exchange, asset_value


def transfer_currency(path: Path, sender_id: str, target_id: str, currency_key: str, amount: int, idempotency_key: str) -> dict:
    if currency_key not in {"yuCoin", "reputation"} or amount <= 0:
        raise GameError("INVALID_INPUT", "赠送数量必须为正整数")
    if sender_id == target_id:
        raise GameError("INVALID_TARGET", "不能赠送给自己")
    action = f"social.transfer_currency.{currency_key}"
    with transaction(path, immediate=True) as db:
        cached = _cached_operation(db, idempotency_key, sender_id, action)
        if cached:
            return cached
        sender, sender_currency, sender_limits = _load_user(db, sender_id)
        target, target_currency, _target_limits = _load_user(db, target_id)
        _check_transfer_common(db, sender, json_object(sender["profile"]))
        sender_limits, exchange, _asset = _prepare_transfer_limits(db, sender_currency, sender_limits)
        transfer_value = amount * exchange if currency_key == "reputation" else amount
        daily_limit = _config(db, "transfer_daily_limit", 0)
        day_used = int(sender_limits.get("transfer_day_out_value", 0) or 0)
        if daily_limit > 0 and day_used + transfer_value > daily_limit:
            raise GameError("TRANSFER_DAILY_LIMIT", f"今日剩余可转出额度为{max(0, daily_limit - day_used)}等值虞元")
        ratio = float(_config(db, "transfer_monthly_ratio", 0, float))
        month_used = int(sender_limits.get("transfer_month_out_value", 0) or 0)
        if ratio > 0:
            monthly_limit = math.floor(int(sender_limits.get("transfer_month_base_value", 0) or 0) * ratio / 100)
            monthly_limit = max(monthly_limit, _config(db, "transfer_monthly_min_limit", 100))
            if month_used + transfer_value > monthly_limit:
                raise GameError("TRANSFER_MONTHLY_LIMIT", f"本月剩余可转出额度为{max(0, monthly_limit - month_used)}等值虞元")
        current = int(sender_currency.get(currency_key, 0) or 0)
        if current < amount:
            raise GameError("BALANCE_INSUFFICIENT", f"余额不足，当前仅有{current}")
        sender_currency[currency_key] = current - amount
        target_currency[currency_key] = int(target_currency.get(currency_key, 0) or 0) + amount
        sender_limits["transfer_day_out_value"] = day_used + transfer_value
        sender_limits["transfer_month_out_value"] = month_used + transfer_value
        db.execute("UPDATE users SET currency=?, limits=? WHERE id=?", (json.dumps(sender_currency, ensure_ascii=False), json.dumps(sender_limits, ensure_ascii=False), sender_id))
        db.execute("UPDATE users SET currency=? WHERE id=?", (json.dumps(target_currency, ensure_ascii=False), target_id))
        result = {"target": {"id": target["id"], "name": target["name"]}, "currency": currency_key, "amount": amount, "senderBalance": sender_currency[currency_key], "dailyRemaining": max(0, daily_limit - day_used - transfer_value) if daily_limit > 0 else None}
        _store_operation(db, idempotency_key, sender_id, action, result)
        return result


def transfer_item(path: Path, sender_id: str, target_id: str, item_name: str, amount: int, idempotency_key: str) -> dict:
    item_name = str(item_name or "").strip()
    if not item_name or amount <= 0:
        raise GameError("INVALID_INPUT", "请选择道具并填写正整数数量")
    if sender_id == target_id:
        raise GameError("INVALID_TARGET", "不能赠送给自己")
    with transaction(path, immediate=True) as db:
        cached = _cached_operation(db, idempotency_key, sender_id, "social.transfer_item")
        if cached:
            return cached
        sender, _currency, _limits = _load_user(db, sender_id)
        target, _target_currency, _target_limits = _load_user(db, target_id)
        _check_transfer_common(db, sender, json_object(sender["profile"]))
        bag = db.execute("SELECT count FROM user_bag WHERE user_id=? AND item_name=?", (sender_id, item_name)).fetchone()
        owned = int(bag["count"] or 0) if bag else 0
        if owned < amount:
            raise GameError("ITEM_INSUFFICIENT", f"道具数量不足，当前仅有{owned}件")
        db.execute("UPDATE user_bag SET count=count-? WHERE user_id=? AND item_name=?", (amount, sender_id, item_name))
        db.execute("DELETE FROM user_bag WHERE user_id=? AND item_name=? AND count<=0", (sender_id, item_name))
        db.execute(
            """
            INSERT INTO user_bag (user_id, item_name, count) VALUES (?, ?, ?)
            ON CONFLICT(user_id, item_name) DO UPDATE SET count=count+excluded.count
            """,
            (target_id, item_name, amount),
        )
        instances = db.execute(
            "SELECT instance_id FROM item_instances WHERE item_name=? AND user_id=? ORDER BY currency_given, instance_id LIMIT ?",
            (item_name, sender_id, amount),
        ).fetchall()
        for instance in instances:
            db.execute("UPDATE item_instances SET user_id=? WHERE instance_id=?", (target_id, instance["instance_id"]))
        result = {"target": {"id": target["id"], "name": target["name"]}, "item": item_name, "amount": amount, "senderRemaining": owned - amount}
        _store_operation(db, idempotency_key, sender_id, "social.transfer_item", result)
        return result


def _check_item_conditions(db, qq_id: str, currency: dict, conditions: dict) -> None:
    if not conditions:
        return
    stats = db.execute("SELECT * FROM user_stats WHERE user_id=?", (qq_id,)).fetchone()
    labels = {row["key"]: row["text"] for row in db.execute("SELECT key, text FROM game_terms WHERE key LIKE 'stat_%'").fetchall()}
    equip = db.execute("SELECT * FROM user_equip WHERE user_id=?", (qq_id,)).fetchone()
    equipped = [equip[key] for key in equip.keys() if key != "user_id" and equip[key]] if equip else []
    bonuses: dict[str, int] = {}
    for name in equipped:
        row = db.execute("SELECT stats FROM items WHERE name=?", (name,)).fetchone()
        for key, value in json_object(row["stats"] if row else None).items():
            if isinstance(value, (int, float)):
                bonuses[key] = bonuses.get(key, 0) + int(value)
    for key, required in conditions.items():
        required = int(required)
        if key == "reputation":
            current = int(currency.get("reputation", 0) or 0)
            label = "名誉"
        elif str(key).startswith("stat_") and stats and key in stats.keys():
            label = labels.get(key, key)
            current = int(stats[key] or 0) + bonuses.get(label, bonuses.get(key, 0))
            if key == "stat_obed":
                current += bonuses.get("服从/威慑", 0)
        else:
            continue
        if current < required:
            raise GameError("PURCHASE_CONDITION_FAILED", f"购买条件不足：需要{label}≥{required}，当前{current}")


def purchase_item(path: Path, qq_id: str, item_name: str, count: int, idempotency_key: str) -> dict:
    item_name = str(item_name or "").strip()
    if not item_name or count <= 0 or count > 999:
        raise GameError("INVALID_INPUT", "请选择商品并填写正确数量")
    with transaction(path, immediate=True) as db:
        cached = _cached_operation(db, idempotency_key, qq_id, "shop.purchase")
        if cached:
            return cached
        _user, currency, _limits = _load_user(db, qq_id)
        item = db.execute("SELECT * FROM items WHERE name=?", (item_name,)).fetchone()
        if item is None or not int(item["is_selling"] or 0) or int(item["price"] or -1) < 0:
            raise GameError("ITEM_NOT_FOR_SALE", "商品不存在或已下架", 404)
        stock = int(item["stock_qty"] if item["stock_qty"] is not None else -1)
        if stock != -1 and stock < count:
            raise GameError("STOCK_INSUFFICIENT", f"库存不足，当前仅剩{stock}件")
        conditions = json_object(item["condition"])
        _check_item_conditions(db, qq_id, currency, conditions)
        bag = db.execute("SELECT count FROM user_bag WHERE user_id=? AND item_name=?", (qq_id, item_name)).fetchone()
        owned = int(bag["count"] or 0) if bag else 0
        max_hold = int(item["max_hold"] or 0)
        if max_hold > 0 and owned + count > max_hold:
            raise GameError("MAX_HOLD_REACHED", f"个人最多持有{max_hold}件，当前已有{owned}件")
        currency_key = str(item["currency"] or "yuCoin")
        cost = int(item["price"] or 0) * count
        balance = int(currency.get(currency_key, 0) or 0)
        if balance < cost:
            raise GameError("BALANCE_INSUFFICIENT", f"余额不足，需要{cost}，当前{balance}")
        currency[currency_key] = balance - cost
        if stock != -1:
            updated = db.execute("UPDATE items SET stock_qty=stock_qty-? WHERE name=? AND stock_qty>=?", (count, item_name, count))
            if updated.rowcount != 1:
                raise GameError("STOCK_INSUFFICIENT", "商品刚刚售罄，请刷新后重试")
        immediate_effect = item_name == "正面新闻"
        if immediate_effect:
            currency["reputation"] = int(currency.get("reputation", 0) or 0) + 5 * count
        else:
            db.execute(
                """
                INSERT INTO user_bag (user_id, item_name, count) VALUES (?, ?, ?)
                ON CONFLICT(user_id, item_name) DO UPDATE SET count=count+excluded.count
                """,
                (qq_id, item_name, count),
            )
            if item["type"] == "equip":
                stats = json_object(item["stats"])
                if any(key in stats for key in ("虞元", "名誉", "yuCoin", "reputation")):
                    for _ in range(count):
                        db.execute("INSERT INTO item_instances (item_name, user_id, currency_given) VALUES (?, ?, 0)", (item_name, qq_id))
        db.execute("UPDATE users SET currency=? WHERE id=?", (json.dumps(currency, ensure_ascii=False), qq_id))
        result = {"item": item_name, "count": count, "cost": cost, "currencyType": currency_key, "balance": currency[currency_key], "owned": owned + (0 if immediate_effect else count), "stock": stock - count if stock != -1 else -1, "immediateEffect": immediate_effect}
        _store_operation(db, idempotency_key, qq_id, "shop.purchase", result)
        return result


def compound_item(path: Path, qq_id: str, item_name: str, count: int, idempotency_key: str) -> dict:
    item_name = str(item_name or "").strip()
    if not item_name or count <= 0 or count > 999:
        raise GameError("INVALID_INPUT", "请选择兑换商品并填写正确数量")
    with transaction(path, immediate=True) as db:
        cached = _cached_operation(db, idempotency_key, qq_id, "shop.compound")
        if cached:
            return cached
        _user, currency, _limits = _load_user(db, qq_id)
        item = db.execute("SELECT * FROM items WHERE name=?", (item_name,)).fetchone()
        recipe = json_object(item["compound_recipe"] if item else None)
        if item is None or not recipe or not int(item["is_selling"] or 0):
            raise GameError("RECIPE_NOT_FOUND", "兑换配方不存在或已关闭", 404)
        stock = int(item["stock_qty"] if item["stock_qty"] is not None else -1)
        if stock != -1 and stock < count:
            raise GameError("STOCK_INSUFFICIENT", f"库存不足，当前仅剩{stock}件")
        bag_rows = db.execute("SELECT item_name, count FROM user_bag WHERE user_id=?", (qq_id,)).fetchall()
        bag = {row["item_name"]: int(row["count"] or 0) for row in bag_rows}
        for material, unit in recipe.items():
            required = int(unit) * count
            if material in {"yuCoin", "reputation"}:
                if int(currency.get(material, 0) or 0) < required:
                    raise GameError("MATERIAL_INSUFFICIENT", f"{material}不足，需要{required}")
            elif bag.get(material, 0) < required:
                raise GameError("MATERIAL_INSUFFICIENT", f"{material}不足，需要{required}，当前{bag.get(material, 0)}")
        max_hold = int(item["max_hold"] or 0)
        if max_hold > 0 and bag.get(item_name, 0) + count > max_hold:
            raise GameError("MAX_HOLD_REACHED", f"个人最多持有{max_hold}件")
        for material, unit in recipe.items():
            required = int(unit) * count
            if material in {"yuCoin", "reputation"}:
                currency[material] = int(currency.get(material, 0) or 0) - required
            else:
                db.execute("UPDATE user_bag SET count=count-? WHERE user_id=? AND item_name=?", (required, qq_id, material))
                db.execute("DELETE FROM user_bag WHERE user_id=? AND item_name=? AND count<=0", (qq_id, material))
        if stock != -1:
            updated = db.execute("UPDATE items SET stock_qty=stock_qty-? WHERE name=? AND stock_qty>=?", (count, item_name, count))
            if updated.rowcount != 1:
                raise GameError("STOCK_INSUFFICIENT", "商品刚刚售罄，请刷新后重试")
        db.execute(
            """
            INSERT INTO user_bag (user_id, item_name, count) VALUES (?, ?, ?)
            ON CONFLICT(user_id, item_name) DO UPDATE SET count=count+excluded.count
            """,
            (qq_id, item_name, count),
        )
        if item["type"] == "equip":
            stats = json_object(item["stats"])
            if any(key in stats for key in ("虞元", "名誉", "yuCoin", "reputation")):
                for _ in range(count):
                    db.execute("INSERT INTO item_instances (item_name, user_id, currency_given) VALUES (?, ?, 0)", (item_name, qq_id))
        db.execute("UPDATE users SET currency=? WHERE id=?", (json.dumps(currency, ensure_ascii=False), qq_id))
        result = {"item": item_name, "count": count, "recipe": recipe, "owned": bag.get(item_name, 0) + count, "stock": stock - count if stock != -1 else -1, "currency": currency}
        _store_operation(db, idempotency_key, qq_id, "shop.compound", result)
        return result


def exchange_lucky_pack(path: Path, qq_id: str, count: int, idempotency_key: str) -> dict:
    if count <= 0 or count > 999:
        raise GameError("INVALID_INPUT", "请选择正确的兑换数量")
    with transaction(path, immediate=True) as db:
        cached = _cached_operation(db, idempotency_key, qq_id, "inventory.exchange_lucky_pack")
        if cached:
            return cached
        _load_user(db, qq_id)
        fragment = db.execute(
            "SELECT count FROM user_bag WHERE user_id=? AND item_name=?",
            (qq_id, LUCKY_FRAGMENT_NAME),
        ).fetchone()
        owned_fragments = int(fragment["count"] or 0) if fragment else 0
        required = LUCKY_PACK_COST * count
        if owned_fragments < required:
            raise GameError("MATERIAL_INSUFFICIENT", f"{LUCKY_FRAGMENT_NAME}不足，需要{required}，当前{owned_fragments}")
        db.execute(
            "UPDATE user_bag SET count=count-? WHERE user_id=? AND item_name=?",
            (required, qq_id, LUCKY_FRAGMENT_NAME),
        )
        db.execute("DELETE FROM user_bag WHERE user_id=? AND item_name=? AND count<=0", (qq_id, LUCKY_FRAGMENT_NAME))
        db.execute(
            """
            INSERT INTO user_bag (user_id, item_name, count) VALUES (?, ?, ?)
            ON CONFLICT(user_id, item_name) DO UPDATE SET count=count+excluded.count
            """,
            (qq_id, LUCKY_PACK_NAME, count),
        )
        pack = db.execute("SELECT count FROM user_bag WHERE user_id=? AND item_name=?", (qq_id, LUCKY_PACK_NAME)).fetchone()
        result = {
            "item": LUCKY_PACK_NAME,
            "count": count,
            "costItem": LUCKY_FRAGMENT_NAME,
            "cost": required,
            "remainingFragments": owned_fragments - required,
            "owned": int(pack["count"] or 0) if pack else count,
        }
        _store_operation(db, idempotency_key, qq_id, "inventory.exchange_lucky_pack", result)
        return result


def use_inventory_item(path: Path, qq_id: str, item_name: str, count: int, choice: str, idempotency_key: str) -> dict:
    item_name = str(item_name or "").strip()
    choice = str(choice or "").strip()
    if not item_name or count <= 0 or count > 999:
        raise GameError("INVALID_INPUT", "请选择物品并填写正确数量")
    with transaction(path, immediate=True) as db:
        cached = _cached_operation(db, idempotency_key, qq_id, "inventory.use")
        if cached:
            return cached
        user, currency, _limits = _load_user(db, qq_id)
        item = db.execute("SELECT * FROM items WHERE name=?", (item_name,)).fetchone()
        if item is None:
            if item_name != LUCKY_PACK_NAME:
                raise GameError("ITEM_NOT_FOUND", "物品不存在", 404)
            item = {"stats": "{}"}
        if item_name == LUCKY_PACK_NAME:
            item = {
                **dict(item),
                "type": "consumable",
                "sub_type": "optional_pack",
                "param": json.dumps(LUCKY_PACK_CHOICES, ensure_ascii=False),
                "effect": json.dumps({"amount": LUCKY_PACK_STAT_AMOUNT}, ensure_ascii=False),
            }
        if item_name == LUCKY_FRAGMENT_NAME:
            raise GameError("ITEM_NOT_USABLE", f"{LUCKY_FRAGMENT_NAME}不能直接使用，请集齐{LUCKY_PACK_COST}个兑换{LUCKY_PACK_NAME}")
        if item["type"] != "consumable":
            raise GameError("ITEM_NOT_USABLE", "该物品需要在服饰页面穿戴，不能直接使用")
        bag = db.execute("SELECT count FROM user_bag WHERE user_id=? AND item_name=?", (qq_id, item_name)).fetchone()
        owned = int(bag["count"] or 0) if bag else 0
        if owned < count:
            raise GameError("ITEM_INSUFFICIENT", f"物品数量不足，当前仅有{owned}件")

        subtype = str(item["sub_type"] or "normal")
        changes: list[dict] = []
        profile = json_object(user["profile"])
        if subtype == "rename_card":
            if count != 1 or not choice:
                raise GameError("ITEM_CHOICE_REQUIRED", "请输入新的角色姓名")
            if len(choice) > 24:
                raise GameError("INVALID_INPUT", "姓名不能超过24个字符")
            duplicate = db.execute("SELECT 1 FROM users WHERE name=? AND id<>?", (choice, qq_id)).fetchone()
            if duplicate:
                raise GameError("NAME_ALREADY_EXISTS", "该名字已被使用")
            before = str(user["name"] or "")
            profile["姓名"] = choice
            db.execute("UPDATE users SET name=?, profile=? WHERE id=?", (choice, json.dumps(profile, ensure_ascii=False), qq_id))
            changes.append({"type": "profile", "key": "name", "label": "姓名", "before": before, "after": choice})
        elif subtype == "optional_pack":
            try:
                allowed = json.loads(item["param"] or "[]")
            except (TypeError, ValueError, json.JSONDecodeError):
                allowed = []
            if not isinstance(allowed, list) or not choice:
                raise GameError("ITEM_CHOICE_REQUIRED", "请选择要增加的属性")
            selected = next((value for value in allowed if _same_term(value, choice) or _stat_key(db, value) == _stat_key(db, choice)), None)
            if selected is None:
                raise GameError("ITEM_CHOICE_INVALID", f"该礼包不支持属性“{choice}”")
            amount = json_object(item["effect"]).get("amount", 1)
            changes.extend(_apply_bonus_map(db, qq_id, currency, {str(selected): amount}, count))
        else:
            changes.extend(_apply_bonus_map(db, qq_id, currency, json_object(item["stats"]), count))
            changes.extend(_apply_bonus_map(db, qq_id, currency, json_object(item["effect"]), count))

        db.execute("UPDATE user_bag SET count=count-? WHERE user_id=? AND item_name=?", (count, qq_id, item_name))
        db.execute("DELETE FROM user_bag WHERE user_id=? AND item_name=? AND count<=0", (qq_id, item_name))
        db.execute("UPDATE users SET currency=? WHERE id=?", (json.dumps(currency, ensure_ascii=False), qq_id))
        result = {"item": item_name, "count": count, "remaining": owned - count, "changes": changes, "currency": currency}
        _store_operation(db, idempotency_key, qq_id, "inventory.use", result)
        return result


def equip_item(path: Path, qq_id: str, item_name: str, requested_slot: str, idempotency_key: str) -> dict:
    item_name = str(item_name or "").strip()
    requested_slot = str(requested_slot or "").strip()
    if not item_name:
        raise GameError("INVALID_INPUT", "请选择要穿戴的服饰")
    with transaction(path, immediate=True) as db:
        cached = _cached_operation(db, idempotency_key, qq_id, "wardrobe.equip")
        if cached:
            return cached
        _user, currency, _limits = _load_user(db, qq_id)
        item = db.execute("SELECT * FROM items WHERE name=?", (item_name,)).fetchone()
        if item is None or item["type"] != "equip":
            raise GameError("ITEM_NOT_EQUIPMENT", "该物品不是可穿戴服饰")
        bag = db.execute("SELECT count FROM user_bag WHERE user_id=? AND item_name=?", (qq_id, item_name)).fetchone()
        owned = int(bag["count"] or 0) if bag else 0
        if owned <= 0:
            raise GameError("ITEM_INSUFFICIENT", "背包内没有这件服饰")
        equip = db.execute("SELECT * FROM user_equip WHERE user_id=?", (qq_id,)).fetchone()
        if equip is None:
            db.execute("INSERT INTO user_equip (user_id) VALUES (?)", (qq_id,))
            equip = db.execute("SELECT * FROM user_equip WHERE user_id=?", (qq_id,)).fetchone()
        slot_type = str(item["slot"] or "")
        available_slots = _available_equip_slots(equip)
        if slot_type in EQUIP_SINGLE_SLOTS:
            if requested_slot and requested_slot != slot_type:
                raise GameError("INVALID_EQUIP_SLOT", "该服饰不能穿戴到指定位置")
            if slot_type not in available_slots:
                raise GameError("INVALID_EQUIP_SLOT", "该服饰的穿戴位置未配置")
            target_slot = slot_type
        elif slot_type in EQUIP_EXACT_SLOTS:
            if requested_slot and requested_slot != slot_type:
                raise GameError("INVALID_EQUIP_SLOT", "该服饰不能穿戴到指定位置")
            if slot_type not in available_slots:
                raise GameError("INVALID_EQUIP_SLOT", "该服饰的穿戴位置未配置")
            target_slot = slot_type
        elif slot_type in EQUIP_SLOT_GROUPS:
            candidates = [slot for slot in EQUIP_SLOT_GROUPS[slot_type] if slot in available_slots]
            if not candidates and slot_type in equip.keys():
                candidates = [slot_type]
            if requested_slot:
                if requested_slot == slot_type:
                    requested_slot = ""
                elif requested_slot not in candidates:
                    raise GameError("INVALID_EQUIP_SLOT", "该服饰不能穿戴到指定位置")
            if requested_slot:
                target_slot = requested_slot
            else:
                target_slot = next((slot for slot in candidates if not _equip_value(equip, slot)), "")
                if not target_slot:
                    target_slot = next((slot for slot in candidates if _equip_value(equip, slot) not in LOCKED_EQUIP_ITEMS), "")
                if not target_slot:
                    raise GameError("EQUIP_SLOT_LOCKED", "该类槽位已被无法卸下的服饰占用")
        else:
            raise GameError("INVALID_EQUIP_SLOT", "该服饰的穿戴位置未配置")

        replaced = _equip_value(equip, target_slot)
        if replaced in LOCKED_EQUIP_ITEMS:
            raise GameError("EQUIP_SLOT_LOCKED", f"“{replaced}”无法被替换")
        if replaced:
            db.execute(
                "INSERT INTO user_bag (user_id, item_name, count) VALUES (?, ?, 1) ON CONFLICT(user_id, item_name) DO UPDATE SET count=count+1",
                (qq_id, replaced),
            )
        db.execute("UPDATE user_bag SET count=count-1 WHERE user_id=? AND item_name=?", (qq_id, item_name))
        db.execute("DELETE FROM user_bag WHERE user_id=? AND item_name=? AND count<=0", (qq_id, item_name))
        db_slot = _equip_db_slot(equip, target_slot)
        db.execute(f"UPDATE user_equip SET {db_slot}=? WHERE user_id=?", (item_name, qq_id))

        first_wear_changes: list[dict] = []
        instance = db.execute(
            "SELECT instance_id FROM item_instances WHERE item_name=? AND user_id=? AND currency_given=0 ORDER BY instance_id LIMIT 1",
            (item_name, qq_id),
        ).fetchone()
        if instance:
            currency_bonus = {key: value for key, value in json_object(item["stats"]).items() if key in {"虞元", "名誉", "yuCoin", "reputation"}}
            if currency_bonus:
                first_wear_changes = _apply_bonus_map(db, qq_id, currency, currency_bonus)
                db.execute("UPDATE item_instances SET currency_given=1 WHERE instance_id=?", (instance["instance_id"],))
        db.execute("UPDATE users SET currency=? WHERE id=?", (json.dumps(currency, ensure_ascii=False), qq_id))
        result = {"item": item_name, "slot": target_slot, "replaced": replaced, "remaining": owned - 1, "firstWearChanges": first_wear_changes, "currency": currency}
        _store_operation(db, idempotency_key, qq_id, "wardrobe.equip", result)
        return result


def unequip_item(path: Path, qq_id: str, item_name: str, requested_slot: str, idempotency_key: str) -> dict:
    item_name = str(item_name or "").strip()
    requested_slot = str(requested_slot or "").strip()
    if not item_name:
        raise GameError("INVALID_INPUT", "请选择要卸下的服饰")
    if item_name in LOCKED_EQUIP_ITEMS:
        raise GameError("EQUIPMENT_LOCKED", "该服饰无法自行卸下")
    with transaction(path, immediate=True) as db:
        cached = _cached_operation(db, idempotency_key, qq_id, "wardrobe.unequip")
        if cached:
            return cached
        _load_user(db, qq_id)
        equip = db.execute("SELECT * FROM user_equip WHERE user_id=?", (qq_id,)).fetchone()
        if equip is None:
            raise GameError("EQUIPMENT_NOT_WORN", "当前没有穿戴这件服饰")
        slots = [key for key in equip.keys() if key != "user_id" and equip[key] == item_name]
        for display_slot, legacy_slot in EQUIP_LEGACY_SLOT_FALLBACKS.items():
            if legacy_slot in slots and display_slot not in slots:
                slots.append(display_slot)
        if requested_slot:
            slots = [slot for slot in slots if slot == requested_slot]
        if not slots:
            raise GameError("EQUIPMENT_NOT_WORN", "当前没有在指定位置穿戴这件服饰")
        target_slot = slots[0]
        db_slot = _equip_db_slot(equip, target_slot)
        db.execute(f"UPDATE user_equip SET {db_slot}=NULL WHERE user_id=?", (qq_id,))
        db.execute(
            "INSERT INTO user_bag (user_id, item_name, count) VALUES (?, ?, 1) ON CONFLICT(user_id, item_name) DO UPDATE SET count=count+1",
            (qq_id, item_name),
        )
        bag = db.execute("SELECT count FROM user_bag WHERE user_id=? AND item_name=?", (qq_id, item_name)).fetchone()
        result = {"item": item_name, "slot": target_slot, "owned": int(bag["count"] or 0)}
        _store_operation(db, idempotency_key, qq_id, "wardrobe.unequip", result)
        return result


def summon_state(path: Path, qq_id: str) -> dict:
    with connect(path) as db:
        _user, currency, _limits = _load_user(db, qq_id)
        cards = [dict(row) for row in db.execute(
            """
            SELECT card_id AS id, card_name AS name, rarity, image_path AS image,
                   copies, first_obtained_at AS firstObtainedAt
            FROM user_summon_cards WHERE user_id=?
            ORDER BY CASE rarity WHEN 'SSR' THEN 1 WHEN 'SR' THEN 2 ELSE 3 END,
                     first_obtained_at DESC, card_name
            """,
            (qq_id,),
        ).fetchall()]
        history = [dict(row) for row in db.execute(
            """
            SELECT batch_id AS batchId, sequence_no AS sequenceNo, count, cost,
                   card_id AS id, card_name AS name, rarity, is_new AS isNew,
                   created_at AS createdAt
            FROM summon_draw_logs WHERE user_id=? ORDER BY id DESC LIMIT 50
            """,
            (qq_id,),
        ).fetchall()]
    return {
        "balance": int(currency.get("yuCoin", 0) or 0),
        "prices": {"single": 2, "ten": 20},
        "rates": {"R": 80, "SR": 19, "SSR": 1},
        "cards": cards,
        "history": history,
    }


def _draw_card(catalog: list[dict], allowed_rarities: tuple[str, ...] = ("R", "SR", "SSR")) -> dict:
    pool = [card for card in catalog if card.get("rarity") in allowed_rarities]
    if not pool:
        raise GameError("SUMMON_POOL_EMPTY", "召集卡池尚未配置", 503)
    return dict(RNG.choice(pool))


def summon_draw(path: Path, qq_id: str, count: int, catalog: list[dict], idempotency_key: str) -> dict:
    if count not in (1, 10):
        raise GameError("INVALID_INPUT", "召集次数仅支持1次或10次")
    action = f"summon.draw.{count}"
    cost = 2 if count == 1 else 20
    with transaction(path, immediate=True) as db:
        cached = _cached_operation(db, idempotency_key, qq_id, action)
        if cached:
            return cached
        _user, currency, _limits = _load_user(db, qq_id)
        balance = int(currency.get("yuCoin", 0) or 0)
        if balance < cost:
            raise GameError("BALANCE_INSUFFICIENT", f"虞元不足，需要{cost}，当前{balance}")

        cards_by_rarity = {
            rarity: [card for card in catalog if card.get("rarity") == rarity]
            for rarity in ("R", "SR", "SSR")
        }
        if any(not cards_by_rarity[rarity] for rarity in ("R", "SR", "SSR")):
            raise GameError("SUMMON_POOL_INCOMPLETE", "R、SR、SSR卡池需要分别配置人物卡", 503)

        draws: list[dict] = []
        for _index in range(count):
            roll = RNG.uniform(0, 100)
            rarity = "SSR" if roll < 1 else "SR" if roll < 20 else "R"
            draws.append(_draw_card(cards_by_rarity[rarity], (rarity,)))
        if count == 10 and not any(card["rarity"] in {"SR", "SSR"} for card in draws):
            guaranteed_rarity = "SSR" if RNG.uniform(0, 100) < 5 else "SR"
            draws[-1] = _draw_card(cards_by_rarity[guaranteed_rarity], (guaranteed_rarity,))

        currency["yuCoin"] = balance - cost
        db.execute("UPDATE users SET currency=? WHERE id=?", (json.dumps(currency, ensure_ascii=False), qq_id))
        batch_id = uuid.uuid4().hex
        results = []
        for sequence, card in enumerate(draws, 1):
            existing = db.execute(
                "SELECT copies FROM user_summon_cards WHERE user_id=? AND card_id=?",
                (qq_id, card["id"]),
            ).fetchone()
            is_new = existing is None
            db.execute(
                """
                INSERT INTO user_summon_cards
                    (user_id, card_id, card_name, rarity, image_path, copies)
                VALUES (?, ?, ?, ?, ?, 1)
                ON CONFLICT(user_id, card_id) DO UPDATE SET
                    copies=copies+1, last_obtained_at=CURRENT_TIMESTAMP
                """,
                (qq_id, card["id"], card["name"], card["rarity"], card["image"]),
            )
            db.execute(
                """
                INSERT INTO summon_draw_logs
                    (user_id, batch_id, sequence_no, count, cost, card_id, card_name, rarity, is_new)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (qq_id, batch_id, sequence, count, cost, card["id"], card["name"], card["rarity"], int(is_new)),
            )
            results.append({**card, "isNew": is_new, "copies": int(existing["copies"] or 0) + 1 if existing else 1})

        result = {"batchId": batch_id, "count": count, "cost": cost, "balance": currency["yuCoin"], "results": results}
        _store_operation(db, idempotency_key, qq_id, action, result)
        return result
