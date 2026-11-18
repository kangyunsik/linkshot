ALTER TABLE profiles ADD COLUMN ffa_rank_index INTEGER NOT NULL DEFAULT 0 CHECK (ffa_rank_index BETWEEN 0 AND 24);
ALTER TABLE profiles ADD COLUMN ffa_rank_points INTEGER NOT NULL DEFAULT 0 CHECK (ffa_rank_points BETWEEN 0 AND 100);
ALTER TABLE profiles ADD COLUMN ffa_rank_placements INTEGER NOT NULL DEFAULT 0 CHECK (ffa_rank_placements BETWEEN 0 AND 5);
ALTER TABLE profiles ADD COLUMN ffa_ranked_games INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN ffa_rank_tier VARCHAR(16) NOT NULL DEFAULT 'UNRANKED';
ALTER TABLE match_results ADD COLUMN assists INTEGER NOT NULL DEFAULT 0 CHECK (assists >= 0);

-- Keep personal MMR and match history; never copy or reset the team ladder.
UPDATE profiles p SET ffa_ranked_games = games.total, ffa_rank_placements = LEAST(5, games.total),
    ffa_rank_index = CASE WHEN games.total >= 5 THEN GREATEST(0, LEAST(14, (p.casual_rating - 600) / 80)) ELSE 0 END
FROM (SELECT r.account_id, COUNT(*)::INTEGER total FROM match_results r JOIN online_matches m ON m.id = r.match_id
      WHERE m.mode = 'CASUAL' AND m.status = 'COMPLETED' GROUP BY r.account_id) games
WHERE p.account_id = games.account_id;
UPDATE profiles SET ffa_rank_tier = (ARRAY['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'])[ffa_rank_index / 5 + 1]
WHERE ffa_rank_placements = 5;
CREATE INDEX match_results_account_history ON match_results(account_id, match_id);
