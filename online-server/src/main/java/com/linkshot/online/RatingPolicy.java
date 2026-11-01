package com.linkshot.online;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Initial server-owned FFA policy. Shop LP is never an input to this class. */
public final class RatingPolicy {
    private RatingPolicy() {}
    public record Player(String id, int rating, int kills, int deaths, int humanKills, int humanDeaths, boolean abandoned) {}
    public record Change(int ratingDelta, int outcome) {} // top half=1, boundary tie=0, bottom half=-1
    public record RankProgress(int index, int points, int placements, int games) {}
    public record Promotion(RankProgress progress, int pointDelta) {}
    public static final List<String> TIERS = List.of("BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND");

    public static Map<String, Change> settle(boolean ranked, List<Player> players) {
        Map<String, Integer> deltas = new LinkedHashMap<>(); for (Player player : players) deltas.put(player.id(), 0);
        boolean contested = players.size() >= 2 && (players.stream().anyMatch(Player::abandoned) && ranked || players.stream().mapToInt(Player::humanKills).sum() > 0);
        if (contested) for (int i = 0; i < players.size(); i++) for (int j = i + 1; j < players.size(); j++) {
            Player a = players.get(i), b = players.get(j); int comparison = compare(a, b, ranked);
            double actual = comparison < 0 ? 1 : comparison > 0 ? 0 : .5, expected = 1 / (1 + Math.pow(10, (b.rating() - a.rating()) / 400.0));
            int delta = (int) Math.round((ranked ? 32 : 24) / (double) (players.size() - 1) * (actual - expected));
            deltas.merge(a.id(), delta, Integer::sum); deltas.merge(b.id(), -delta, Integer::sum);
        }
        Map<String, Change> result = new LinkedHashMap<>();
        for (Player player : players) {
            int better = 0, equal = 0;
            for (Player other : players) { int comparison = compare(other, player, ranked); if (comparison < 0) better++; else if (comparison == 0) equal++; }
            int outcome = !contested ? 0 : player.abandoned() ? -1 : better + equal <= players.size() / 2 ? 1 : better + 1 > players.size() / 2 ? -1 : 0;
            int delta = deltas.get(player.id()); if (ranked && player.abandoned()) delta = Math.min(-16, delta);
            result.put(player.id(), new Change(delta, outcome));
        }
        return result;
    }

    private static int compare(Player a, Player b, boolean ranked) {
        if (a.abandoned() != b.abandoned()) return a.abandoned() ? 1 : -1;
        if (a.abandoned()) return 0;
        int kills = Integer.compare(ranked ? b.kills() : b.humanKills(), ranked ? a.kills() : a.humanKills());
        return kills != 0 ? kills : Integer.compare(ranked ? a.deaths() : a.humanDeaths(), ranked ? b.deaths() : b.humanDeaths());
    }

    public static Promotion advance(RankProgress before, int rating, int outcome) {
        int games = Math.min(1_000_000_000, before.games() + 1);
        if (before.placements() < 10) {
            int placements = before.placements() + 1;
            // Placement starts no higher than Gold I. 1000 MMR maps to Silver V.
            int index = placements == 10 ? Math.max(0, Math.min(14, (rating - 600) / 80)) : 0;
            return new Promotion(new RankProgress(index, 0, placements, games), 0);
        }
        int adjustment = Math.max(-10, Math.min(10, (rating - (600 + before.index() * 80)) / 80));
        int delta = outcome > 0 ? 25 + adjustment : outcome < 0 ? -25 + adjustment : 0;
        int total = Math.max(0, Math.min(2500, before.index() * 100 + before.points() + delta));
        int index = Math.min(24, total / 100), points = total - index * 100;
        return new Promotion(new RankProgress(index, points, 10, games), total - (before.index() * 100 + before.points()));
    }
    public static String tier(RankProgress state) { return state.placements() < 10 ? "UNRANKED" : TIERS.get(state.index() / 5); }
    public static int division(RankProgress state) { return 5 - state.index() % 5; }
}
