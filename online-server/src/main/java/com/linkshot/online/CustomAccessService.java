package com.linkshot.online;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CustomAccessService {
    public record Ticket(String ticket, String engineUrl, Instant expiresAt) {}
    private record Gateway(String id, String url) {}
    private final JdbcTemplate db;
    private final AccountService accounts;
    private final EngineRegistry engines;
    private final OnlineProperties properties;
    private final SecureRandom random = new SecureRandom();
    public CustomAccessService(JdbcTemplate db, AccountService accounts, EngineRegistry engines, OnlineProperties properties) { this.db = db; this.accounts = accounts; this.engines = engines; this.properties = properties; }
    public boolean available() { return properties.engineEnabled() && engines.online(); }

    @Transactional
    public Ticket ticket(UUID account) {
        if (!available()) throw new IllegalArgumentException("사용자 대전 서버가 준비되지 않았습니다.");
        db.queryForObject("SELECT id FROM matchmaking_lock WHERE id = 1 FOR UPDATE", Integer.class);
        UUID active = db.queryForObject("SELECT active_match_id FROM profiles WHERE account_id = ? FOR UPDATE", UUID.class, account);
        if (active != null) throw new IllegalArgumentException("진행 중인 일반·랭크 경기를 먼저 종료하거나 재접속해 주세요.");
        db.update("DELETE FROM match_queue WHERE account_id = ?", account);
        String current = db.queryForObject("SELECT engine_id FROM custom_gateway_lock WHERE id = 1 FOR UPDATE", String.class);
        List<Gateway> choices = db.query("SELECT id, public_url FROM engines WHERE id = ? AND heartbeat_at > CURRENT_TIMESTAMP - INTERVAL '15 seconds'", (row, index) -> new Gateway(row.getString(1), row.getString(2)), current);
        if (choices.isEmpty()) choices = db.query("SELECT id, public_url FROM engines WHERE heartbeat_at > CURRENT_TIMESTAMP - INTERVAL '15 seconds' ORDER BY CASE WHEN public_url = ? THEN 0 ELSE 1 END, id LIMIT 1", (row, index) -> new Gateway(row.getString(1), row.getString(2)), properties.enginePublicUrl());
        if (choices.isEmpty()) throw new IllegalArgumentException("사용자 대전 서버 연결을 기다려 주세요.");
        Gateway gateway = choices.getFirst(); db.update("UPDATE custom_gateway_lock SET engine_id = ? WHERE id = 1", gateway.id());
        byte[] bytes = new byte[32]; random.nextBytes(bytes); String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); Instant until = Instant.now().plusSeconds(60);
        db.update("DELETE FROM custom_tickets WHERE account_id = ? OR expires_at < CURRENT_TIMESTAMP", account);
        db.update("INSERT INTO custom_tickets(token_hash, account_id, engine_id, expires_at) VALUES (?, ?, ?, ?)", hash(token), account, gateway.id(), Timestamp.from(until));
        return new Ticket(token, gateway.url(), until);
    }

    @Transactional
    public AccountService.Profile consume(String token, String engineId) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}") || engineId == null || !engineId.matches("[A-Za-z0-9_-]{8,64}")) throw new IllegalArgumentException("Invalid custom gateway ticket");
        var ids = db.query("UPDATE custom_tickets SET consumed_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND engine_id = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP RETURNING account_id", (row, index) -> row.getObject(1, UUID.class), hash(token), engineId);
        if (ids.size() != 1) throw new IllegalArgumentException("Invalid or expired custom gateway ticket");
        return accounts.profile(ids.getFirst());
    }
    public void expire() { db.update("DELETE FROM custom_tickets WHERE expires_at < CURRENT_TIMESTAMP"); }
    private static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
}
