CREATE TABLE owned_outfits (
    account_id UUID NOT NULL REFERENCES accounts(id),
    outfit_id VARCHAR(32) NOT NULL,
    PRIMARY KEY (account_id, outfit_id)
);
INSERT INTO owned_outfits(account_id, outfit_id) SELECT id, 'field' FROM accounts;
INSERT INTO owned_outfits(account_id, outfit_id) SELECT id, outfit_id FROM accounts ON CONFLICT DO NOTHING;
