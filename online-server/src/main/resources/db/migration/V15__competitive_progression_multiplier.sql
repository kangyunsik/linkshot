-- Historical receipts were settled without the early ladder multiplier.
ALTER TABLE match_results ADD COLUMN rating_multiplier INTEGER NOT NULL DEFAULT 1 CHECK (rating_multiplier IN (1, 2));
