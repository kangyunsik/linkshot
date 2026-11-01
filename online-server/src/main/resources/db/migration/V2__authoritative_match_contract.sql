CREATE TABLE online_matches (
    id UUID PRIMARY KEY,
    mode VARCHAR(16) NOT NULL CHECK (mode IN ('CASUAL', 'RANKED')),
    map_id VARCHAR(32) NOT NULL,
    bot_count INTEGER NOT NULL CHECK (bot_count BETWEEN 0 AND 7),
    frag_limit INTEGER NOT NULL CHECK (frag_limit BETWEEN 1 AND 200),
    round_seconds INTEGER NOT NULL CHECK (round_seconds BETWEEN 60 AND 3600),
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CLAIMED', 'COMPLETED', 'CANCELLED')),
    engine_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    heartbeat_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    result_hash CHAR(64),
    CHECK (mode <> 'RANKED' OR bot_count = 0)
);
CREATE TABLE match_players (match_id UUID NOT NULL REFERENCES online_matches(id), account_id UUID NOT NULL REFERENCES accounts(id), PRIMARY KEY (match_id, account_id));
ALTER TABLE profiles ADD COLUMN active_match_id UUID REFERENCES online_matches(id);
CREATE TABLE match_tickets (
    token_hash CHAR(64) PRIMARY KEY,
    match_id UUID NOT NULL REFERENCES online_matches(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX match_ticket_expiry ON match_tickets(expires_at);
CREATE TABLE match_results (
    match_id UUID NOT NULL REFERENCES online_matches(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    kills INTEGER NOT NULL,
    deaths INTEGER NOT NULL,
    points INTEGER NOT NULL,
    weapon_kills TEXT NOT NULL,
    PRIMARY KEY(match_id, account_id)
);
