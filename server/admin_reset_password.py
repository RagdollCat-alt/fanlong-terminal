from __future__ import annotations

import argparse
from getpass import getpass

from config import Settings
from db import connect, init_terminal_db, transaction
from security import hash_password


def main() -> None:
    parser = argparse.ArgumentParser(description="繁笼个人终端管理员人工重置密码")
    parser.add_argument("qq", help="需要重置的QQ号")
    args = parser.parse_args()
    qq_id = args.qq.strip()
    if not qq_id.isdigit():
        raise SystemExit("QQ号格式不正确")

    settings = Settings.from_env()
    init_terminal_db(settings.terminal_db_path)
    with connect(settings.fanlong_db_path) as game_db:
        player = game_db.execute("SELECT id, uid, name FROM users WHERE id=?", (qq_id,)).fetchone()
    if player is None:
        raise SystemExit("fanlong.db 中不存在该QQ档案，已停止")
    print(f"目标：{player['name']} / UID {player['uid']} / QQ {player['id']}")
    if input("确认已核对身份并继续？输入 RESET：").strip() != "RESET":
        raise SystemExit("已取消")
    temporary = getpass("输入临时密码（8-128位）：")
    if len(temporary) < 8 or len(temporary) > 128:
        raise SystemExit("临时密码长度不正确")

    with transaction(settings.terminal_db_path, immediate=True) as db:
        account = db.execute("SELECT 1 FROM player_accounts WHERE qq_id=?", (qq_id,)).fetchone()
        if account is None:
            raise SystemExit("该QQ尚未首次设密，无需执行密码重置")
        db.execute(
            "UPDATE player_accounts SET password_hash=?, must_change_password=1, updated_at=CURRENT_TIMESTAMP WHERE qq_id=?",
            (hash_password(temporary), qq_id),
        )
        db.execute("UPDATE web_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE qq_id=?", (qq_id,))
        db.execute(
            "INSERT INTO web_audit_logs (qq_id, action, target, result, ip) VALUES (?, 'admin.password.reset', ?, 'success', 'localhost')",
            (qq_id, qq_id),
        )
    print("重置完成：旧会话已撤销，玩家下次登录必须修改密码。")


if __name__ == "__main__":
    main()

