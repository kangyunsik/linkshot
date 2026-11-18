-- Preserve established ranks; finish in-progress placements already at five.
UPDATE profiles SET rank_index = GREATEST(0, LEAST(14, (ranked_rating - 600) / 80)), rank_points = 0
WHERE rank_tier = 'UNRANKED' AND rank_placements >= 5;
UPDATE profiles SET rank_tier = (ARRAY['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'])[rank_index / 5 + 1]
WHERE rank_tier = 'UNRANKED' AND rank_placements >= 5;
UPDATE profiles SET rank_placements = LEAST(rank_placements, 5);
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_rank_placements_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_rank_placements_check CHECK (rank_placements BETWEEN 0 AND 5);
