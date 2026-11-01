package com.linkshot.online;

import java.time.Instant;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.security.SecureRandom;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MatchmakingService {
    private final JdbcTemplate db;
    private final MatchService matches;
    private final EngineRegistry engines;
    private final GameCatalog catalog;
    private final OnlineProperties properties;
    private final boolean enabled;
    private final int required, waitSeconds, fragLimit, roundSeconds;
    private final SecureRandom random = new SecureRandom();
    public MatchmakingService(JdbcTemplate db, MatchService matches, EngineRegistry engines, GameCatalog catalog, OnlineProperties properties,
        @Value("${linkshot.matchmaking.enabled:true}") boolean enabled, @Value("${linkshot.matchmaking.players:4}") int required,
        @Value("${linkshot.matchmaking.casual-wait-seconds:30}") int waitSeconds, @Value("${linkshot.matchmaking.frag-limit:20}") int fragLimit,
        @Value("${linkshot.matchmaking.round-seconds:300}") int roundSeconds) {
        if (required < 2 || required > 8 || waitSeconds < 1 || waitSeconds > 120 || fragLimit < 1 || fragLimit > 200 || roundSeconds < 60 || roundSeconds > 3600) throw new IllegalArgumentException("Invalid matchmaking settings");
        this.db = db; this.matches = matches; this.engines = engines; this.catalog = catalog; this.properties = properties; this.enabled = enabled; this.required = required; this.waitSeconds = waitSeconds; this.fragLimit = fragLimit; this.roundSeconds = roundSeconds;
    }
    public record Entry(UUID account, MatchService.Mode mode, int rating, Instant queuedAt) {}
    public record Status(String state, MatchService.Mode mode, int elapsedSeconds, int playersFound, int requiredPlayers, Integer aiInSeconds, int ratingGap, UUID matchId, String reason) {}
    public boolean configured() { return enabled && properties.engineEnabled(); }
    public boolean available() { return configured() && engines.online(); }
    public int players() { return required; }
    public int waitSeconds() { return waitSeconds; }
    public boolean rankedAiEnabled() { return matches.rankedAiEnabled(); }
    private boolean fillsWithAi(MatchService.Mode mode) { return mode == MatchService.Mode.CASUAL || rankedAiEnabled(); }
    private long waited(Entry entry) { return Math.max(0, Duration.between(entry.queuedAt(), Instant.now()).toSeconds()); }
    private int gap(Entry entry) { return (int) Math.min(600L, 150 + waited(entry) / 15 * 50); }
    private List<Entry> entries() { return db.query("SELECT * FROM match_queue ORDER BY queued_at, account_id", (row, index) -> new Entry(row.getObject("account_id", UUID.class), MatchService.Mode.valueOf(row.getString("mode")), row.getInt("rating"), row.getTimestamp("queued_at").toInstant())); }

    @Transactional
    public Status join(UUID account, MatchService.Mode mode) {
        db.queryForObject("SELECT id FROM matchmaking_lock WHERE id = 1 FOR UPDATE", Integer.class);
        if (mode == null || !available()) throw new IllegalArgumentException("온라인 전투 노드가 준비되지 않았습니다.");
        var rows = db.query("SELECT active_match_id, casual_rating, ranked_rating FROM profiles WHERE account_id = ? FOR UPDATE", (row, index) -> new Object[] { row.getObject(1, UUID.class), row.getInt(2), row.getInt(3) }, account);
        if (rows.size() != 1) throw new IllegalArgumentException("Unknown account");
        if (rows.get(0)[0] != null) return status(account);
        var existing = entries().stream().filter(entry -> entry.account().equals(account)).findFirst();
        if (existing.isPresent() && existing.get().mode() != mode) throw new IllegalArgumentException("먼저 현재 매칭 대기를 취소하세요.");
        int rating = (int) rows.get(0)[mode == MatchService.Mode.CASUAL ? 1 : 2];
        db.update("INSERT INTO match_queue(account_id, mode, rating) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET heartbeat_at = CURRENT_TIMESTAMP", account, mode.name(), rating);
        return status(account);
    }
    public Status status(UUID account) {
        var active = matches.active(account);
        if (active != null) {
            boolean abandoned = db.queryForObject("SELECT abandoned FROM match_players WHERE match_id = ? AND account_id = ?", Boolean.class, active.id(), account);
            return new Status(abandoned ? "ABANDONED" : active.status().equals("CLAIMED") ? "READY" : "ASSIGNED", active.mode(), 0, active.players().size(), required, null, 0, active.id(), abandoned ? "탈주 처리되었습니다. 경기 종료와 정산을 기다려 주세요." : "");
        }
        var all = entries(); var entry = all.stream().filter(item -> item.account().equals(account)).findFirst();
        if (entry.isEmpty()) return new Status("IDLE", null, 0, 0, required, null, 0, null, available() ? "" : "온라인 전투 노드 연결을 기다리는 중입니다.");
        Entry own = entry.get(); int elapsed = (int) Math.min(Integer.MAX_VALUE, waited(own)), gap = gap(own);
        int found = (int) Math.min(required, all.stream().filter(item -> item.mode() == own.mode() && Math.abs(item.rating() - own.rating()) <= gap).count());
        return new Status("QUEUED", own.mode(), elapsed, found, required, fillsWithAi(own.mode()) ? Math.max(0, waitSeconds - elapsed) : null, gap, null, available() ? engines.freeSlots() > 0 ? "" : "전투 서버 정원을 기다리는 중입니다." : "전투 노드 재연결을 기다리는 중입니다.");
    }
    @Transactional public Status cancel(UUID account) {
        db.queryForObject("SELECT id FROM matchmaking_lock WHERE id = 1 FOR UPDATE", Integer.class);
        db.queryForObject("SELECT account_id FROM profiles WHERE account_id = ? FOR UPDATE", UUID.class, account);
        if (matches.active(account) != null) throw new IllegalArgumentException("이미 배정된 경기는 취소할 수 없습니다. 경기 입장/재접속을 이용하세요.");
        db.update("DELETE FROM match_queue WHERE account_id = ?", account); return status(account);
    }
    public void heartbeat(UUID account) { db.update("UPDATE match_queue SET heartbeat_at = CURRENT_TIMESTAMP WHERE account_id = ?", account); }

    @Scheduled(fixedDelay = 1000, initialDelay = 1000) @Transactional
    public void matchmake() {
        if (!configured()) return;
        db.queryForObject("SELECT id FROM matchmaking_lock WHERE id = 1 FOR UPDATE", Integer.class);
        db.update("DELETE FROM match_queue WHERE heartbeat_at < CURRENT_TIMESTAMP - INTERVAL '20 seconds'");
        if (!engines.online()) return;
        int slots = engines.freeSlots(); if (slots <= 0) return;
        var all = entries(); var used = new HashSet<UUID>();
        for (Entry anchor : all) {
            if (slots <= 0) break; if (used.contains(anchor.account())) continue;
            int gap = gap(anchor); var group = new ArrayList<Entry>();
            for (Entry candidate : all) if (!used.contains(candidate.account()) && candidate.mode() == anchor.mode() && Math.abs(candidate.rating() - anchor.rating()) <= gap && group.size() < required) group.add(candidate);
            boolean ready = group.size() == required || fillsWithAi(anchor.mode()) && waited(anchor) >= waitSeconds;
            if (!ready) continue;
            int bots = required - group.size();
            matches.create(anchor.mode(), group.stream().map(Entry::account).toList(), bots, catalog.maps().get(random.nextInt(catalog.maps().size())), fragLimit, roundSeconds); slots--;
            for (Entry item : group) { used.add(item.account()); db.update("DELETE FROM match_queue WHERE account_id = ?", item.account()); }
        }
    }
}
