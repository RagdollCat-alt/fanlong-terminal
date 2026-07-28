from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

from config import Settings
from db import connect


def main() -> None:
    settings = Settings.from_env()
    source = settings.fanlong_db_path
    if not source.is_file():
        raise SystemExit(f"找不到数据库：{source}")
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = source.with_name(f"{source.name}.before_terminal_{stamp}")
    print(f"数据库：{source}")
    print(f"备份到：{backup}")
    if input("确认机器人已停止写入或已进入维护模式？输入 MIGRATE：").strip() != "MIGRATE":
        raise SystemExit("已取消")
    shutil.copy2(source, backup)
    migration_dir = Path(__file__).with_name("migrations")
    with connect(source) as db:
        for migration in sorted(migration_dir.glob("*.sql")):
            print(f"执行：{migration.name}")
            db.executescript(migration.read_text(encoding="utf-8"))
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        daily = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_action_logs'").fetchone()
        operations = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='web_operation_records'").fetchone()
        summon_cards = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_summon_cards'").fetchone()
        summon_logs = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='summon_draw_logs'").fetchone()
    if integrity != "ok" or not daily or not operations or not summon_cards or not summon_logs:
        raise SystemExit(f"迁移验证失败；完整性={integrity}，请保留现场并使用备份恢复")
    print("迁移完成：integrity_check=ok，所需表均已创建。")


if __name__ == "__main__":
    main()
