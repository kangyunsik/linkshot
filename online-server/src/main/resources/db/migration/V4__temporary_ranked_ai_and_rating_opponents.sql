ALTER TABLE online_matches ADD COLUMN ranked_ai_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE online_matches ADD COLUMN bot_rating INTEGER NOT NULL DEFAULT 1000 CHECK (bot_rating BETWEEN 0 AND 10000);
ALTER TABLE online_matches DROP CONSTRAINT online_matches_check;
ALTER TABLE online_matches ADD CONSTRAINT ranked_ai_assignment_policy CHECK (mode <> 'RANKED' OR bot_count = 0 OR ranked_ai_enabled);
