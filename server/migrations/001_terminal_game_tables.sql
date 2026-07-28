CREATE TABLE IF NOT EXISTS daily_action_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action_date TEXT NOT NULL,
    action_type TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    sequence_no INTEGER NOT NULL DEFAULT 1,
    cost INTEGER NOT NULL DEFAULT 0,
    reward_json TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL DEFAULT 'web',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_daily_action_user_date
ON daily_action_logs(user_id, action_date, id);

CREATE TABLE IF NOT EXISTS web_operation_records (
    idempotency_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (idempotency_key, user_id, action)
);

