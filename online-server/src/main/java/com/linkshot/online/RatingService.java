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
    public Map<String, Applied> settle(MatchService.Mode mode, List<MatchService.Performance> roster, int botRating) {
        return settle(mode, roster, botRating, "ffa");
    }
    @Transactional
    public Map<String, Applied> settle(MatchService.Mode mode, List<MatchService.Performance> roster, int botRating, String gameType) {
        if (botRating < 0 || botRating > 10_000) throw new IllegalArgumentException("Invalid assigned AI rating");
        boolean ranked = mode == MatchService.Mode.RANKED;
        db.queryForObject("SELECT id FROM matchmaking_lock WHERE id = 2 FOR UPDATE", Integer.class);
        var humans = roster.stream().filter(player -> !player.bot()).sorted(java.util.Comparator.comparing(MatchService.Performance::id)).toList();
        Map<String, Before> before = new HashMap<>();
        for (var player : humans) {
            String fields = ranked ? "ranked_rating, rank_index, rank_points, rank_placements, ranked_games" : "casual_rating, ffa_rank_index, ffa_rank_points, ffa_rank_placements, ffa_ranked_games";
            var state = db.queryForObject("SELECT " + fields + " FROM profiles WHERE account_id = ? FOR UPDATE", (row, index) -> new Before(row.getInt(1), new RatingPolicy.RankProgress(row.getInt(2), row.getInt(3), row.getInt(4), row.getInt(5))), UUID.fromString(player.id()));
            before.put(player.id(), state);
        }
        var players = roster.stream().map(player -> new RatingPolicy.Player(player.id(), player.bot() ? botRating : before.get(player.id()).rating(), player.kills(), player.deaths(), player.humanKills(), player.humanDeaths(), player.abandoned())).toList();
        var changes = "teams".equals(gameType) ? RatingPolicy.settleTeams(players, roster) : RatingPolicy.settle(ranked, players);
        Map<String, Applied> result = new HashMap<>();
        for (var player : humans) {
            var prior = before.get(player.id()); var change = changes.get(player.id()); int rating = Math.max(0, Math.min(10_000, prior.rating() + change.ratingDelta())), points = 0;
            var promotion = RatingPolicy.advance(prior.progress(), rating, change.outcome()); var state = promotion.progress(); points = promotion.pointDelta();
            if (ranked) {
                db.update("UPDATE profiles SET ranked_rating = ?, rank_index = ?, rank_points = ?, rank_placements = ?, ranked_games = ?, rank_tier = ? WHERE account_id = ?", rating, state.index(), state.points(), state.placements(), state.games(), RatingPolicy.tier(state), UUID.fromString(player.id()));
            } else db.update("UPDATE profiles SET casual_rating = ?, ffa_rank_index = ?, ffa_rank_points = ?, ffa_rank_placements = ?, ffa_ranked_games = ?, ffa_rank_tier = ? WHERE account_id = ?", rating, state.index(), state.points(), state.placements(), state.games(), RatingPolicy.tier(state), UUID.fromString(player.id()));
            result.put(player.id(), new Applied(rating - prior.rating(), points));
        }
        String tier = ranked ? "rank_tier" : "ffa_rank_tier", index = ranked ? "rank_index" : "ffa_rank_index", points = ranked ? "rank_points" : "ffa_rank_points", placements = ranked ? "rank_placements" : "ffa_rank_placements", games = ranked ? "ranked_games" : "ffa_ranked_games", rating = ranked ? "ranked_rating" : "casual_rating";
        db.update("UPDATE profiles SET " + tier + " = 'DIAMOND' WHERE " + tier + " = 'CHALLENGER'");
        var leaders = db.queryForList("SELECT account_id FROM profiles WHERE " + index + " = 24 AND " + points + " = 100 AND " + placements + " >= ? AND " + games + " >= 20 AND " + rating + " >= 2600 ORDER BY " + rating + " DESC, account_id LIMIT 200", UUID.class, RatingPolicy.PLACEMENTS);
        for (UUID account : leaders) db.update("UPDATE profiles SET " + tier + " = 'CHALLENGER' WHERE account_id = ?", account);
        return result;
    }
}
