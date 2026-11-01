package com.linkshot.online;

import java.net.URI;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class EngineRegistry {
    private final JdbcTemplate db;
    public EngineRegistry(JdbcTemplate db) { this.db = db; }
    public record Heartbeat(String engineId, String publicUrl, int capacity, int activeMatches) {}
    public void heartbeat(Heartbeat request) {
        if (request.engineId() == null || !request.engineId().matches("[A-Za-z0-9_-]{8,64}") || request.capacity() < 1 || request.capacity() > 100 || request.activeMatches() < 0 || request.activeMatches() > request.capacity()) throw new IllegalArgumentException("Invalid engine heartbeat");
        if (request.publicUrl() == null) throw new IllegalArgumentException("Invalid public engine URL");
        URI uri = URI.create(request.publicUrl());
        if (!("ws".equals(uri.getScheme()) || "wss".equals(uri.getScheme())) || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || request.publicUrl().length() > 512) throw new IllegalArgumentException("Invalid public engine URL");
        db.update("INSERT INTO engines(id, public_url, capacity, active_matches) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET public_url = EXCLUDED.public_url, capacity = EXCLUDED.capacity, active_matches = EXCLUDED.active_matches, heartbeat_at = CURRENT_TIMESTAMP", request.engineId(), request.publicUrl(), request.capacity(), request.activeMatches());
    }
    public boolean online() { return db.queryForObject("SELECT COUNT(*) FROM engines WHERE heartbeat_at > CURRENT_TIMESTAMP - INTERVAL '15 seconds'", Integer.class) > 0; }
    public int freeSlots() {
        int capacity = db.queryForObject("SELECT COALESCE(SUM(capacity), 0) FROM engines WHERE heartbeat_at > CURRENT_TIMESTAMP - INTERVAL '15 seconds'", Integer.class);
        int reported = db.queryForObject("SELECT COALESCE(SUM(active_matches), 0) FROM engines WHERE heartbeat_at > CURRENT_TIMESTAMP - INTERVAL '15 seconds'", Integer.class);
        int pending = db.queryForObject("SELECT COUNT(*) FROM online_matches WHERE status = 'PENDING'", Integer.class), claimed = db.queryForObject("SELECT COUNT(*) FROM online_matches WHERE status = 'CLAIMED'", Integer.class);
        return Math.max(0, capacity - pending - Math.max(reported, claimed));
    }
    public String publicUrl(String engineId, String fallback) { return db.query("SELECT public_url FROM engines WHERE id = ?", (row, index) -> row.getString(1), engineId).stream().findFirst().orElse(fallback); }
}
