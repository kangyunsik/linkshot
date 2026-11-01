package com.linkshot.online;

import static org.junit.jupiter.api.Assertions.*;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {"linkshot.matchmaking.players=4", "linkshot.matchmaking.casual-wait-seconds=30", "linkshot.matchmaking.ranked-ai-enabled=true"})
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class MatchmakingTest {
    private static final EmbeddedPostgres PG;
    static { try { var base = Files.createDirectories(Path.of("target", "queue-tests").toAbsolutePath()); PG = EmbeddedPostgres.builder().setOverrideWorkingDirectory(base.toFile()).setDataDirectory(Files.createTempDirectory(base, "data-")).setLocaleConfig("locale", "C").setServerConfig("unix_socket_directories", "").setPort(0).start(); } catch (Exception error) { throw new ExceptionInInitializerError(error); } }
    @DynamicPropertySource static void properties(DynamicPropertyRegistry values) { values.add("spring.datasource.url", () -> PG.getJdbcUrl("postgres", "postgres")); values.add("spring.datasource.username", () -> "postgres"); values.add("spring.datasource.password", () -> ""); values.add("linkshot.engine-secret", () -> "test-" + UUID.randomUUID() + "-" + UUID.randomUUID()); }
    @Autowired MatchmakingService queue;
    @Autowired MatchService matches;
    @Autowired EngineRegistry engines;
    @Autowired AccountService accounts;
    @Autowired RatingService ratings;
    @Autowired GameCatalog catalog;
    @Autowired OnlineProperties properties;
    @Autowired JdbcTemplate db;
    @BeforeEach void isolateQueues() { db.update("DELETE FROM match_queue"); db.update("DELETE FROM engines"); engines.heartbeat(new EngineRegistry.Heartbeat("test-queue-engine", "ws://127.0.0.1:8090/play", 24, 0)); }
    private AccountService.Profile account() { return accounts.register("q_" + UUID.randomUUID().toString().replace("-", "").substring(0, 18), "test-only-long-passphrase", "TESTER"); }
    private void age(UUID id, int seconds) { db.update("UPDATE match_queue SET queued_at = CURRENT_TIMESTAMP - (? * INTERVAL '1 second') WHERE account_id = ?", seconds, id); }
    private void settle(MatchService.Plan plan, List<MatchService.Performance> players) { matches.claim(plan.id(), "test-queue-engine"); assertTrue(matches.complete(plan.id(), new MatchService.Completion("test-queue-engine", plan.id().toString(), players))); }

    @Test void casualWaitsForPeopleThenFillsExactlyFourSlotsWithVisibleAi() {
        var a = account(); var status = queue.join(a.id(), MatchService.Mode.CASUAL); assertEquals(4, status.requiredPlayers()); assertEquals(1, status.playersFound());
        age(a.id(), 29); queue.matchmake(); assertNull(matches.active(a.id()));
        age(a.id(), 31); queue.matchmake(); var plan = matches.active(a.id()); assertNotNull(plan); assertEquals(3, plan.bots()); assertEquals(1, plan.players().size()); assertEquals(MatchService.Mode.CASUAL, plan.mode()); assertNotEquals("training", plan.mapId());
    }
    @Test void temporaryRankedAiFillsMissingSlotsAfterThirtySecondsButNotBefore() {
        var people = List.of(account(), account(), account()); for (var person : people) { queue.join(person.id(), MatchService.Mode.RANKED); age(person.id(), 29); }
        queue.matchmake(); for (var person : people) assertNull(matches.active(person.id())); assertNotNull(queue.status(people.getFirst().id()).aiInSeconds());
        for (var person : people) age(person.id(), 31); queue.matchmake(); var plan = matches.active(people.getFirst().id()); assertEquals(1, plan.bots()); assertEquals(3, plan.players().size()); assertEquals(MatchService.Mode.RANKED, plan.mode()); assertTrue(plan.rankedAiEnabled());
    }
    @Test void rankedStartsWithFourPeopleImmediatelyWithoutAddingUnnecessaryAi() {
        var people = List.of(account(), account(), account(), account()); for (var person : people) queue.join(person.id(), MatchService.Mode.RANKED);
        queue.matchmake(); var plan = matches.active(people.getFirst().id()); assertEquals(0, plan.bots()); assertEquals(4, plan.players().size());
    }
    @Test void separateQueuesAndGraduallyWidenedServerRatingsCannotBeMixed() {
        var a = account(); var b = account(); var c = account(); var d = account();
        for (var person : List.of(b, c, d)) db.update("UPDATE profiles SET ranked_rating = 1200 WHERE account_id = ?", person.id());
        for (var person : List.of(a, b, c, d)) queue.join(person.id(), MatchService.Mode.RANKED);
        assertEquals(150, queue.status(a.id()).ratingGap()); assertEquals(1, queue.status(a.id()).playersFound()); queue.matchmake(); assertNull(matches.active(a.id()));
        age(a.id(), 16); queue.matchmake(); assertEquals(4, matches.active(a.id()).players().size());
        var normal = account(); var ranked = account(); queue.join(normal.id(), MatchService.Mode.CASUAL); queue.join(ranked.id(), MatchService.Mode.RANKED); age(normal.id(), 31); age(ranked.id(), 31); queue.matchmake(); assertEquals(MatchService.Mode.CASUAL, matches.active(normal.id()).mode()); assertEquals(MatchService.Mode.RANKED, matches.active(ranked.id()).mode()); assertNotEquals(matches.active(normal.id()).id(), matches.active(ranked.id()).id());
    }
    @Test void duplicateJoiningPreservesWaitTimeAndCancellationIsAtomic() {
        var a = account(); queue.join(a.id(), MatchService.Mode.RANKED); age(a.id(), 10); queue.join(a.id(), MatchService.Mode.RANKED); assertTrue(queue.status(a.id()).elapsedSeconds() >= 10);
        assertThrows(IllegalArgumentException.class, () -> queue.join(a.id(), MatchService.Mode.CASUAL)); assertEquals("IDLE", queue.cancel(a.id()).state()); assertNull(matches.active(a.id()));
        queue.join(a.id(), MatchService.Mode.RANKED); db.update("UPDATE match_queue SET heartbeat_at = CURRENT_TIMESTAMP - INTERVAL '21 seconds' WHERE account_id = ?", a.id()); queue.matchmake(); assertEquals("IDLE", queue.status(a.id()).state());
    }
    @Test void offlineCombatEnginesCannotAcceptOrStartPretendMatches() {
        var a = account(); db.update("DELETE FROM engines"); assertFalse(queue.available()); assertThrows(IllegalArgumentException.class, () -> queue.join(a.id(), MatchService.Mode.CASUAL));
        engines.heartbeat(new EngineRegistry.Heartbeat("test-queue-engine", "ws://127.0.0.1:8090/play", 24, 0)); queue.join(a.id(), MatchService.Mode.CASUAL); age(a.id(), 31); db.update("UPDATE engines SET heartbeat_at = CURRENT_TIMESTAMP - INTERVAL '16 seconds'"); queue.matchmake(); assertNull(matches.active(a.id()));
    }
    @Test void aCasualAiVictoryRaisesOnlyCasualRatingAndStillSettlesRewardsOnce() {
        var a = account(); var plan = matches.create(MatchService.Mode.CASUAL, List.of(a.id()), 1, "foundry", 5, 60);
        settle(plan, List.of(new MatchService.Performance(a.id().toString(), false, 2, 0, Map.of("rifle", 2), 0, 0, false), new MatchService.Performance("bot-test-0001", true, 0, 2, Map.of(), 0, 0, false)));
        var profile = accounts.profile(a.id()); assertEquals(1012, profile.casualRating()); assertEquals(0, profile.placementsPlayed()); assertEquals(190, profile.points()); assertEquals(12, matches.receipt(plan.id(), a.id()).casualRatingDelta());
    }
    @Test void aRankedAiVictoryCountsPlacementAndUsesTheFrozenRankedBotRating() {
        var a = account(); db.update("UPDATE profiles SET ranked_rating = 1800, casual_rating = 1200 WHERE account_id = ?", a.id());
        var plan = matches.create(MatchService.Mode.RANKED, List.of(a.id()), 1, "foundry", 5, 60); assertTrue(plan.rankedAiEnabled()); assertEquals(1800, plan.botRating());
        settle(plan, List.of(new MatchService.Performance(a.id().toString(), false, 2, 0, Map.of("rifle", 2), 0, 0, false), new MatchService.Performance("bot-test-0001", true, 0, 2, Map.of(), 0, 0, false)));
        assertEquals(1816, db.queryForObject("SELECT ranked_rating FROM profiles WHERE account_id = ?", Integer.class, a.id())); assertEquals(1200, accounts.profile(a.id()).casualRating()); assertEquals(1, accounts.profile(a.id()).placementsPlayed()); assertEquals(1800, matches.plan(plan.id()).botRating());
    }
    @Test void disablingTheTemporaryPolicyRejectsRankedAiAndTheDatabaseStillRequiresAnExplicitAssignmentFlag() {
        var strict = new MatchService(db, accounts, catalog, properties, ratings, engines, false); var a = account(); assertFalse(strict.rankedAiEnabled());
        assertThrows(IllegalArgumentException.class, () -> strict.create(MatchService.Mode.RANKED, List.of(a.id()), 1, "foundry", 5, 60)); assertNull(matches.active(a.id()));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () -> db.update("INSERT INTO online_matches(id, mode, map_id, bot_count, frag_limit, round_seconds) VALUES (?, 'RANKED', 'foundry', 1, 5, 60)", UUID.randomUUID()));
    }
    @Test void tenRankedPlacementsAndAutomaticPromotionArePersistedApartFromShopPoints() {
        var a = account(); var b = account(); MatchService.Plan last = null;
        for (int i = 0; i < 11; i++) {
            last = matches.create(MatchService.Mode.RANKED, List.of(a.id(), b.id()), 0, "foundry", 5, 60);
            settle(last, List.of(new MatchService.Performance(a.id().toString(), false, 2, 1, Map.of("rifle", 2)), new MatchService.Performance(b.id().toString(), false, 1, 2, Map.of("pistol", 1))));
            if (i < 9) assertEquals("UNRANKED", accounts.profile(a.id()).rankTier());
        }
        var profile = accounts.profile(a.id()); assertEquals(10, profile.placementsPlayed()); assertNotEquals("UNRANKED", profile.rankTier()); assertTrue(profile.rankPoints() > 0); assertEquals(2090, profile.points()); assertEquals(1000, profile.casualRating()); assertEquals(4, profile.ownedWeapons().size()); assertTrue(matches.receipt(last.id(), a.id()).rankPointsDelta() > 0);
    }
    @Test void rankedAbandonmentIsLastPlaceWithoutCompletionOrKillLpEvenIfTheLeaverHadTheMostKills() {
        var a = account(); var b = account(); for (var person : List.of(a, b)) db.update("UPDATE profiles SET rank_placements = 10, ranked_games = 20, rank_index = 5, rank_points = 20, rank_tier = 'SILVER' WHERE account_id = ?", person.id());
        var plan = matches.create(MatchService.Mode.RANKED, List.of(a.id(), b.id()), 0, "foundry", 20, 60);
        settle(plan, List.of(new MatchService.Performance(a.id().toString(), false, 20, 0, Map.of("rifle", 20), 20, 0, true), new MatchService.Performance(b.id().toString(), false, 0, 20, Map.of(), 0, 20, false)));
        var receipt = matches.receipt(plan.id(), a.id()); assertTrue(receipt.abandoned()); assertEquals(0, receipt.points()); assertTrue(receipt.rankPointsDelta() < 0); assertEquals(0, accounts.profile(a.id()).points()); assertEquals(150, accounts.profile(b.id()).points());
    }
    @Test void challengerHasARealServerEnforcedTopTwoHundredLimit() {
        db.update("INSERT INTO accounts(id, username, password_hash, callsign) SELECT gen_random_uuid(), 'ladder_' || n, 'disabled-test-account', 'LEADER' FROM generate_series(1, 201) n");
        db.update("INSERT INTO profiles(account_id, ranked_rating, rank_index, rank_points, rank_placements, ranked_games, rank_tier) SELECT id, 3000 + CAST(SUBSTRING(username FROM 8) AS INTEGER), 24, 100, 10, 20, 'DIAMOND' FROM accounts WHERE username LIKE 'ladder_%'");
        var a = account(); var b = account(); ratings.settle(MatchService.Mode.RANKED, List.of(new MatchService.Performance(a.id().toString(), false, 1, 0, Map.of("rifle", 1)), new MatchService.Performance(b.id().toString(), false, 0, 1, Map.of())), 1000);
        assertEquals(200, db.queryForObject("SELECT COUNT(*) FROM profiles WHERE rank_tier = 'CHALLENGER'", Integer.class));
    }
    @Test void receiptsRemainAnImmutableSnapshotAndArePrivateToTheirOwner() {
        var a = account(); var b = account(); var outsider = account(); var plan = matches.create(MatchService.Mode.RANKED, List.of(a.id(), b.id()), 0, "foundry", 5, 60);
        settle(plan, List.of(new MatchService.Performance(a.id().toString(), false, 1, 0, Map.of("rifle", 1)), new MatchService.Performance(b.id().toString(), false, 0, 1, Map.of())));
        var receipt = matches.receipt(plan.id(), a.id()); db.update("UPDATE profiles SET casual_rating = 1800, rank_tier = 'GOLD', rank_index = 10, rank_points = 99, rank_placements = 10 WHERE account_id = ?", a.id());
        assertEquals(receipt, matches.receipt(plan.id(), a.id())); assertEquals(receipt, matches.history(a.id()).getFirst()); assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> matches.receipt(plan.id(), outsider.id()));
    }
}
