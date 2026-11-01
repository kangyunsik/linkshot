CREATE TABLE custom_gateway_lock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    engine_id VARCHAR(64) REFERENCES engines(id) ON DELETE SET NULL
);
INSERT INTO custom_gateway_lock(id) VALUES (1);
CREATE TABLE custom_tickets (
    token_hash CHAR(64) PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id),
    engine_id VARCHAR(64) NOT NULL REFERENCES engines(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX custom_ticket_expiry ON custom_tickets(expires_at);
