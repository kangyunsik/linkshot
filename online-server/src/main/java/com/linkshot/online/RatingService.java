package com.linkshot.online;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RatingService {
    private final JdbcTemplate db;
    public RatingService(JdbcTemplate db) { this.db = db; }
    public record Applied(int ratingDelta, int pointsDelta) {}
    private record Before(int rating, RatingPolicy.RankProgress progress) {}
    @Transactional
    public Map<String, Applied> settle(MatchService.Mode mode, List<MatchService.Performance> roster) {
        boolean ranked = mode == MatchService.Mode.RANKED;
        if (ranked) db.queryForObject("SELECT id FROM matchmaking_lock WHERE id = 2 FOR UPDATE", Integer.class);
        var humans = roster.stream().filter(player -> !player.bot()).sorted(java.util.Comparator.comparing(MatchService.Performance::id)).toList();
        Map<String, Before> before = new HashMap<>();
        for (var player : humans) {
            var state = db.queryForObject("SELECT casual_rating, ranked_rating, rank_index, rank_points, rank_placements, ranked_games FROM profiles WHERE account_id = ? FOR UPDATE", (row, index) -> new Before(row.getInt(ranked ? 2 : 1), new RatingPolicy.RankProgress(row.getInt(3), row.getInt(4), row.getInt(5), row.getInt(6))), UUID.fromString(player.id()));
            before.put(player.id(), state);
        }
        var changes = RatingPolicy.settle(ranked, humans.stream().map(player -> new RatingPolicy.Player(player.id(), before.get(player.id()).rating(), player.kills(), player.deaths(), player.humanKills(), player.humanDeaths(), player.abandoned())).toList());
        Map<String, Applied> result = new HashMap<>();
        for (var player : humans) {
            var prior = before.get(player.id()); var change = changes.get(player.id()); int rating = Math.max(0, Math.min(10_000, prior.rating() + change.ratingDelta())), points = 0;
            if (ranked) {
                var promotion = RatingPolicy.advance(prior.progress(), rating, change.outcome()); var state = promotion.progress(); points = promotion.pointDelta();
                db.update("UPDATE profiles SET ranked_rating = ?, rank_index = ?, rank_points = ?, rank_placements = ?, ranked_games = ?, rank_tier = ? WHERE account_id = ?", rating, state.index(), state.points(), state.placements(), state.games(), RatingPolicy.tier(state), UUID.fromString(player.id()));
            } else db.update("UPDATE profiles SET casual_rating = ? WHERE account_id = ?", rating, UUID.fromString(player.id()));
            result.put(player.id(), new Applied(rating - prior.rating(), points));
        }
        if (ranked) {
            db.update("UPDATE profiles SET rank_tier = 'DIAMOND' WHERE rank_tier = 'CHALLENGER'");
            var leaders = db.queryForList("SELECT account_id FROM profiles WHERE rank_index = 24 AND rank_points = 100 AND rank_placements = 10 AND ranked_games >= 20 AND ranked_rating >= 2600 ORDER BY ranked_rating DESC, account_id LIMIT 200", UUID.class);
            for (UUID account : leaders) db.update("UPDATE profiles SET rank_tier = 'CHALLENGER' WHERE account_id = ?", account);
        }
        return result;
    }
}
