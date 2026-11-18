package com.linkshot.online;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;
import com.linkshot.online.AccountService.CompetitiveProfile;
import com.linkshot.online.AccountService.RecentMatch;

/** Read-only competitive summaries; account identity and purchases stay separate. */
@Component
public class CompetitiveRecords {
    private final JdbcTemplate db;
    private record Totals(long games, long wins, long draws, long kills, long deaths, long assists) {}
    private static final Totals EMPTY = new Totals(0, 0, 0, 0, 0, 0);
    private static final String TOTALS = """
        SELECT m.mode, COUNT(*) games, COUNT(*) FILTER (WHERE r.won) wins,
               COUNT(*) FILTER (WHERE r.outcome = 'DRAW') draws,
               COALESCE(SUM(r.kills),0) kills, COALESCE(SUM(r.deaths),0) deaths,
               COALESCE(SUM(r.assists),0) assists
        FROM match_results r JOIN online_matches m ON m.id = r.match_id
        WHERE r.account_id = ? AND m.status = 'COMPLETED' GROUP BY m.mode
        """;
    private static final String HISTORY = """
        SELECT * FROM (
            SELECT m.mode, m.map_id, m.completed_at, r.*,
                   ROW_NUMBER() OVER (PARTITION BY m.mode ORDER BY m.completed_at DESC, m.id DESC) recent_number,
                   ROW_NUMBER() OVER (PARTITION BY m.mode ORDER BY m.completed_at, m.id) placement_number
            FROM match_results r JOIN online_matches m ON m.id = r.match_id
            WHERE r.account_id = ? AND m.status = 'COMPLETED'
        ) history WHERE recent_number <= 10 OR placement_number <= ?
        ORDER BY completed_at DESC, match_id DESC
        """;

    public CompetitiveRecords(JdbcTemplate db) { this.db = db; }

    public Map<String, CompetitiveProfile> forAccount(UUID id) {
        Map<String, Totals> totals = new LinkedHashMap<>();
        db.query(TOTALS, (RowCallbackHandler) row -> totals.put(row.getString("mode"), new Totals(row.getLong("games"), row.getLong("wins"), row.getLong("draws"), row.getLong("kills"), row.getLong("deaths"), row.getLong("assists"))), id);
        Map<String, List<RecentMatch>> recent = new LinkedHashMap<>();
        Map<String, Integer> placementWins = new LinkedHashMap<>();
        db.query(HISTORY, (RowCallbackHandler) row -> {
            String mode = row.getString("mode");
            if (row.getInt("placement_number") <= RatingPolicy.PLACEMENTS && row.getBoolean("won")) placementWins.merge(mode, 1, Integer::sum);
            if (row.getInt("recent_number") <= 10) recent.computeIfAbsent(mode, key -> new ArrayList<>()).add(new RecentMatch(row.getObject("match_id", UUID.class), row.getString("map_id"), row.getString("outcome"), row.getInt("kills"), row.getInt("deaths"), row.getInt("assists"), row.getInt("rank_points_delta"), row.getInt("rating_delta"), row.getTimestamp("completed_at").toInstant()));
        }, id, RatingPolicy.PLACEMENTS);
        Map<String, CompetitiveProfile> result = new LinkedHashMap<>();
        db.query("SELECT * FROM profiles WHERE account_id = ?", (RowCallbackHandler) row -> {
            for (String key : List.of("ffa", "teams")) {
                boolean team = key.equals("teams"); String prefix = team ? "" : "ffa_", mode = team ? "RANKED" : "CASUAL";
                var stats = totals.getOrDefault(mode, EMPTY);
                result.put(key, new CompetitiveProfile(row.getString(prefix + "rank_tier"), 5 - row.getInt(prefix + "rank_index") % 5, row.getInt(prefix + "rank_points"), row.getInt(prefix + "rank_placements"), placementWins.getOrDefault(mode, 0), row.getInt(team ? "ranked_games" : "ffa_ranked_games"), row.getInt(team ? "ranked_rating" : "casual_rating"),
                    stats.games(), stats.wins(), stats.draws(), stats.games() - stats.wins() - stats.draws(), stats.kills(), stats.deaths(), stats.assists(),
                    stats.games() == 0 ? 0 : stats.wins() * 100.0 / stats.games(), stats.kills() / (double) Math.max(1, stats.deaths()), (stats.kills() + stats.assists()) / (double) Math.max(1, stats.deaths()), List.copyOf(recent.getOrDefault(mode, List.of()))));
            }
        }, id);
        return Map.copyOf(result);
    }
}
