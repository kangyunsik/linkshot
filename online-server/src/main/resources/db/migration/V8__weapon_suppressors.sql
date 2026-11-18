CREATE TABLE equipped_suppressors (
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    weapon_id VARCHAR(32) NOT NULL,
    PRIMARY KEY (account_id, weapon_id)
);
