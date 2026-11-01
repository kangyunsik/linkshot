package com.linkshot.online;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class MatchService {
    public enum Mode { CASUAL, RANKED }
    public record Plan(UUID id, Mode mode, String mapId, int bots, int fragLimit, int roundSeconds, String status, String engineId, List<AccountService.Profile> players) {}
    public record Ticket(String ticket, String engineUrl, UUID matchId, Instant expiresAt) {}
    public record Performance(String id, boolean bot, int kills, int deaths, Map<String, Integer> weaponKills) {}
    public record Completion(String engineId, String roundId, List<Performance> players) {}
    private final JdbcTemplate db;
    private final AccountService accounts;
    private final GameCatalog catalog;
    private final OnlineProperties properties;
    private final SecureRandom random = new SecureRandom();
    private final JsonMapper json = JsonMapper.builder().build();
    public MatchService(JdbcTemplate db, AccountService accounts, GameCatalog catalog, OnlineProperties properties) { this.db = db; this.accounts = accounts; this.catalog = catalog; this.properties = properties; }

    // Only trusted server-side matchmaking may call this. There is deliberately
    // no browser endpoint which creates an online match or imports a LAN room.
    @Transactional
    public Plan create(Mode mode, List<UUID> players, int bots, String mapId, int fragLimit, int roundSeconds) {
        if (mode == null || players == null || players.isEmpty() || new HashSet<>(players).size() != players.size() || players.size() + bots > 8 || bots < 0 || bots > 7 || mode == Mode.RANKED && (bots != 0 || players.size() < 2) || !catalog.maps().contains(mapId) || fragLimit < 1 || fragLimit > 200 || roundSeconds < 60 || roundSeconds > 3600) throw new IllegalArgumentException("Invalid online match assignment");
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO online_matches(id, mode, map_id, bot_count, frag_limit, round_seconds) VALUES (?, ?, ?, ?, ?, ?)", id, mode.name(), mapId, bots, fragLimit, roundSeconds);
        for (UUID player : players.stream().sorted().toList()) {
            var active = db.query("SELECT active_match_id FROM profiles WHERE account_id = ? FOR UPDATE", (row, index) -> row.getObject(1, UUID.class), player);
            if (active.size() != 1 || active.get(0) != null) throw new IllegalArgumentException("A player is unavailable for this match");
            db.update("INSERT INTO match_players(match_id, account_id) VALUES (?, ?)", id, player);
            db.update("UPDATE profiles SET active_match_id = ? WHERE account_id = ?", id, player);
        }
        return plan(id);
    }

    public Plan plan(UUID id) {
        List<UUID> players = db.queryForList("SELECT account_id FROM match_players WHERE match_id = ? ORDER BY account_id", UUID.class, id);
        return db.query("SELECT * FROM online_matches WHERE id = ?", (row, index) -> new Plan(id, Mode.valueOf(row.getString("mode")), row.getString("map_id"), row.getInt("bot_count"), row.getInt("frag_limit"), row.getInt("round_seconds"), row.getString("status"), row.getString("engine_id"), players.stream().map(accounts::profile).toList()), id).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("Unknown match"));
    }
    public List<UUID> pending() { return db.queryForList("SELECT id FROM online_matches WHERE status = 'PENDING' ORDER BY created_at LIMIT 32", UUID.class); }
    public Plan active(UUID account) {
        UUID id = db.queryForObject("SELECT active_match_id FROM profiles WHERE account_id = ?", UUID.class, account);
        return id == null ? null : plan(id);
    }

    @Transactional
    public Plan claim(UUID id, String engineId) {
        validateEngineId(engineId);
        int changed = db.update("UPDATE online_matches SET status = 'CLAIMED', engine_id = ?, heartbeat_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PENDING'", engineId, id);
        Plan plan = plan(id);
        if (changed != 1 && !(plan.status().equals("CLAIMED") && engineId.equals(plan.engineId()))) throw new IllegalArgumentException("Match is not available to this engine");
        if (plan.mode() == Mode.RANKED && plan.bots() != 0) throw new IllegalArgumentException("Ranked matches cannot contain AI");
        return plan;
    }
    public void heartbeat(UUID id, String engineId) {
        validateEngineId(engineId);
        if (db.update("UPDATE online_matches SET heartbeat_at = CURRENT_TIMESTAMP WHERE id = ? AND engine_id = ? AND status = 'CLAIMED'", id, engineId) != 1) throw new IllegalArgumentException("No active engine lease");
    }

    @Transactional
    public Ticket ticket(UUID account) {
        UUID id = db.queryForObject("SELECT active_match_id FROM profiles WHERE account_id = ? FOR UPDATE", UUID.class, account);
        if (id == null || !properties.engineEnabled()) throw new IllegalArgumentException("No online match is ready");
        Plan plan = plan(id); if (!plan.status().equals("CLAIMED")) throw new IllegalArgumentException("The combat engine is not ready");
        byte[] bytes = new byte[32]; random.nextBytes(bytes); String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); Instant until = Instant.now().plusSeconds(60);
        db.update("DELETE FROM match_tickets WHERE account_id = ?", account);
        db.update("INSERT INTO match_tickets(token_hash, match_id, account_id, expires_at) VALUES (?, ?, ?, ?)", hash(token), id, account, Timestamp.from(until));
        return new Ticket(token, properties.enginePublicUrl(), id, until);
    }

    @Transactional
    public AccountService.Profile consume(UUID id, String token, String engineId) {
        Plan plan = owned(id, engineId);
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException("Invalid match ticket");
        var ids = db.query("UPDATE match_tickets SET consumed_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND match_id = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP RETURNING account_id", (row, index) -> row.getObject(1, UUID.class), hash(token), id);
        if (ids.size() != 1 || plan.players().stream().noneMatch(player -> player.id().equals(ids.get(0)))) throw new IllegalArgumentException("Invalid or expired match ticket");
        return accounts.profile(ids.get(0));
    }

    @Transactional
    public boolean complete(UUID id, Completion result) {
        if (result == null || !id.toString().equals(result.roundId()) || result.players() == null) throw new IllegalArgumentException("Invalid online result");
        db.queryForObject("SELECT id FROM online_matches WHERE id = ? FOR UPDATE", UUID.class, id);
        Plan plan = plan(id); validateEngineId(result.engineId());
        if (!result.engineId().equals(plan.engineId())) throw new IllegalArgumentException("Wrong engine lease");
        validateResult(plan, result.players());
        List<Performance> ordered = result.players().stream().sorted(Comparator.comparing(Performance::id)).map(player -> new Performance(player.id(), player.bot(), player.kills(), player.deaths(), new TreeMap<>(player.weaponKills()))).toList();
        String fingerprint = hash(json.writeValueAsString(ordered));
        String prior = db.queryForObject("SELECT result_hash FROM online_matches WHERE id = ?", String.class, id);
        if (plan.status().equals("COMPLETED")) { if (!fingerprint.equals(prior)) throw new IllegalArgumentException("A different result was already settled"); return false; }
        if (!plan.status().equals("CLAIMED")) throw new IllegalArgumentException("Match cannot be settled");
        Performance winner = ordered.stream().sorted(Comparator.comparingInt(Performance::kills).reversed().thenComparingInt(Performance::deaths)).findFirst().orElseThrow();
        for (Performance player : ordered) {
            if (player.bot()) continue;
            UUID account = UUID.fromString(player.id()); boolean won = winner.id().equals(player.id());
            int points = catalog.reward("completion") + player.kills() * catalog.reward("perKill") + (won ? catalog.reward("victory") : 0);
            db.update("INSERT INTO match_results(match_id, account_id, kills, deaths, points, weapon_kills) VALUES (?, ?, ?, ?, ?, ?)", id, account, player.kills(), player.deaths(), points, json.writeValueAsString(player.weaponKills()));
            db.update("UPDATE profiles SET kills = LEAST(1000000000, kills + ?), deaths = LEAST(1000000000, deaths + ?), points = LEAST(1000000000, points + ?), rounds_played = rounds_played + 1, wins = wins + ?, active_match_id = NULL WHERE account_id = ? AND active_match_id = ?", player.kills(), player.deaths(), points, won ? 1 : 0, account, id);
            for (var weapon : player.weaponKills().entrySet()) db.update("INSERT INTO weapon_kills(account_id, weapon_id, kills) VALUES (?, ?, ?) ON CONFLICT(account_id, weapon_id) DO UPDATE SET kills = LEAST(1000000000, weapon_kills.kills + EXCLUDED.kills)", account, weapon.getKey(), weapon.getValue());
        }
        db.update("UPDATE online_matches SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, result_hash = ? WHERE id = ?", fingerprint, id);
        db.update("DELETE FROM match_tickets WHERE match_id = ?", id);
        // Ratings intentionally stay separate and unchanged until matchmaking
        // and ranked policies are explicitly enabled in their own services.
        return true;
    }

    private void validateResult(Plan plan, List<Performance> players) {
        if (players.size() != plan.players().size() + plan.bots() || new HashSet<>(players.stream().map(Performance::id).toList()).size() != players.size()) throw new IllegalArgumentException("Invalid result roster");
        var humans = new HashSet<>(plan.players().stream().map(player -> player.id().toString()).toList());
        int bots = 0, kills = 0, deaths = 0;
        for (Performance player : players) {
            if (player.id() == null || player.kills() < 0 || player.kills() > plan.fragLimit() + 7 || player.deaths() < 0 || player.deaths() > plan.fragLimit() * 8 || player.weaponKills() == null || player.weaponKills().size() > 21) throw new IllegalArgumentException("Invalid result counts");
            if (player.bot()) { bots++; if (!player.id().matches("bot-[A-Za-z0-9-]{8,50}")) throw new IllegalArgumentException("Invalid AI identity"); }
            else if (!humans.remove(player.id())) throw new IllegalArgumentException("Unknown result participant");
            int weapons = 0; for (var weapon : player.weaponKills().entrySet()) { if (!catalog.weapon(weapon.getKey()) || weapon.getValue() == null || weapon.getValue() < 0 || weapon.getValue() > player.kills()) throw new IllegalArgumentException("Invalid weapon ledger"); weapons += weapon.getValue(); }
            if (weapons != player.kills()) throw new IllegalArgumentException("Weapon ledger must match kills");
            kills += player.kills(); deaths += player.deaths();
        }
        if (!humans.isEmpty() || bots != plan.bots() || plan.mode() == Mode.RANKED && bots != 0 || kills != deaths) throw new IllegalArgumentException("Invalid result integrity");
    }

    @Transactional
    public boolean cancel(UUID id, String engineId) {
        db.queryForObject("SELECT id FROM online_matches WHERE id = ? FOR UPDATE", UUID.class, id);
        Plan plan = plan(id); validateEngineId(engineId);
        if (!engineId.equals(plan.engineId())) throw new IllegalArgumentException("Wrong engine lease");
        if (plan.status().equals("COMPLETED") || plan.status().equals("CANCELLED")) return false;
        release(id); return true;
    }
    @Transactional
    public int expireInactive() {
        var stale = db.queryForList("SELECT id FROM online_matches WHERE (status = 'PENDING' AND created_at < CURRENT_TIMESTAMP - INTERVAL '30 seconds') OR (status = 'CLAIMED' AND heartbeat_at < CURRENT_TIMESTAMP - INTERVAL '60 seconds') FOR UPDATE SKIP LOCKED", UUID.class);
        for (UUID id : stale) release(id);
        db.update("DELETE FROM match_tickets WHERE expires_at < CURRENT_TIMESTAMP"); return stale.size();
    }
    private void release(UUID id) {
        db.update("UPDATE online_matches SET status = 'CANCELLED' WHERE id = ?", id);
        db.update("UPDATE profiles SET active_match_id = NULL WHERE active_match_id = ?", id);
        db.update("DELETE FROM match_tickets WHERE match_id = ?", id);
    }
    private Plan owned(UUID id, String engineId) { validateEngineId(engineId); Plan plan = plan(id); if (!plan.status().equals("CLAIMED") || !engineId.equals(plan.engineId())) throw new IllegalArgumentException("No active engine lease"); return plan; }
    private static void validateEngineId(String id) { if (id == null || !id.matches("[A-Za-z0-9_-]{8,64}")) throw new IllegalArgumentException("Invalid engine identity"); }
    private static String hash(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
