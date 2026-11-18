package com.linkshot.online;

import static org.junit.jupiter.api.Assertions.*;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.annotation.DirtiesContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class OnlineServerTest {
    private static final String ENGINE_KEY = UUID.randomUUID() + "-" + UUID.randomUUID();
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String LAN_ORIGIN = "http://" + String.join(".", "192", "168", "40", "25") + ":4174";
    private static final EmbeddedPostgres PG;
    static {
        try {
            var base = Files.createDirectories(Path.of("target", "postgres-tests").toAbsolutePath());
            PG = EmbeddedPostgres.builder().setOverrideWorkingDirectory(base.toFile()).setDataDirectory(Files.createTempDirectory(base, "data-")).setLocaleConfig("locale", "C").setServerConfig("unix_socket_directories", "").setPort(0).start();
        } catch (Exception error) { throw new ExceptionInInitializerError(error); }
    }
    @DynamicPropertySource static void properties(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", () -> PG.getJdbcUrl("postgres", "postgres"));
        properties.add("spring.datasource.username", () -> "postgres"); properties.add("spring.datasource.password", () -> "");
        properties.add("linkshot.engine-secret", () -> ENGINE_KEY); properties.add("linkshot.allowed-origins", () -> LAN_ORIGIN);
    }
    @org.springframework.beans.factory.annotation.Value("${local.server.port}") int port;
    @Autowired AccountService accounts;
    @Autowired MatchService matches;
    @Autowired JdbcTemplate db;
    @Autowired GameCatalog catalog;
    @Autowired EngineRegistry engines;
    @Autowired org.springframework.security.web.FilterChainProxy filters;
    @org.junit.jupiter.api.BeforeEach void isolateAuthenticationLimits() {
        for (var chain : filters.getFilterChains()) for (var filter : chain.getFilters()) if (filter instanceof AuthRateLimitFilter) ((Map<?, ?>) org.springframework.test.util.ReflectionTestUtils.getField(filter, "windows")).clear();
    }
    @org.junit.jupiter.api.AfterEach void removeCosmeticBadgeTestEngine() { db.update("DELETE FROM engines WHERE id = 'test-rank-badge-engine'"); }
    private String base() { return "http://127.0.0.1:" + port; }
    private String username() { return "u_" + UUID.randomUUID().toString().replace("-", "").substring(0, 18); }
    private AccountService.Profile account() { return accounts.register(username(), "test-only-long-passphrase"); }
    private JsonNode json(HttpResponse<String> response) { return JSON.readTree(response.body()); }
    private final class Browser {
        final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        final HttpClient http = HttpClient.newBuilder().cookieHandler(cookies).connectTimeout(Duration.ofSeconds(5)).build();
        String csrf;
        HttpResponse<String> request(String method, String path, Object body, boolean authorized) throws Exception {
            var builder = HttpRequest.newBuilder(URI.create(base() + path)).timeout(Duration.ofSeconds(10));
            if (authorized && csrf != null) builder.header("X-CSRF-TOKEN", csrf);
            String content = body == null ? "" : body instanceof String text ? text : JSON.writeValueAsString(body);
            if (body != null) builder.header("Content-Type", body instanceof String ? "application/x-www-form-urlencoded" : "application/json");
            builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(content)); return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        }
        void csrf() throws Exception { csrf = json(request("GET", "/api/auth/csrf", null, false)).get("token").asString(); }
        HttpResponse<String> register(String username) throws Exception { csrf(); return request("POST", "/api/auth/register", Map.of("username", username, "password", "test-only-long-passphrase"), true); }
        HttpResponse<String> login(String username) throws Exception { return request("POST", "/api/auth/login", "username=" + URLEncoder.encode(username, StandardCharsets.UTF_8) + "&password=test-only-long-passphrase", true); }
    }
    private HttpResponse<String> engine(String path, Object body) throws Exception {
        return HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(base() + path)).timeout(Duration.ofSeconds(10)).header("Authorization", "Bearer " + ENGINE_KEY).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test void unauthenticatedRequestsCannotReadProfilesOrWriteResults() throws Exception {
        var client = new Browser(); assertEquals(200, client.request("GET", "/api/health", null, false).statusCode());
        assertEquals(401, client.request("GET", "/api/account", null, false).statusCode());
        assertEquals(403, client.request("POST", "/api/auth/register", Map.of("username", username(), "password", "test-only-long-passphrase"), false).statusCode());
        assertEquals(401, client.request("GET", "/internal/matches/pending", null, false).statusCode());
        assertFalse(json(client.request("GET", "/api/health", null, false)).get("matchmaking").asBoolean());
    }

    @Test void registrationLoginJdbcSessionsAndLogoutProtectPasswordAndRotateSessionIdentity() throws Exception {
        var client = new Browser(); String name = username(); var created = client.register(name); assertEquals(201, created.statusCode());
        var profile = json(created); UUID id = UUID.fromString(profile.get("id").asString()); assertEquals(0, profile.get("points").asInt()); assertEquals(0, profile.get("kills").asInt());
        assertEquals(name, profile.get("callsign").asString());
        assertEquals(new HashSet<>(List.of("rifle", "pistol", "shotgun", "sniper")), new HashSet<>(JSON.convertValue(profile.get("ownedWeapons"), List.class)));
        String hash = db.queryForObject("SELECT password_hash FROM accounts WHERE id = ?", String.class, id); assertTrue(hash.startsWith("$2a$12$")); assertFalse(created.body().contains(hash)); assertFalse(created.body().contains("test-only-long-passphrase"));
        String oldCookie = client.cookies.getCookieStore().getCookies().get(0).getValue(), oldCsrf = client.csrf;
        var logged = client.login(name.toUpperCase(java.util.Locale.ROOT)); assertEquals(200, logged.statusCode());
        assertNotEquals(oldCookie, client.cookies.getCookieStore().getCookies().get(0).getValue()); assertTrue(logged.headers().allValues("set-cookie").stream().anyMatch(cookie -> cookie.startsWith("LINKSHOTSESSION=") && cookie.contains("Path=/api") && cookie.contains("HttpOnly") && cookie.contains("SameSite=Lax")));
        assertEquals(200, client.request("GET", "/api/account", null, false).statusCode());
        assertTrue(db.queryForObject("SELECT COUNT(*) FROM SPRING_SESSION WHERE PRINCIPAL_NAME = ?", Integer.class, name) > 0);
        client.csrf = oldCsrf; assertEquals(403, client.request("POST", "/api/auth/logout", null, true).statusCode());
        client.csrf(); assertEquals(204, client.request("POST", "/api/auth/logout", null, true).statusCode()); assertEquals(401, client.request("GET", "/api/account", null, false).statusCode());
    }

    @Test void clientProgressImportsAndMalformedRegistrationAreRejected() throws Exception {
        var client = new Browser(); String name = username(); assertEquals(201, client.register(name).statusCode());
        assertEquals(409, client.request("POST", "/api/auth/register", Map.of("username", name, "password", "test-only-long-passphrase"), true).statusCode());
        assertEquals(400, client.request("POST", "/api/auth/register", Map.of("username", username(), "password", "test-only-long-passphrase", "points", 999_999, "ownedWeapons", List.of("m82")), true).statusCode());
        assertEquals(400, client.request("POST", "/api/auth/register", Map.of("username", username(), "password", "가".repeat(30)), true).statusCode());
        assertEquals(400, client.request("POST", "/api/auth/register", Map.of("username", username(), "password", "short"), true).statusCode());
        assertEquals(200, client.login(name).statusCode()); client.csrf();
        assertNotEquals(200, client.request("POST", "/api/account", Map.of("kills", 500, "points", 999_999), true).statusCode()); assertEquals(0, accounts.profile(name).points());
    }
    @Test void passwordsRequireEightCharactersAndExactlyEightCharactersCanRegisterAndLogIn() throws Exception {
        var client = new Browser(); client.csrf();
        var rejected = client.request("POST", "/api/auth/register", Map.of("username", username(), "password", "seven77"), true);
        assertEquals(400, rejected.statusCode()); assertTrue(rejected.body().contains("8자 이상"));
        for (String password : List.of("eight888", "가나다라마바사아")) {
            var user = new Browser(); user.csrf(); String name = username();
            assertEquals(201, user.request("POST", "/api/auth/register", Map.of("username", name, "password", password), true).statusCode());
            var form = "username=" + URLEncoder.encode(name, StandardCharsets.UTF_8) + "&password=" + URLEncoder.encode(password, StandardCharsets.UTF_8);
            assertEquals(200, user.request("POST", "/api/auth/login", form, true).statusCode());
        }
    }
    @Test void cosmeticRankProofRequiresSessionAndCsrfAndCannotBeUsedTwiceOrForgeATier() throws Exception {
        engines.heartbeat(new EngineRegistry.Heartbeat("test-rank-badge-engine", "ws://127.0.0.1:8090/play", 24, 0));
        var anonymous = new Browser(); anonymous.csrf();
        assertEquals(401, anonymous.request("POST", "/api/account/rank-badge-ticket", Map.of("engineId", "test-rank-badge-engine"), true).statusCode());
        var client = new Browser(); String name = username(); client.register(name); client.login(name); client.csrf();
        assertEquals(403, client.request("POST", "/api/account/rank-badge-ticket", Map.of("engineId", "test-rank-badge-engine"), false).statusCode());
        assertEquals(400, client.request("POST", "/api/account/rank-badge-ticket", Map.of("engineId", "test-rank-badge-engine", "rankTier", "CHALLENGER"), true).statusCode());
        var issued = client.request("POST", "/api/account/rank-badge-ticket", Map.of("engineId", "test-rank-badge-engine"), true); assertEquals(200, issued.statusCode());
        String token = json(issued).get("ticket").asString();
        assertEquals(401, anonymous.request("POST", "/internal/lan/rank-badge", Map.of("engineId", "test-rank-badge-engine", "ticket", token), false).statusCode());
        var verified = engine("/internal/lan/rank-badge", Map.of("engineId", "test-rank-badge-engine", "ticket", token)); assertEquals(200, verified.statusCode()); assertEquals(name, json(verified).get("username").asString());
        assertEquals(400, engine("/internal/lan/rank-badge", Map.of("engineId", "test-rank-badge-engine", "ticket", token)).statusCode());
        assertEquals(0, accounts.profile(name).points());
    }

    @Test void csrfAndCorsRejectCrossSiteMutationsAndOnlyAllowExplicitOrigins() throws Exception {
        var client = new Browser(); client.csrf();
        var evil = HttpRequest.newBuilder(URI.create(base() + "/api/account")).header("Origin", "https://evil.invalid").header("Access-Control-Request-Method", "POST").method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build();
        assertEquals(403, client.http.send(evil, HttpResponse.BodyHandlers.ofString()).statusCode());
        var allowed = HttpRequest.newBuilder(URI.create(base() + "/api/account")).header("Origin", "http://127.0.0.1:4174").header("Access-Control-Request-Method", "POST").method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build();
        var response = client.http.send(allowed, HttpResponse.BodyHandlers.ofString()); assertEquals(200, response.statusCode()); assertEquals("http://127.0.0.1:4174", response.headers().firstValue("Access-Control-Allow-Origin").orElseThrow()); assertEquals("true", response.headers().firstValue("Access-Control-Allow-Credentials").orElseThrow());
        for (String origin : List.of("http://localhost:4174", LAN_ORIGIN)) {
            var request = HttpRequest.newBuilder(URI.create(base() + "/api/health")).header("Origin", origin).GET().build();
            var ok = client.http.send(request, HttpResponse.BodyHandlers.ofString()); assertEquals(200, ok.statusCode()); assertEquals(origin, ok.headers().firstValue("Access-Control-Allow-Origin").orElseThrow());
        }
        for (String origin : List.of("http://127.0.0.1:9999", "http://localhost.example.invalid:4174")) {
            var request = HttpRequest.newBuilder(URI.create(base() + "/api/health")).header("Origin", origin).GET().build(); assertEquals(403, client.http.send(request, HttpResponse.BodyHandlers.ofString()).statusCode());
        }
    }

    @Test void duplicateRegistrationClearlyFailsAndCannotReplaceTheOriginalPassword() throws Exception {
        var client = new Browser(); String name = username();
        var available = json(client.request("GET", "/api/auth/username-availability?username=" + name, null, false)); assertTrue(available.get("available").asBoolean());
        assertEquals(201, client.register(name).statusCode());
        String hash = db.queryForObject("SELECT password_hash FROM accounts WHERE username = ?", String.class, name);
        var duplicate = client.request("POST", "/api/auth/register", Map.of("username", name.toUpperCase(java.util.Locale.ROOT), "password", "a-different-test-passphrase"), true);
        assertEquals(409, duplicate.statusCode()); assertEquals("이미 존재하는 아이디입니다.", json(duplicate).get("message").asString());
        assertEquals(hash, db.queryForObject("SELECT password_hash FROM accounts WHERE username = ?", String.class, name)); assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM accounts WHERE username = ?", Integer.class, name));
        assertFalse(json(client.request("GET", "/api/auth/username-availability?username=" + name.toUpperCase(java.util.Locale.ROOT), null, false)).get("available").asBoolean());
        assertEquals(400, client.request("GET", "/api/auth/username-availability?username=ab", null, false).statusCode());
        assertEquals(401, client.request("POST", "/api/auth/login", "username=" + name + "&password=a-different-test-passphrase", true).statusCode());
        assertEquals(200, client.login(name).statusCode());
    }

    @Test void callsignIsAnAuthenticatedProfileSettingAndNeverChangesTheLoginIdentityOrProgress() throws Exception {
        var client = new Browser(); String name = username() + "abcd"; assertEquals(24, name.length());
        var created = client.register(name); assertEquals(201, created.statusCode()); assertEquals(name, json(created).get("callsign").asString());
        assertEquals(200, client.login(name).statusCode()); client.csrf();
        assertEquals(403, client.request("POST", "/api/account/callsign", Map.of("callsign", "바뀌면 안됨"), false).statusCode());
        var changed = client.request("POST", "/api/account/callsign", Map.of("callsign", "  새 콜사인  "), true); assertEquals(200, changed.statusCode());
        assertEquals("새 콜사인", json(changed).get("callsign").asString()); assertEquals(name, json(changed).get("username").asString()); assertEquals(0, json(changed).get("points").asLong());
        assertEquals("새 콜사인", json(client.request("GET", "/api/account", null, false)).get("callsign").asString());
        assertEquals(400, client.request("POST", "/api/account/callsign", Map.of("callsign", ""), true).statusCode());
        assertEquals(400, client.request("POST", "/api/account/callsign", Map.of("callsign", "a".repeat(25)), true).statusCode());
        assertEquals(400, client.request("POST", "/api/account/callsign", Map.of("callsign", "FORGED", "username", "someone_else", "points", 99999), true).statusCode());
        assertEquals("새 콜사인", accounts.profile(name).callsign());
    }

    @Test void simultaneousRegistrationsHaveOneWinnerAndOneExplicitDuplicateFailure() throws Exception {
        String name = username(); var results = new java.util.ArrayList<CompletableFuture<Boolean>>();
        for (int i = 0; i < 2; i++) results.add(CompletableFuture.supplyAsync(() -> { try { accounts.register(name, "test-only-long-passphrase"); return true; } catch (DuplicateUsernameException expected) { return false; } }));
        int successes = 0; for (var result : results) if (result.get(10, TimeUnit.SECONDS)) successes++;
        assertEquals(1, successes); assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM accounts WHERE username = ?", Integer.class, name));
    }

    @Test void suppressorsRequireCanonicalWeaponLevelFiveAndCsrfWithoutGrantingOwnershipOrSpendingPoints() throws Exception {
        var client = new Browser(); String name = username(); var created = client.register(name); UUID id = UUID.fromString(json(created).get("id").asString());
        String path = "/api/account/weapons/vector/suppressor";
        var anonymous = new Browser(); anonymous.csrf(); assertEquals(401, anonymous.request("POST", path, Map.of("equipped", true), true).statusCode());
        assertEquals(200, client.login(name).statusCode()); client.csrf();
        assertEquals(403, client.request("POST", path, Map.of("equipped", true), false).statusCode());
        assertEquals(400, client.request("POST", path, Map.of("equipped", true, "weaponKills", Map.of("vector", 1550)), true).statusCode());
        assertEquals(400, client.request("POST", path, Map.of(), true).statusCode());
        assertEquals(400, client.request("POST", "/api/account/weapons/knife/suppressor", Map.of("equipped", true), true).statusCode());
        assertEquals(400, client.request("POST", "/api/account/weapons/missing/suppressor", Map.of("equipped", true), true).statusCode());
        db.update("UPDATE profiles SET points = 832 WHERE account_id = ?", id);
        db.update("INSERT INTO weapon_kills(account_id, weapon_id, kills) VALUES (?, 'vector', 1549)", id);
        assertEquals(400, client.request("POST", path, Map.of("equipped", true), true).statusCode()); assertTrue(accounts.profile(id).suppressedWeapons().isEmpty());
        db.update("UPDATE weapon_kills SET kills = 1550 WHERE account_id = ? AND weapon_id = 'vector'", id);
        var equipped = client.request("POST", path, Map.of("equipped", true), true); assertEquals(200, equipped.statusCode()); assertEquals(List.of("vector"), JSON.convertValue(json(equipped).get("suppressedWeapons"), List.class));
        assertEquals(200, client.request("POST", path, Map.of("equipped", true), true).statusCode());
        var saved = accounts.profile(id); assertEquals(832, saved.points()); assertEquals(1550, saved.weaponKills().get("vector")); assertEquals(List.of("vector"), saved.suppressedWeapons()); assertFalse(saved.ownedWeapons().contains("vector")); assertEquals(4, saved.ownedWeapons().size());
        assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM equipped_suppressors WHERE account_id = ?", Integer.class, id));
        assertEquals(400, client.request("POST", "/api/account/weapons/an94/suppressor", Map.of("equipped", true), true).statusCode());
        var plan = matches.create(MatchService.Mode.RANKED, List.of(id), 1, "foundry", 5, 60); assertEquals(List.of("vector"), plan.players().getFirst().suppressedWeapons()); assertFalse(plan.players().getFirst().ownedWeapons().contains("vector"));
        assertEquals(200, client.request("POST", path, Map.of("equipped", false), true).statusCode()); assertTrue(accounts.profile(id).suppressedWeapons().isEmpty()); assertEquals(832, accounts.profile(id).points());
    }

    @Test void resultLedgersAcceptEveryFirearmAndKnifeIncludingAllThreeNewGuns() {
        var a = account(); var b = account(); var plan = matches.create(MatchService.Mode.CASUAL, List.of(a.id(), b.id()), 0, "foundry", 30, 60); matches.claim(plan.id(), "expanded-catalog-engine");
        Map<String, Integer> ledger = new java.util.LinkedHashMap<>();
        for (String id : List.of("rifle", "pistol", "shotgun", "sniper", "smg", "lmg", "dmr", "ak47", "m4a1", "famas", "mp5", "p90", "ump45", "awp", "m82", "spas12", "deagle", "m249", "m14", "glock18c", "an94", "s686", "vector", "knife")) ledger.put(id, 1);
        assertEquals(catalog.weaponCount() + 1, ledger.size());
        var result = new MatchService.Completion("expanded-catalog-engine", plan.id().toString(), List.of(new MatchService.Performance(a.id().toString(), false, ledger.size(), 0, ledger), new MatchService.Performance(b.id().toString(), false, 0, ledger.size(), Map.of())));
        assertTrue(matches.complete(plan.id(), result));
        var saved = accounts.profile(a.id()); assertEquals(ledger.size(), saved.weaponKills().size()); for (String id : List.of("an94", "s686", "vector")) assertEquals(1, saved.weaponKills().get(id));
    }

    @Test void temporaryRankedAiAssignmentsAreServerOwnedAndAnAccountCannotJoinTwoActiveMatches() {
        var a = account(); var b = account();
        var plan = matches.create(MatchService.Mode.RANKED, List.of(a.id(), b.id()), 1, "foundry", 5, 60); assertTrue(plan.rankedAiEnabled());
        assertThrows(IllegalArgumentException.class, () -> matches.create(MatchService.Mode.CASUAL, List.of(a.id()), 1, "longrail", 5, 60));
        assertEquals(plan.id(), matches.active(a.id()).id()); assertEquals(1, matches.claim(plan.id(), "test-engine-ranked").bots());
        assertThrows(IllegalArgumentException.class, () -> matches.claim(plan.id(), "different-engine"));
    }

    @Test void matchTicketsAreOpaqueHashedBoundToRosterAndEngineAndSingleUse() throws Exception {
        var a = account(); var plan = matches.create(MatchService.Mode.CASUAL, List.of(a.id()), 1, "foundry", 5, 60); matches.claim(plan.id(), "test-engine-ticket");
        var ticket = matches.ticket(a.id()); assertNotEquals(ticket.ticket(), db.queryForObject("SELECT token_hash FROM match_tickets WHERE account_id = ?", String.class, a.id()));
        assertEquals(400, engine("/internal/matches/" + plan.id() + "/consume-ticket", Map.of("engineId", "wrong-engine", "ticket", ticket.ticket())).statusCode());
        var response = engine("/internal/matches/" + plan.id() + "/consume-ticket", Map.of("engineId", "test-engine-ticket", "ticket", ticket.ticket())); assertEquals(200, response.statusCode()); assertEquals(a.id().toString(), json(response).get("id").asString());
        assertEquals(400, engine("/internal/matches/" + plan.id() + "/consume-ticket", Map.of("engineId", "test-engine-ticket", "ticket", ticket.ticket())).statusCode());
        var expired = matches.ticket(a.id()); db.update("UPDATE match_tickets SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE account_id = ?", a.id());
        assertThrows(IllegalArgumentException.class, () -> matches.consume(plan.id(), expired.ticket(), "test-engine-ticket"));
    }

    @Test void onlyTheAssignedEngineCanSettleAnImmutableResultOnceIncludingKnifeMastery() throws Exception {
        var a = account(); var b = account(); var plan = matches.create(MatchService.Mode.RANKED, List.of(a.id(), b.id()), 0, "foundry", 5, 60); matches.claim(plan.id(), "test-engine-result");
        var players = List.of(new MatchService.Performance(a.id().toString(), false, 2, 1, Map.of("knife", 1, "rifle", 1), 2, 1, false, plan.teams().get(a.id().toString())), new MatchService.Performance(b.id().toString(), false, 1, 2, Map.of("sniper", 1), 1, 2, false, plan.teams().get(b.id().toString())));
        var result = new MatchService.Completion("test-engine-result", plan.id().toString(), players);
        var anonymous = new Browser(); assertEquals(401, anonymous.request("POST", "/internal/matches/" + plan.id() + "/results", result, false).statusCode());
        assertEquals(400, engine("/internal/matches/" + plan.id() + "/results", new MatchService.Completion("wrong-engine", plan.id().toString(), players)).statusCode());
        assertTrue(json(engine("/internal/matches/" + plan.id() + "/results", result)).get("settled").asBoolean());
        assertFalse(json(engine("/internal/matches/" + plan.id() + "/results", new MatchService.Completion(result.engineId(), result.roundId(), List.of(players.get(1), players.get(0))))).get("settled").asBoolean());
        var profile = accounts.profile(a.id()); assertEquals(2, profile.kills()); assertEquals(1, profile.weaponKills().get("knife")); assertEquals(190, profile.points()); assertEquals(1000, profile.casualRating()); assertEquals("UNRANKED", profile.rankTier()); assertNull(matches.active(a.id()));
        assertEquals(2, db.queryForObject("SELECT COUNT(*) FROM match_results WHERE match_id = ?", Integer.class, plan.id()));
        var changed = List.of(new MatchService.Performance(a.id().toString(), false, 2, 1, Map.of("rifle", 2)), players.get(1)); assertEquals(400, engine("/internal/matches/" + plan.id() + "/results", new MatchService.Completion(result.engineId(), result.roundId(), changed)).statusCode()); assertEquals(190, accounts.profile(a.id()).points());
    }

    @Test void expiredOrCancelledEngineLeasesReleasePlayersWithoutPayingRewards() {
        var a = account(); var plan = matches.create(MatchService.Mode.CASUAL, List.of(a.id()), 1, "foundry", 5, 60); matches.claim(plan.id(), "test-engine-expire");
        db.update("UPDATE online_matches SET heartbeat_at = CURRENT_TIMESTAMP - INTERVAL '61 seconds' WHERE id = ?", plan.id());
        assertTrue(matches.expireInactive() >= 1); assertNull(matches.active(a.id())); assertEquals(0, accounts.profile(a.id()).points()); assertEquals("CANCELLED", matches.plan(plan.id()).status());
        var next = matches.create(MatchService.Mode.CASUAL, List.of(a.id()), 1, "foundry", 5, 60); matches.claim(next.id(), "test-engine-cancel");
        assertTrue(matches.cancel(next.id(), "test-engine-cancel")); assertFalse(matches.cancel(next.id(), "test-engine-cancel")); assertNull(matches.active(a.id())); assertEquals(0, accounts.profile(a.id()).points());
    }

    @Test void theRealSharedJsEngineAuthenticatesSixWebSocketsAndSettlesTeamResultsIntoPostgres() throws Exception {
        var people = List.of(account(), account(), account(), account(), account(), account()); var plan = matches.create(MatchService.Mode.RANKED, people.stream().map(AccountService.Profile::id).toList(), 0, "foundry", 1, 60);
        var builder = new ProcessBuilder("node", "scripts/test-online-engine.mjs").directory(Path.of(System.getProperty("project.root")).normalize().toFile()).redirectErrorStream(true);
        builder.environment().put("ONLINE_API_URL", base()); builder.environment().put("ENGINE_SECRET", ENGINE_KEY); builder.environment().put("SMOKE_MATCH_ID", plan.id().toString());
        Process process = builder.start();
        try (var reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String ready = CompletableFuture.supplyAsync(() -> { try { return reader.readLine(); } catch (Exception error) { throw new RuntimeException(error); } }).get(15, TimeUnit.SECONDS);
            assertTrue(JSON.readTree(ready).get("ready").asBoolean());
            var tickets = people.stream().map(p -> Map.of("ticket", matches.ticket(p.id()).ticket())).toList();
            process.getOutputStream().write((JSON.writeValueAsString(tickets) + "\n").getBytes(StandardCharsets.UTF_8)); process.getOutputStream().flush();
            String completed = CompletableFuture.supplyAsync(() -> { try { return reader.readLine(); } catch (Exception error) { throw new RuntimeException(error); } }).get(15, TimeUnit.SECONDS);
            assertTrue(process.waitFor(10, TimeUnit.SECONDS)); assertEquals(0, process.exitValue(), "Shared engine integration failed");
            var result = JSON.readTree(completed); assertTrue(result.get("complete").asBoolean()); UUID winner = UUID.fromString(result.get("winner").asString());
            assertEquals(1, accounts.profile(winner).kills()); assertEquals(170, accounts.profile(winner).points()); assertEquals("COMPLETED", matches.plan(plan.id()).status());
        } finally { if (process.isAlive()) { process.destroy(); if (!process.waitFor(3, TimeUnit.SECONDS)) process.destroyForcibly(); } }
    }

}
