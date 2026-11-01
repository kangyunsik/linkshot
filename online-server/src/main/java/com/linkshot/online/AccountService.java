package com.linkshot.online;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService {
    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final GameCatalog catalog;
    public AccountService(JdbcTemplate db, PasswordEncoder passwords, GameCatalog catalog) { this.db = db; this.passwords = passwords; this.catalog = catalog; }
    public record Credentials(UUID id, String username, String passwordHash) {}
    public record Profile(UUID id, String username, String callsign, String characterId, String outfitId, long kills, long deaths, long points, int roundsPlayed, int wins, int casualRating, String rankTier, int rankDivision, int rankPoints, int placementsPlayed, int rankedGames, List<String> ownedWeapons, Map<String, Long> weaponKills) {}

    public Credentials credentials(String username) {
        return db.query("SELECT id, username, password_hash FROM accounts WHERE username = ?", (row, index) -> new Credentials(row.getObject("id", UUID.class), row.getString("username"), row.getString("password_hash")), normalizeUsername(username)).stream().findFirst().orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));
    }
    public static String normalizeUsername(String value) { return value == null ? "" : value.toLowerCase(Locale.ROOT); }

    @Transactional
    public Profile register(String username, String password, String callsign) {
        username = normalizeUsername(username);
        if (!username.matches("[a-z0-9_]{3,24}") || password == null || password.codePointCount(0, password.length()) < 12 || password.getBytes(StandardCharsets.UTF_8).length > 72) throw new IllegalArgumentException("아이디는 영문/숫자/_ 3–24자, 비밀번호는 12자 이상·UTF-8 72바이트 이하여야 합니다.");
        String name = callsign == null ? username : callsign.replaceAll("[\\p{C}<>]", "").strip();
        if (name.isEmpty() || name.codePointCount(0, name.length()) > 16) throw new IllegalArgumentException("콜사인은 1–16자여야 합니다.");
        UUID id = UUID.randomUUID();
        try { db.update("INSERT INTO accounts(id, username, password_hash, callsign) VALUES (?, ?, ?, ?)", id, username, passwords.encode(password), name); }
        catch (DuplicateKeyException ex) { throw new IllegalArgumentException("사용할 수 없는 아이디입니다."); }
        db.update("INSERT INTO profiles(account_id) VALUES (?)", id);
        for (String weapon : catalog.freeWeapons()) db.update("INSERT INTO owned_weapons(account_id, weapon_id) VALUES (?, ?)", id, weapon);
        return profile(id);
    }

    public Profile profile(String username) { return profile(credentials(username).id()); }
    public Profile profile(UUID id) {
        List<String> owned = db.queryForList("SELECT weapon_id FROM owned_weapons WHERE account_id = ? ORDER BY weapon_id", String.class, id);
        Map<String, Long> kills = new LinkedHashMap<>();
        db.query("SELECT weapon_id, kills FROM weapon_kills WHERE account_id = ? ORDER BY weapon_id", row -> { kills.put(row.getString(1), row.getLong(2)); }, id);
        return db.queryForObject("SELECT a.*, p.* FROM accounts a JOIN profiles p ON p.account_id = a.id WHERE a.id = ?", (row, index) -> new Profile(id, row.getString("username"), row.getString("callsign"), row.getString("character_id"), row.getString("outfit_id"), row.getLong("kills"), row.getLong("deaths"), row.getLong("points"), row.getInt("rounds_played"), row.getInt("wins"), row.getInt("casual_rating"), row.getString("rank_tier"), 5 - row.getInt("rank_index") % 5, row.getInt("rank_points"), row.getInt("rank_placements"), row.getInt("ranked_games"), owned, kills), id);
    }
}
