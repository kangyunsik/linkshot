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
        properties.add("linkshot.engine-secret", () -> ENGINE_KEY); properties.add("linkshot.allowed-origins", () -> "http://127.0.0.1:4174");
    }
    @org.springframework.beans.factory.annotation.Value("${local.server.port}") int port;
    @Autowired AccountService accounts;
    @Autowired MatchService matches;
    @Autowired JdbcTemplate db;
    private String base() { return "http://127.0.0.1:" + port; }
    private String username() { return "u_" + UUID.randomUUID().toString().replace("-", "").substring(0, 18); }
    private AccountService.Profile account() { return accounts.register(username(), "test-only-long-passphrase", "TESTER"); }
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
        HttpResponse<String> register(String username) throws Exception { csrf(); return request("POST", "/api/auth/register", Map.of("username", username, "password", "test-only-long-passphrase", "callsign", "TESTER"), true); }
        HttpResponse<String> login(String username) throws Exception { return request("POST", "/api/auth/login", "username=" + URLEncoder.encode(username, StandardCharsets.UTF_8) + "&password=test-only-long-passphrase", true); }
    }
    private HttpResponse<String> engine(String path, Object body) throws Exception {
        return HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(base() + path)).timeout(Duration.ofSeconds(10)).header("Authorization", "Bearer " + ENGINE_KEY).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test void unauthenticatedRequestsCannotReadProfilesOrWriteResults() throws Exception {
        var client = new Browser(); assertEquals(200, client.request("GET", "/api/health", null, false).statusCode());
        assertEquals(401, client.request("GET", "/api/account", null, false).statusCode());
        assertEquals(403, client.request("POST", "/api/auth/register", Map.of("username", username(), "password", "test-only-long-passphrase", "callsign", "TESTER"), false).statusCode());
        assertEquals(401, client.request("GET", "/internal/matches/pending", null, false).statusCode());
        assertFalse(json(client.request("GET", "/api/health", null, false)).get("matchmaking").asBoolean());
    }

    @Test void registrationLoginJdbcSessionsAndLogoutProtectPasswordAndRotateSessionIdentity() throws Exception {
        var client = new Browser(); String name = username(); var created = client.register(name); assertEquals(201, created.statusCode());
        var profile = json(created); UUID id = UUID.fromString(profile.get("id").asString()); assertEquals(0, profile.get("points").asInt()); assertEquals(0, profile.get("kills").asInt());
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
        assertEquals(400, client.request("POST", "/api/auth/register", Map.of("username", name, "password", "test-only-long-passphrase", "callsign", "TESTER"), true).statusCode());
        assertEquals(400, client.request("POST", "/api/auth/register", Map.of("username", username(), "password", "test-only-long-passphrase", "callsign", "TESTER", "points", 999_999, "ownedWeapons", List.of("m82")), true).statusCode());
        assertEquals(400, client.request("POST", "/api/auth/register", Map.of("username", username(), "password", "가".repeat(30), "callsign", "TESTER"), true).statusCode());
        assertEquals(400, client.request("POST", "/api/auth/register", Map.of("username", username(), "password", "short", "callsign", "TESTER"), true).statusCode());
        assertEquals(200, client.login(name).statusCode()); client.csrf();
        assertNotEquals(200, client.request("POST", "/api/account", Map.of("kills", 500, "points", 999_999), true).statusCode()); assertEquals(0, accounts.profile(name).points());
    }

    @Test void csrfAndCorsRejectCrossSiteMutationsAndOnlyAllowExplicitOrigins() throws Exception {
        var client = new Browser(); client.csrf();
        var evil = HttpRequest.newBuilder(URI.create(base() + "/api/account")).header("Origin", "https://evil.invalid").header("Access-Control-Request-Method", "POST").method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build();
        assertEquals(403, client.http.send(evil, HttpResponse.BodyHandlers.ofString()).statusCode());
        var allowed = HttpRequest.newBuilder(URI.create(base() + "/api/account")).header("Origin", "http://127.0.0.1:4174").header("Access-Control-Request-Method", "POST").method("OPTIONS", HttpRequest.BodyPublishers.noBody()).build();
        var response = client.http.send(allowed, HttpResponse.BodyHandlers.ofString()); assertEquals(200, response.statusCode()); assertEquals("http://127.0.0.1:4174", response.headers().firstValue("Access-Control-Allow-Origin").orElseThrow()); assertEquals("true", response.headers().firstValue("Access-Control-Allow-Credentials").orElseThrow());
    }

    @Test void rankedAssignmentsNeverContainBotsAndAnAccountCannotJoinTwoActiveMatches() {
        var a = account(); var b = account();
        assertThrows(IllegalArgumentException.class, () -> matches.create(MatchService.Mode.RANKED, List.of(a.id()), 1, "foundry", 5, 60));
        assertNull(matches.active(a.id()));
        var plan = matches.create(MatchService.Mode.RANKED, List.of(a.id(), b.id()), 0, "foundry", 5, 60);
        assertThrows(IllegalArgumentException.class, () -> matches.create(MatchService.Mode.CASUAL, List.of(a.id()), 1, "longrail", 5, 60));
        assertEquals(plan.id(), matches.active(a.id()).id()); assertEquals(0, matches.claim(plan.id(), "test-engine-ranked").bots());
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
        var players = List.of(new MatchService.Performance(a.id().toString(), false, 2, 1, Map.of("knife", 1, "rifle", 1)), new MatchService.Performance(b.id().toString(), false, 1, 2, Map.of("sniper", 1)));
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

    @Test void theRealSharedJsEngineAuthenticatesTwoWebSocketsAndSettlesIntoPostgres() throws Exception {
        var a = account(); var b = account(); var plan = matches.create(MatchService.Mode.RANKED, List.of(a.id(), b.id()), 0, "foundry", 1, 60);
        var builder = new ProcessBuilder("node", "scripts/test-online-engine.mjs").directory(Path.of(System.getProperty("project.root")).normalize().toFile()).redirectErrorStream(true);
        builder.environment().put("ONLINE_API_URL", base()); builder.environment().put("ENGINE_SECRET", ENGINE_KEY); builder.environment().put("SMOKE_MATCH_ID", plan.id().toString());
        Process process = builder.start();
        try (var reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String ready = CompletableFuture.supplyAsync(() -> { try { return reader.readLine(); } catch (Exception error) { throw new RuntimeException(error); } }).get(15, TimeUnit.SECONDS);
            assertTrue(JSON.readTree(ready).get("ready").asBoolean());
            var tickets = List.of(Map.of("ticket", matches.ticket(a.id()).ticket()), Map.of("ticket", matches.ticket(b.id()).ticket()));
            process.getOutputStream().write((JSON.writeValueAsString(tickets) + "\n").getBytes(StandardCharsets.UTF_8)); process.getOutputStream().flush();
            String completed = CompletableFuture.supplyAsync(() -> { try { return reader.readLine(); } catch (Exception error) { throw new RuntimeException(error); } }).get(15, TimeUnit.SECONDS);
            assertTrue(process.waitFor(10, TimeUnit.SECONDS)); assertEquals(0, process.exitValue(), "Shared engine integration failed");
            var result = JSON.readTree(completed); assertTrue(result.get("complete").asBoolean()); UUID winner = UUID.fromString(result.get("winner").asString());
            assertEquals(1, accounts.profile(winner).kills()); assertEquals(170, accounts.profile(winner).points()); assertEquals("COMPLETED", matches.plan(plan.id()).status());
        } finally { if (process.isAlive()) { process.destroy(); if (!process.waitFor(3, TimeUnit.SECONDS)) process.destroyForcibly(); } }
    }

}
