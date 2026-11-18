package com.linkshot.online;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Cosmetic LAN proof only: cannot join online rooms, cancel queues or change identity. */
@Service
public class RankBadgeService {
    public record Ticket(String ticket, Instant expiresAt) {}
    private final JdbcTemplate db;
    private final AccountService accounts;
    private final SecureRandom random = new SecureRandom();
    public RankBadgeService(JdbcTemplate db, AccountService accounts) { this.db = db; this.accounts = accounts; }

    @Transactional
    public Ticket issue(UUID account, String engineId) {
        if (engineId == null || !engineId.matches("[A-Za-z0-9_-]{8,64}") || !Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS (SELECT 1 FROM engines WHERE id = ? AND heartbeat_at > CURRENT_TIMESTAMP - INTERVAL '15 seconds')", Boolean.class, engineId))) throw new IllegalArgumentException("랭크 마크 확인 서버가 준비되지 않았습니다.");
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); Instant expires = Instant.now().plusSeconds(60);
        db.update("DELETE FROM rank_badge_tickets WHERE account_id = ? OR expires_at < CURRENT_TIMESTAMP", account);
        db.update("INSERT INTO rank_badge_tickets(token_hash, account_id, engine_id, expires_at) VALUES (?, ?, ?, ?)", hash(token), account, engineId, Timestamp.from(expires));
        return new Ticket(token, expires);
    }
    @Transactional
    public AccountService.Profile consume(String token, String engineId) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}") || engineId == null || !engineId.matches("[A-Za-z0-9_-]{8,64}")) throw new IllegalArgumentException("Invalid rank badge proof");
        var ids = db.query("UPDATE rank_badge_tickets SET consumed_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND engine_id = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP RETURNING account_id", (row, index) -> row.getObject(1, UUID.class), hash(token), engineId);
        if (ids.size() != 1) throw new IllegalArgumentException("Invalid or expired rank badge proof");
        return accounts.profile(ids.getFirst());
    }
    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 60000, initialDelay = 60000)
    public void expire() { db.update("DELETE FROM rank_badge_tickets WHERE expires_at < CURRENT_TIMESTAMP"); }
    private static String hash(String token) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
}
