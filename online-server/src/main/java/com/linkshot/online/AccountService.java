package com.linkshot.online;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
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
    private final CompetitiveRecords records;
    public AccountService(JdbcTemplate db, PasswordEncoder passwords, GameCatalog catalog, CompetitiveRecords records) { this.db = db; this.passwords = passwords; this.catalog = catalog; this.records = records; }
    public record Credentials(UUID id, String username, String passwordHash) {}
    public record UsernameAvailability(String username, boolean available) {}
    public record RecentMatch(UUID matchId, String mapId, String outcome, int kills, int deaths, int assists, int rankPointsDelta, int ratingDelta, Instant completedAt) {}
    public record CompetitiveProfile(String rankTier, int rankDivision, int rankPoints, int placementsPlayed, int placementWins, int rankedGames, int rating, long roundsPlayed, long wins, long draws, long losses, long kills, long deaths, long assists, double winRate, double kd, double kda, List<RecentMatch> recentMatches) {}
    public record Profile(UUID id, String username, String callsign, String characterId, String outfitId, long kills, long deaths, long points, int roundsPlayed, int wins, int casualRating, String rankTier, int rankDivision, int rankPoints, int placementsPlayed, int placementWins, int rankedGames, List<String> ownedWeapons, Map<String, Long> weaponKills, List<String> suppressedWeapons, Map<String, CompetitiveProfile> competitive, List<String> ownedOutfits) {}

    public Credentials credentials(String username) {
        return db.query("SELECT id, username, password_hash FROM accounts WHERE username = ?", (row, index) -> new Credentials(row.getObject("id", UUID.class), row.getString("username"), row.getString("password_hash")), normalizeUsername(username)).stream().findFirst().orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));
    }
    public static String normalizeUsername(String value) { return value == null ? "" : value.toLowerCase(Locale.ROOT); }

    public UsernameAvailability usernameAvailability(String username) {
        String name = normalizeUsername(username);
        if (!name.matches("[a-z0-9_]{3,24}")) throw new IllegalArgumentException("아이디는 영문/숫자/_ 3–24자여야 합니다.");
        boolean exists = Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS (SELECT 1 FROM accounts WHERE username = ?)", Boolean.class, name));
        return new UsernameAvailability(name, !exists);
    }

    @Transactional
    public Profile register(String username, String password) {
        username = normalizeUsername(username);
        if (!username.matches("[a-z0-9_]{3,24}") || password == null || password.codePointCount(0, password.length()) < 8 || password.getBytes(StandardCharsets.UTF_8).length > 72) throw new IllegalArgumentException("아이디는 영문/숫자/_ 3–24자, 비밀번호는 8자 이상·UTF-8 72바이트 이하여야 합니다.");
        UUID id = UUID.randomUUID();
        try { db.update("INSERT INTO accounts(id, username, password_hash, callsign) VALUES (?, ?, ?, ?)", id, username, passwords.encode(password), username); }
        catch (DuplicateKeyException ex) { throw new DuplicateUsernameException(); }
        db.update("INSERT INTO profiles(account_id) VALUES (?)", id);
        for (String weapon : catalog.freeWeapons()) db.update("INSERT INTO owned_weapons(account_id, weapon_id) VALUES (?, ?)", id, weapon);
        db.update("INSERT INTO owned_outfits(account_id, outfit_id) VALUES (?, 'field')", id);
        return profile(id);
    }

    @Transactional
    public Profile updateCallsign(String username, String callsign) {
        String name = callsign == null ? "" : callsign.replaceAll("[\\p{C}<>]", "").strip();
        if (name.isEmpty() || name.codePointCount(0, name.length()) > 24) throw new IllegalArgumentException("콜사인은 1–24자여야 합니다.");
        UUID id = credentials(username).id();
        db.update("UPDATE accounts SET callsign = ? WHERE id = ?", name, id);
        return profile(id);
    }

    @Transactional
    public Profile setSuppressor(String username, String weaponId, boolean equipped) {
        if (!catalog.firearm(weaponId)) throw new IllegalArgumentException("소음기를 장착할 총기를 확인해 주세요.");
        UUID id = credentials(username).id();
        long kills = db.query("SELECT kills FROM weapon_kills WHERE account_id = ? AND weapon_id = ?", (row, index) -> row.getLong(1), id, weaponId).stream().findFirst().orElse(0L);
        if (equipped && kills < catalog.mastery().suppressorKills()) throw new IllegalArgumentException("해당 총기 Lv." + catalog.mastery().suppressorLevel() + "에서 소음기가 해금됩니다.");
        if (equipped) db.update("INSERT INTO equipped_suppressors(account_id, weapon_id) VALUES (?, ?) ON CONFLICT DO NOTHING", id, weaponId);
        else db.update("DELETE FROM equipped_suppressors WHERE account_id = ? AND weapon_id = ?", id, weaponId);
        return profile(id);
    }

    @Transactional
    public Profile purchaseWeapon(String username, String weaponId) {
        int price = catalog.weaponPrice(weaponId);
        UUID id = credentials(username).id();
        db.queryForObject("SELECT points FROM profiles WHERE account_id = ? FOR UPDATE", Long.class, id);
        if (!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS (SELECT 1 FROM owned_weapons WHERE account_id = ? AND weapon_id = ?)", Boolean.class, id, weaponId))) {
            if (db.update("UPDATE profiles SET points = points - ? WHERE account_id = ? AND points >= ?", price, id, price) != 1) throw new IllegalArgumentException("계정 LP가 부족합니다.");
            db.update("INSERT INTO owned_weapons(account_id, weapon_id) VALUES (?, ?)", id, weaponId);
        }
        return profile(id);
    }
    @Transactional
    public Profile selectOutfit(String username, String outfitId, boolean purchase) {
        Integer price = outfitId == null ? null : GameCatalog.OUTFITS.get(outfitId);
        if (price == null) throw new IllegalArgumentException("외형을 확인해 주세요.");
        UUID id = credentials(username).id();
        db.queryForObject("SELECT points FROM profiles WHERE account_id = ? FOR UPDATE", Long.class, id);
        boolean owned = Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS (SELECT 1 FROM owned_outfits WHERE account_id = ? AND outfit_id = ?)", Boolean.class, id, outfitId));
        if (!owned) {
            if (!purchase) throw new IllegalArgumentException("먼저 외형을 구매해 주세요.");
            if (db.update("UPDATE profiles SET points = points - ? WHERE account_id = ? AND points >= ?", price, id, price) != 1) throw new IllegalArgumentException("계정 LP가 부족합니다.");
            db.update("INSERT INTO owned_outfits(account_id, outfit_id) VALUES (?, ?)", id, outfitId);
        }
        db.update("UPDATE accounts SET outfit_id = ? WHERE id = ?", outfitId, id);
        return profile(id);
    }
    @Transactional
    public Profile selectCharacter(String username, String characterId) {
        if (characterId == null || !List.of("male", "female").contains(characterId)) throw new IllegalArgumentException("캐릭터를 확인해 주세요.");
        UUID id = credentials(username).id();
        db.update("UPDATE accounts SET character_id = ? WHERE id = ?", characterId, id);
        return profile(id);
    }

    public Profile profile(String username) { return profile(credentials(username).id()); }
    public Profile profile(UUID id) {
        List<String> owned = db.queryForList("SELECT weapon_id FROM owned_weapons WHERE account_id = ? ORDER BY weapon_id", String.class, id);
        Map<String, Long> kills = new LinkedHashMap<>();
        db.query("SELECT weapon_id, kills FROM weapon_kills WHERE account_id = ? ORDER BY weapon_id", row -> { kills.put(row.getString(1), row.getLong(2)); }, id);
        List<String> suppressed = db.queryForList("SELECT e.weapon_id FROM equipped_suppressors e JOIN weapon_kills k ON k.account_id = e.account_id AND k.weapon_id = e.weapon_id WHERE e.account_id = ? AND k.kills >= ? ORDER BY e.weapon_id", String.class, id, catalog.mastery().suppressorKills()).stream().filter(catalog::firearm).toList();
        Map<String, CompetitiveProfile> competitive = records.forAccount(id);
        List<String> outfits = db.queryForList("SELECT outfit_id FROM owned_outfits WHERE account_id = ? ORDER BY outfit_id", String.class, id);
        return db.queryForObject("SELECT a.*, p.* FROM accounts a JOIN profiles p ON p.account_id = a.id WHERE a.id = ?", (row, index) -> new Profile(id, row.getString("username"), row.getString("callsign"), row.getString("character_id"), row.getString("outfit_id"), row.getLong("kills"), row.getLong("deaths"), row.getLong("points"), row.getInt("rounds_played"), row.getInt("wins"), row.getInt("casual_rating"), row.getString("rank_tier"), 5 - row.getInt("rank_index") % 5, row.getInt("rank_points"), row.getInt("rank_placements"), competitive.get("teams").placementWins(), row.getInt("ranked_games"), owned, kills, suppressed, competitive, outfits), id);
    }

}
