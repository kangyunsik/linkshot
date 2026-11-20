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
    public record Applied(int ratingDelta, int pointsDelta, int multiplier, String tierBefore, int divisionBefore, int pointsBefore) {}
    private record Before(int rating, RatingPolicy.RankProgress progress, String tier) {}
    private static final String PLACEMENT_HISTORY = """
        SELECT COUNT(*) FILTER (WHERE won AND NOT abandoned AND (? OR kills > 0)),
               COALESCE(SUM(kills), 0), COALESCE(SUM(deaths), 0), COALESCE(SUM(rank_points_delta), 0)
        FROM (SELECT r.won, r.abandoned, r.kills, r.deaths, r.rank_points_delta
              FROM match_results r JOIN online_matches m ON m.id = r.match_id
              WHERE r.account_id = ? AND m.mode = ? AND m.status = 'COMPLETED'
              ORDER BY m.completed_at, m.id LIMIT ?) earlier
        """;
    @Transactional
    public Map<String, Applied> settle(MatchService.Mode mode, List<MatchService.Performance> roster, int botRating) {
        return settle(mode, roster, botRating, "ffa");
    }
    @Transactional
    public Map<String, Applied> settle(MatchService.Mode mode, List<MatchService.Performance> roster, int botRating, String gameType) {
        if (botRating < 0 || botRating > 10_000) throw new IllegalArgumentException("Invalid assigned AI rating");
        boolean ranked = mode == MatchService.Mode.RANKED, teams = "teams".equals(gameType);
        db.queryForObject("SELECT id FROM matchmaking_lock WHERE id = 2 FOR UPDATE", Integer.class);
        var humans = roster.stream().filter(player -> !player.bot()).sorted(java.util.Comparator.comparing(MatchService.Performance::id)).toList();
        Map<String, Before> before = new HashMap<>();
        for (var player : humans) {
            String fields = ranked ? "ranked_rating, rank_index, rank_points, rank_placements, ranked_games, rank_tier" : "casual_rating, ffa_rank_index, ffa_rank_points, ffa_rank_placements, ffa_ranked_games, ffa_rank_tier";
            var state = db.queryForObject("SELECT " + fields + " FROM profiles WHERE account_id = ? FOR UPDATE", (row, index) -> new Before(row.getInt(1), new RatingPolicy.RankProgress(row.getInt(2), row.getInt(3), row.getInt(4), row.getInt(5)), row.getString(6)), UUID.fromString(player.id()));
            before.put(player.id(), state);
        }
        var players = roster.stream().map(player -> new RatingPolicy.Player(player.id(), player.bot() ? botRating : before.get(player.id()).rating(), player.kills(), player.deaths(), player.humanKills(), player.humanDeaths(), player.abandoned())).toList();
        var changes = teams ? RatingPolicy.settleTeams(players, roster) : RatingPolicy.settle(ranked, players);
        String winner = teams ? RatingPolicy.winnerTeam(roster) : RatingPolicy.winnerFfa(roster);
        Map<String, Applied> result = new HashMap<>();
        for (var player : humans) {
            UUID account = UUID.fromString(player.id());
            var prior = before.get(player.id()); var change = changes.get(player.id()); var progress = prior.progress();
            int multiplier = RatingPolicy.progressionMultiplier(progress);
            int rating = RatingPolicy.boundedRating(prior.rating() + change.ratingDelta() * multiplier);
            var run = RatingPolicy.PlacementRun.EMPTY;
            if (progress.placements() == RatingPolicy.PLACEMENTS - 1) {
                var previous = db.queryForObject(PLACEMENT_HISTORY, (row, index) -> new RatingPolicy.PlacementRun(row.getInt(1), row.getLong(2), row.getLong(3), row.getLong(4)), teams, account, mode.name(), progress.placements());
                boolean won = !player.abandoned() && winner != null && (teams ? winner.equals(player.teamId()) : winner.equals(player.id()) && player.kills() > 0);
                run = previous.include(won, player.kills(), player.deaths());
            }
            // Use the ordinary post-match Elo for the regular RP adjustment,
            // so doubling Elo does not change the baseline that RP doubles.
            int ratingForPoints = progress.placements() < RatingPolicy.PLACEMENTS ? rating : RatingPolicy.boundedRating(prior.rating() + change.ratingDelta());
            var promotion = RatingPolicy.advance(progress, ratingForPoints, change.outcome(), run); var state = promotion.progress();
            if (ranked) {
                db.update("UPDATE profiles SET ranked_rating = ?, rank_index = ?, rank_points = ?, rank_placements = ?, ranked_games = ?, rank_tier = ? WHERE account_id = ?", rating, state.index(), state.points(), state.placements(), state.games(), RatingPolicy.tier(state), account);
            } else db.update("UPDATE profiles SET casual_rating = ?, ffa_rank_index = ?, ffa_rank_points = ?, ffa_rank_placements = ?, ffa_ranked_games = ?, ffa_rank_tier = ? WHERE account_id = ?", rating, state.index(), state.points(), state.placements(), state.games(), RatingPolicy.tier(state), account);
            result.put(player.id(), new Applied(rating - prior.rating(), promotion.pointDelta(), multiplier, prior.tier(), RatingPolicy.division(progress), progress.points()));
        }
        String tier = ranked ? "rank_tier" : "ffa_rank_tier", index = ranked ? "rank_index" : "ffa_rank_index", points = ranked ? "rank_points" : "ffa_rank_points", placements = ranked ? "rank_placements" : "ffa_rank_placements", games = ranked ? "ranked_games" : "ffa_ranked_games", rating = ranked ? "ranked_rating" : "casual_rating";
        db.update("UPDATE profiles SET " + tier + " = 'DIAMOND' WHERE " + tier + " = 'CHALLENGER'");
        var leaders = db.queryForList("SELECT account_id FROM profiles WHERE " + index + " = 24 AND " + points + " = 100 AND " + placements + " >= ? AND " + games + " >= ? AND " + rating + " >= 2600 ORDER BY " + rating + " DESC, account_id LIMIT 200", UUID.class, RatingPolicy.PLACEMENTS, RatingPolicy.ACCELERATED_GAMES);
        for (UUID account : leaders) db.update("UPDATE profiles SET " + tier + " = 'CHALLENGER' WHERE account_id = ?", account);
        return result;
    }
}
