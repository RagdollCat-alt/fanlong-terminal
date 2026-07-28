CREATE TABLE IF NOT EXISTS user_summon_cards (
    user_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    card_name TEXT NOT NULL,
    rarity TEXT NOT NULL CHECK (rarity IN ('R', 'SR', 'SSR')),
    image_path TEXT NOT NULL,
    copies INTEGER NOT NULL DEFAULT 1,
    first_obtained_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_obtained_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_user_summon_cards_user_rarity
ON user_summon_cards(user_id, rarity, first_obtained_at);

CREATE TABLE IF NOT EXISTS summon_draw_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    sequence_no INTEGER NOT NULL,
    count INTEGER NOT NULL,
    cost INTEGER NOT NULL,
    card_id TEXT NOT NULL,
    card_name TEXT NOT NULL,
    rarity TEXT NOT NULL CHECK (rarity IN ('R', 'SR', 'SSR')),
    is_new INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_summon_draw_logs_user_time
ON summon_draw_logs(user_id, id DESC);
