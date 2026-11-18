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
    @Autowired CustomAccessService custom;
    @Autowired RankBadgeService badges;
    @Autowired JdbcTemplate db;
    @BeforeEach void isolateQueues() { db.update("DELETE FROM match_queue"); db.update("UPDATE profiles SET active_match_id = NULL"); db.update("UPDATE online_matches SET status = 'CANCELLED' WHERE status IN ('PENDING', 'CLAIMED')"); db.update("DELETE FROM engines"); engines.heartbeat(new EngineRegistry.Heartbeat("test-queue-engine", "ws://127.0.0.1:8090/play", 24, 0)); }
    private AccountService.Profile account() { return accounts.register("q_" + UUID.randomUUID().toString().replace("-", "").substring(0, 18), "test-only-long-passphrase"); }
    private void age(UUID id, int seconds) { db.update("UPDATE match_queue SET queued_at = CURRENT_TIMESTAMP - (? * INTERVAL '1 second') WHERE account_id = ?", seconds, id); }
    private void settle(MatchService.Plan plan, List<MatchService.Performance> players) {
        var roster = new java.util.ArrayList<MatchService.Performance>();
        for (var p : players.stream().sorted(java.util.Comparator.comparing(MatchService.Performance::bot)).toList()) {
            String team = "teams".equals(plan.gameType()) ? p.bot() ? roster.stream().filter(r -> "blue".equals(r.teamId())).count() <= roster.stream().filter(r -> "red".equals(r.teamId())).count() ? "blue" : "red" : plan.teams().get(p.id()) : null;
            roster.add(new MatchService.Performance(p.id(), p.bot(), p.kills(), p.deaths(), p.weaponKills(), p.humanKills(), p.humanDeaths(), p.abandoned(), team, p.assists()));
        }
        matches.claim(plan.id(), "test-queue-engine"); assertTrue(matches.complete(plan.id(), new MatchService.Completion("test-queue-engine", plan.id().toString(), roster)));
    }

    @Test void casualWaitsForPeopleThenFillsExactlyFourSlotsWithVisibleAi() {
        var a = account(); var status = queue.join(a.id(), MatchService.Mode.CASUAL); assertEquals(4, status.requiredPlayers()); assertEquals(1, status.playersFound());
        age(a.id(), 29); queue.matchmake(); assertNull(matches.active(a.id()));
        age(a.id(), 31); queue.matchmake(); var plan = matches.active(a.id()); assertNotNull(plan); assertEquals(3, plan.bots()); assertEquals(1, plan.players().size()); assertEquals(MatchService.Mode.CASUAL, plan.mode()); assertNotEquals("training", plan.mapId());
    }
    @Test void temporaryRankedAiFillsMissingSlotsAfterThirtySecondsButNotBefore() {
        var people = List.of(account(), account(), account()); for (var person : people) { queue.join(person.id(), MatchService.Mode.RANKED); age(person.id(), 29); }
        queue.matchmake(); for (var person : people) assertNull(matches.active(person.id())); assertNotNull(queue.status(people.getFirst().id()).aiInSeconds());
        for (var person : people) age(person.id(), 31); queue.matchmake(); var plan = matches.active(people.getFirst().id()); assertEquals(3, plan.bots()); assertEquals(3, plan.players().size()); assertEquals(MatchService.Mode.RANKED, plan.mode()); assertTrue(plan.rankedAiEnabled()); assertEquals("teams", plan.gameType()); assertEquals(6, queue.status(people.getFirst().id()).requiredPlayers());
    }
    @Test void rankedWaitsForSixPeopleAndAssignsThreePerTeamWithoutUnnecessaryAi() {
        var people = List.of(account(), account(), account(), account(), account(), account()); for (var person : people.subList(0, 5)) queue.join(person.id(), MatchService.Mode.RANKED);
        queue.matchmake(); assertNull(matches.active(people.getFirst().id()));
        queue.join(people.get(5).id(), MatchService.Mode.RANKED); queue.matchmake(); var plan = matches.active(people.getFirst().id()); assertEquals(0, plan.bots()); assertEquals(6, plan.players().size());
        assertEquals(3, plan.teams().values().stream().filter("blue"::equals).count()); assertEquals(3, plan.teams().values().stream().filter("red"::equals).count()); assertEquals(40, plan.fragLimit());
    }
    @Test void separateQueuesAndGraduallyWidenedServerRatingsCannotBeMixed() {
        var a = account(); var b = account(); var c = account(); var d = account(); var e = account(); var f = account();
        for (var person : List.of(b, c, d, e, f)) db.update("UPDATE profiles SET ranked_rating = 1200 WHERE account_id = ?", person.id());
        for (var person : List.of(a, b, c, d, e, f)) queue.join(person.id(), MatchService.Mode.RANKED);
        assertEquals(150, queue.status(a.id()).ratingGap()); assertEquals(1, queue.status(a.id()).playersFound()); queue.matchmake(); assertNull(matches.active(a.id()));
        age(a.id(), 16); queue.matchmake(); assertEquals(6, matches.active(a.id()).players().size());
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
        assertEquals(1816, db.queryForObject("SELECT ranked_rating FROM profiles WHERE account_id = ?", Integer.class, a.id())); assertEquals(1200, accounts.profile(a.id()).casualRating()); assertEquals(1, accounts.profile(a.id()).placementsPlayed()); assertEquals(1, accounts.profile(a.id()).placementWins()); assertEquals(1800, matches.plan(plan.id()).botRating());
    }
    @Test void disablingTheTemporaryPolicyRejectsRankedAiAndTheDatabaseStillRequiresAnExplicitAssignmentFlag() {
        var strict = new MatchService(db, accounts, catalog, properties, ratings, engines, false); var a = account(); assertFalse(strict.rankedAiEnabled());
        assertThrows(IllegalArgumentException.class, () -> strict.create(MatchService.Mode.RANKED, List.of(a.id()), 1, "foundry", 5, 60)); assertNull(matches.active(a.id()));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () -> db.update("INSERT INTO online_matches(id, mode, map_id, bot_count, frag_limit, round_seconds) VALUES (?, 'RANKED', 'foundry', 1, 5, 60)", UUID.randomUUID()));
    }
    @Test void fiveRankedPlacementsAndAutomaticPromotionArePersistedApartFromShopPoints() {
        var a = account(); var b = account(); MatchService.Plan last = null;
        for (int i = 0; i < 6; i++) {
            last = matches.create(MatchService.Mode.RANKED, List.of(a.id(), b.id()), 0, "foundry", 5, 60);
            settle(last, List.of(new MatchService.Performance(a.id().toString(), false, 2, 1, Map.of("rifle", 2)), new MatchService.Performance(b.id().toString(), false, 1, 2, Map.of("pistol", 1))));
            if (i < 4) assertEquals("UNRANKED", accounts.profile(a.id()).rankTier());
        }
        var profile = accounts.profile(a.id()); assertEquals(5, profile.placementsPlayed()); assertEquals(5, profile.placementWins()); assertEquals(0, accounts.profile(b.id()).placementWins()); assertNotEquals("UNRANKED", profile.rankTier()); assertTrue(profile.rankPoints() > 0); assertEquals(1140, profile.points()); assertEquals(1000, profile.casualRating()); assertEquals(4, profile.ownedWeapons().size()); assertTrue(matches.receipt(last.id(), a.id()).rankPointsDelta() > 0);
    }
    @Test void shorteningPlacementsFinishesExistingFivePlusAccountsWithoutResettingEstablishedRanks() throws Exception {
        var waiting = account(); var placed = account(); var unfinished = account();
        db.execute("ALTER TABLE profiles DROP CONSTRAINT profiles_rank_placements_check");
        db.update("UPDATE profiles SET rank_placements = 7, ranked_rating = 1200 WHERE account_id = ?", waiting.id());
        db.update("UPDATE profiles SET rank_placements = 10, rank_index = 14, rank_points = 67, rank_tier = 'GOLD' WHERE account_id = ?", placed.id());
        db.update("UPDATE profiles SET rank_placements = 3 WHERE account_id = ?", unfinished.id());
        try (var connection = db.getDataSource().getConnection()) {
            org.springframework.jdbc.datasource.init.ScriptUtils.executeSqlScript(connection, new org.springframework.core.io.ClassPathResource("db/migration/V10__five_placement_matches.sql"));
        }
        assertEquals(5, accounts.profile(waiting.id()).placementsPlayed()); assertEquals("SILVER", accounts.profile(waiting.id()).rankTier());
        assertEquals(5, accounts.profile(placed.id()).placementsPlayed()); assertEquals("GOLD", accounts.profile(placed.id()).rankTier()); assertEquals(67, accounts.profile(placed.id()).rankPoints()); assertEquals(1, accounts.profile(placed.id()).rankDivision());
        assertEquals(3, accounts.profile(unfinished.id()).placementsPlayed()); assertEquals("UNRANKED", accounts.profile(unfinished.id()).rankTier());
    }
    @Test void rankedAbandonmentIsLastPlaceWithoutCompletionOrKillLpEvenIfTheLeaverHadTheMostKills() {
        var a = account(); var b = account(); for (var person : List.of(a, b)) db.update("UPDATE profiles SET rank_placements = 5, ranked_games = 20, rank_index = 5, rank_points = 20, rank_tier = 'SILVER' WHERE account_id = ?", person.id());
        var plan = matches.create(MatchService.Mode.RANKED, List.of(a.id(), b.id()), 0, "foundry", 20, 60);
        settle(plan, List.of(new MatchService.Performance(a.id().toString(), false, 20, 0, Map.of("rifle", 20), 20, 0, true), new MatchService.Performance(b.id().toString(), false, 0, 20, Map.of(), 0, 20, false)));
        var receipt = matches.receipt(plan.id(), a.id()); assertTrue(receipt.abandoned()); assertEquals(0, receipt.points()); assertTrue(receipt.rankPointsDelta() < 0); assertEquals(0, accounts.profile(a.id()).points()); assertEquals(150, accounts.profile(b.id()).points());
    }
    @Test void challengerHasARealServerEnforcedTopTwoHundredLimit() {
        db.update("INSERT INTO accounts(id, username, password_hash, callsign) SELECT gen_random_uuid(), 'ladder_' || n, 'disabled-test-account', 'LEADER' FROM generate_series(1, 201) n");
        db.update("INSERT INTO profiles(account_id, ranked_rating, rank_index, rank_points, rank_placements, ranked_games, rank_tier) SELECT id, 3000 + CAST(SUBSTRING(username FROM 8) AS INTEGER), 24, 100, 5, 20, 'DIAMOND' FROM accounts WHERE username LIKE 'ladder_%'");
        var a = account(); var b = account(); ratings.settle(MatchService.Mode.RANKED, List.of(new MatchService.Performance(a.id().toString(), false, 1, 0, Map.of("rifle", 1)), new MatchService.Performance(b.id().toString(), false, 0, 1, Map.of())), 1000);
        assertEquals(200, db.queryForObject("SELECT COUNT(*) FROM profiles WHERE rank_tier = 'CHALLENGER'", Integer.class));
    }
    @Test void receiptsRemainAnImmutableSnapshotAndArePrivateToTheirOwner() {
        var a = account(); var b = account(); var outsider = account(); var plan = matches.create(MatchService.Mode.RANKED, List.of(a.id(), b.id()), 0, "foundry", 5, 60);
        settle(plan, List.of(new MatchService.Performance(a.id().toString(), false, 1, 0, Map.of("rifle", 1)), new MatchService.Performance(b.id().toString(), false, 0, 1, Map.of())));
        var receipt = matches.receipt(plan.id(), a.id()); db.update("UPDATE profiles SET casual_rating = 1800, rank_tier = 'GOLD', rank_index = 10, rank_points = 99, rank_placements = 5 WHERE account_id = ?", a.id());
        assertEquals(receipt, matches.receipt(plan.id(), a.id())); assertEquals(receipt, matches.history(a.id()).getFirst()); assertThrows(org.springframework.web.server.ResponseStatusException.class, () -> matches.receipt(plan.id(), outsider.id()));
    }
    @Test void teamVictoryRewardsAllThreeTeammatesEvenWithZeroKillsAndPersistsPromotionAndDemotion() {
        var people = List.of(account(), account(), account(), account(), account(), account());
        var plan = matches.create(MatchService.Mode.RANKED, people.stream().map(AccountService.Profile::id).toList(), 0, "foundry", 20, 60);
        var blue = people.stream().filter(p -> "blue".equals(plan.teams().get(p.id().toString()))).toList();
        var red = people.stream().filter(p -> "red".equals(plan.teams().get(p.id().toString()))).toList();
        for (var p : blue) db.update("UPDATE profiles SET rank_placements = 5, ranked_games = 20, rank_index = 4, rank_points = 90, rank_tier = 'BRONZE' WHERE account_id = ?", p.id());
        for (var p : red) db.update("UPDATE profiles SET rank_placements = 5, ranked_games = 20, rank_index = 5, rank_points = 0, rank_tier = 'SILVER' WHERE account_id = ?", p.id());
        var roster = new java.util.ArrayList<MatchService.Performance>();
        for (int i = 0; i < 3; i++) { int kills = i < 2 ? 5 : 0; roster.add(new MatchService.Performance(blue.get(i).id().toString(), false, kills, 3, kills > 0 ? Map.of("rifle", kills) : Map.of())); }
        for (int i = 0; i < 3; i++) { int kills = i == 0 ? 9 : 0; roster.add(new MatchService.Performance(red.get(i).id().toString(), false, kills, i == 0 ? 4 : 3, kills > 0 ? Map.of("rifle", kills) : Map.of())); }
        settle(plan, roster);
        for (var p : blue) { var result = matches.receipt(plan.id(), p.id()); assertTrue(result.won()); assertEquals("WIN", result.outcome()); assertEquals(100, result.winBonus()); assertEquals("BRONZE", result.rankTierBefore()); assertEquals("SILVER", result.rankTier()); assertTrue(result.rankPointsDelta() > 0); }
        for (var p : red) { var result = matches.receipt(plan.id(), p.id()); assertFalse(result.won()); assertEquals("LOSS", result.outcome()); assertEquals("SILVER", result.rankTierBefore()); assertEquals("BRONZE", result.rankTier()); assertTrue(result.rankPointsDelta() < 0); }
        assertEquals(150, accounts.profile(blue.get(2).id()).points());
    }
    @Test void individualPlacementsAndTierProgressAreIndependentFromTheExistingTeamRank() {
        var a = account(); var b = account();
        db.update("UPDATE profiles SET rank_placements = 5, ranked_games = 20, rank_index = 7, rank_points = 42, rank_tier = 'SILVER' WHERE account_id = ?", a.id());
        for (int i = 0; i < 6; i++) {
            var plan = matches.create(MatchService.Mode.CASUAL, List.of(a.id(), b.id()), 0, "foundry", 5, 60);
            settle(plan, List.of(new MatchService.Performance(a.id().toString(), false, 2, 1, Map.of("rifle", 2)), new MatchService.Performance(b.id().toString(), false, 1, 2, Map.of("rifle", 1))));
            var saved = accounts.profile(a.id()); assertEquals(42, saved.rankPoints()); assertEquals(20, saved.rankedGames()); assertEquals(3, saved.rankDivision());
            assertEquals(Math.min(i + 1, 5), saved.competitive().get("ffa").placementsPlayed());
            if (i < 4) assertEquals("UNRANKED", saved.competitive().get("ffa").rankTier());
            assertEquals(saved.competitive().get("ffa").rankTier(), matches.receipt(plan.id(), a.id()).rankTier());
        }
        var personal = accounts.profile(a.id()).competitive().get("ffa"); assertTrue(personal.rankPoints() > 0); assertEquals(6, personal.roundsPlayed()); assertEquals(100, personal.winRate());
        var team = matches.create(MatchService.Mode.RANKED, List.of(a.id(), b.id()), 0, "foundry", 5, 60);
        settle(team, List.of(new MatchService.Performance(a.id().toString(), false, 2, 1, Map.of("rifle", 2)), new MatchService.Performance(b.id().toString(), false, 1, 2, Map.of("rifle", 1))));
        assertEquals(personal, accounts.profile(a.id()).competitive().get("ffa"));
        assertEquals(1, accounts.profile(a.id()).competitive().get("teams").roundsPlayed());
    }
    @Test void recentTenAndKdaUseOnlyTheRequestedModeAndAssistsCannotBeForgedBeyondEligibleDeaths() {
        var people = List.of(account(), account(), account(), account()); var killer = people.get(0); var victim = people.get(1); var helper = people.get(2); var observer = people.get(3);
        var completed = new java.util.ArrayList<UUID>();
        for (int i = 0; i < 12; i++) {
            var plan = matches.create(MatchService.Mode.CASUAL, people.stream().map(AccountService.Profile::id).toList(), 0, "foundry", 5, 60);
            var roster = List.of(new MatchService.Performance(killer.id().toString(), false, 1, 0, Map.of("rifle", 1)),
                new MatchService.Performance(victim.id().toString(), false, 0, 1, Map.of()),
                new MatchService.Performance(helper.id().toString(), false, 0, 0, Map.of(), 0, 0, false, null, 1),
                new MatchService.Performance(observer.id().toString(), false, 0, 0, Map.of()));
            settle(plan, roster); completed.add(plan.id());
        }
        var stats = accounts.profile(helper.id()).competitive().get("ffa");
        assertEquals(12, stats.roundsPlayed()); assertEquals(12, stats.assists()); assertEquals(0, stats.kills()); assertEquals(12, stats.kda()); assertEquals(0, stats.winRate());
        assertEquals(10, stats.recentMatches().size()); assertEquals(completed.reversed().subList(0, 10), stats.recentMatches().stream().map(AccountService.RecentMatch::matchId).toList());
        assertEquals(0, accounts.profile(helper.id()).competitive().get("teams").roundsPlayed());
        var invalid = matches.create(MatchService.Mode.CASUAL, people.stream().map(AccountService.Profile::id).toList(), 0, "foundry", 5, 60); matches.claim(invalid.id(), "test-queue-engine");
        var forged = List.of(new MatchService.Performance(killer.id().toString(), false, 1, 0, Map.of("rifle", 1)), new MatchService.Performance(victim.id().toString(), false, 0, 1, Map.of()), new MatchService.Performance(helper.id().toString(), false, 0, 0, Map.of(), 0, 0, false, null, 2), new MatchService.Performance(observer.id().toString(), false, 0, 0, Map.of()));
        assertThrows(IllegalArgumentException.class, () -> matches.complete(invalid.id(), new MatchService.Completion("test-queue-engine", invalid.id().toString(), forged)));
        assertEquals(stats, accounts.profile(helper.id()).competitive().get("ffa"));
    }
    @Test void customTicketsAreHashedSingleUseAndBoundToTheCanonicalGatewayAndAccount() {
        var a = account(); var ticket = custom.ticket(a.id()); assertEquals("ws://127.0.0.1:8090/play", ticket.engineUrl());
        assertNotEquals(ticket.ticket(), db.queryForObject("SELECT token_hash FROM custom_tickets WHERE account_id = ?", String.class, a.id()));
        assertThrows(IllegalArgumentException.class, () -> custom.consume(ticket.ticket(), "different-engine")); assertEquals(a.id(), custom.consume(ticket.ticket(), "test-queue-engine").id()); assertThrows(IllegalArgumentException.class, () -> custom.consume(ticket.ticket(), "test-queue-engine"));
        var expired = custom.ticket(a.id()); db.update("UPDATE custom_tickets SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE account_id = ?", a.id()); assertThrows(IllegalArgumentException.class, () -> custom.consume(expired.ticket(), "test-queue-engine"));
    }
    @Test void cosmeticLanRankProofIsSingleUseEngineBoundAndNeverCancelsTheRankQueue() {
        var a = account(); queue.join(a.id(), MatchService.Mode.RANKED);
        var ticket = badges.issue(a.id(), "test-queue-engine");
        assertEquals("QUEUED", queue.status(a.id()).state()); assertNull(matches.active(a.id()));
        assertNotEquals(ticket.ticket(), db.queryForObject("SELECT token_hash FROM rank_badge_tickets WHERE account_id = ?", String.class, a.id()));
        assertThrows(IllegalArgumentException.class, () -> badges.consume(ticket.ticket(), "different-engine"));
        assertEquals(a.id(), badges.consume(ticket.ticket(), "test-queue-engine").id());
        assertThrows(IllegalArgumentException.class, () -> badges.consume(ticket.ticket(), "test-queue-engine"));
        var expired = badges.issue(a.id(), "test-queue-engine"); db.update("UPDATE rank_badge_tickets SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE account_id = ?", a.id());
        assertThrows(IllegalArgumentException.class, () -> badges.consume(expired.ticket(), "test-queue-engine"));
        assertEquals(0, accounts.profile(a.id()).points()); assertEquals("QUEUED", queue.status(a.id()).state());
    }
    @Test void customGatewaySelectionRemainsStableAndFailsOverOnlyWhenTheCurrentEngineIsStale() {
        var a = account(); var first = custom.ticket(a.id()); engines.heartbeat(new EngineRegistry.Heartbeat("another-custom-engine", "ws://127.0.0.1:8190/play", 24, 0)); assertEquals(first.engineUrl(), custom.ticket(a.id()).engineUrl());
        db.update("UPDATE engines SET heartbeat_at = CURRENT_TIMESTAMP - INTERVAL '16 seconds' WHERE id = 'test-queue-engine'"); assertEquals("ws://127.0.0.1:8190/play", custom.ticket(a.id()).engineUrl());
    }
    @Test void customLobbyEntryCancelsOnlyQueuedSearchesAndCannotEscapeAnAssignedCompetitiveMatch() {
        var a = account(); queue.join(a.id(), MatchService.Mode.RANKED); custom.ticket(a.id()); assertEquals("IDLE", queue.status(a.id()).state());
        matches.create(MatchService.Mode.CASUAL, List.of(a.id()), 1, "foundry", 5, 60); assertThrows(IllegalArgumentException.class, () -> custom.ticket(a.id()));
    }
    @Test void rankedMapsAreSelectedByTheServerFromTheFullRandomPoolNotTheLobbySelection() {
        var a = account(); var seen = new java.util.HashSet<String>();
        for (int i = 0; i < 16; i++) {
            queue.join(a.id(), MatchService.Mode.RANKED); age(a.id(), 31); queue.matchmake(); var plan = matches.active(a.id()); assertTrue(catalog.maps().contains(plan.mapId())); assertNotEquals("training", plan.mapId()); seen.add(plan.mapId()); queue.respond(a.id(), plan.id(), true); matches.claim(plan.id(), "test-queue-engine"); matches.cancel(plan.id(), "test-queue-engine");
        }
        assertTrue(seen.size() > 1, "Ranked matchmaking must not stick to a fixed map");
    }
    @Test void offersCannotBeClaimedOrTicketedBeforeExplicitAcceptanceAndRejectsNeverProgress() {
        var a = account(); var b = account(); var outsider = account();
        var offer = matches.offer(MatchService.Mode.CASUAL, List.of(a.id(), b.id()), 2, "foundry", 20, 60);
        assertEquals("OFFERED", queue.status(a.id()).state()); assertNotNull(queue.status(a.id()).acceptanceDeadline());
        assertFalse(matches.pending().contains(offer.id()));
        assertThrows(IllegalArgumentException.class, () -> matches.claim(offer.id(), "test-queue-engine"));
        assertThrows(IllegalArgumentException.class, () -> matches.ticket(a.id()));
        assertThrows(IllegalArgumentException.class, () -> queue.respond(outsider.id(), offer.id(), true));
        assertEquals("ACCEPTED", queue.respond(a.id(), offer.id(), true).state());
        assertEquals("IDLE", queue.respond(b.id(), offer.id(), false).state());
        assertEquals("ASSIGNED", queue.status(a.id()).state());
        assertTrue(matches.pending().contains(offer.id())); assertEquals(3, matches.plan(offer.id()).bots());
        matches.claim(offer.id(), "test-queue-engine"); assertNotNull(matches.ticket(a.id()));
        assertThrows(IllegalArgumentException.class, () -> matches.ticket(b.id()));
        assertEquals(0, accounts.profile(b.id()).points()); assertEquals(0, accounts.profile(b.id()).roundsPlayed()); assertTrue(matches.history(b.id()).isEmpty());
        queue.respond(b.id(), offer.id(), true); assertNull(matches.active(b.id())); assertEquals(3, matches.plan(offer.id()).bots());
        assertTrue(matches.complete(offer.id(), new MatchService.Completion("test-queue-engine", offer.id().toString(), List.of(
            new MatchService.Performance(a.id().toString(), false, 0, 0, Map.of()),
            new MatchService.Performance("bot-declined-01", true, 0, 0, Map.of()),
            new MatchService.Performance("bot-declined-02", true, 0, 0, Map.of()),
            new MatchService.Performance("bot-declined-03", true, 0, 0, Map.of())))));
        assertTrue(matches.history(b.id()).isEmpty()); assertEquals(0, accounts.profile(b.id()).points()); assertEquals(0, accounts.profile(b.id()).competitive().get("ffa").placementsPlayed());
    }
    @Test void expiredSlotsBecomeAiEvenWhenSearchFillingIsDisabledAndAcceptedTeamsArePreserved() {
        var people = List.of(account(), account(), account(), account(), account(), account());
        var strict = new MatchService(db, accounts, catalog, properties, ratings, engines, false);
        var offer = strict.offer(MatchService.Mode.RANKED, people.stream().map(AccountService.Profile::id).toList(), 0, "foundry", 40, 60);
        var accepted = people.get(0); queue.respond(accepted.id(), offer.id(), true);
        db.update("UPDATE online_matches SET acceptance_deadline = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = ?", offer.id());
        queue.respond(people.get(1).id(), offer.id(), true); // A late click cannot claim an expired slot.
        queue.matchmake(); var plan = matches.plan(offer.id());
        assertEquals(1, plan.players().size()); assertEquals(5, plan.bots()); assertTrue(plan.rankedAiEnabled()); assertEquals(40, plan.fragLimit());
        assertEquals(offer.teams().get(accepted.id().toString()), plan.teams().get(accepted.id().toString()));
        for (var p : people.subList(1, 6)) { assertNull(matches.active(p.id())); assertEquals(0, accounts.profile(p.id()).placementsPlayed()); assertEquals(0, accounts.profile(p.id()).points()); }
        assertEquals(offer.id(), matches.claim(offer.id(), "test-queue-engine").id());
    }
    @Test void nobodyAcceptingCancelsInsteadOfRunningABotOnlyRankedMatch() {
        var a = account(); queue.join(a.id(), MatchService.Mode.RANKED); age(a.id(), 31); queue.matchmake();
        var id = matches.active(a.id()).id();
        db.update("UPDATE online_matches SET acceptance_deadline = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = ?", id);
        queue.matchmake();
        assertEquals("IDLE", queue.status(a.id()).state()); assertEquals("CANCELLED", matches.plan(id).status()); assertFalse(matches.pending().contains(id));
        assertEquals(0, accounts.profile(a.id()).points()); assertTrue(matches.history(a.id()).isEmpty());
    }
    @Test void disablingNewSearchesStillClosesExistingExpiredOffers() {
        var a = account(); var offer = matches.offer(MatchService.Mode.CASUAL, List.of(a.id()), 3, "foundry", 20, 60);
        db.update("UPDATE online_matches SET acceptance_deadline = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = ?", offer.id());
        var disabled = new MatchmakingService(db, matches, engines, catalog, properties, false, 30, 20, 300);
        disabled.matchmake(); assertNull(matches.active(a.id())); assertEquals("CANCELLED", matches.plan(offer.id()).status()); assertEquals(0, accounts.profile(a.id()).points());
    }
    @Test void concurrentFinalRepliesAndDuplicateAcceptsResolveOneRosterOnly() throws Exception {
        var a = account(); var b = account(); var offer = matches.offer(MatchService.Mode.CASUAL, List.of(a.id(), b.id()), 2, "foundry", 20, 60);
        try (var threads = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var first = threads.submit(() -> queue.respond(a.id(), offer.id(), true));
            var second = threads.submit(() -> queue.respond(b.id(), offer.id(), false));
            first.get(); second.get();
            var duplicates = java.util.stream.IntStream.range(0, 4).mapToObj(n -> threads.submit(() -> queue.respond(a.id(), offer.id(), true))).toList();
            for (var reply : duplicates) reply.get();
        }
        assertEquals(1, matches.plan(offer.id()).players().size()); assertEquals(3, matches.plan(offer.id()).bots());
        assertEquals("ASSIGNED", queue.status(a.id()).state()); assertNull(matches.active(b.id()));
    }
    @Test void accountPurchasesDebitCanonicalPricesOnceAndNeverChangeRatingOrImportDeviceOwnership() throws Exception {
        var a = account(); db.update("UPDATE profiles SET points = 5000 WHERE account_id = ?", a.id());
        try (var threads = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var one = threads.submit(() -> accounts.purchaseWeapon(a.username(), "m82"));
            var two = threads.submit(() -> accounts.purchaseWeapon(a.username(), "m82"));
            one.get(); two.get();
        }
        var after = accounts.profile(a.id()); assertEquals(3000, after.points()); assertEquals(1, after.ownedWeapons().stream().filter("m82"::equals).count());
        assertThrows(IllegalArgumentException.class, () -> accounts.purchaseWeapon(a.username(), "knife"));
        assertThrows(IllegalArgumentException.class, () -> accounts.selectOutfit(a.username(), "orbital", false));
        after = accounts.selectOutfit(a.username(), "orbital", true); assertEquals(2100, after.points()); assertTrue(after.ownedOutfits().contains("orbital")); assertEquals("orbital", after.outfitId());
        assertEquals(2100, accounts.selectOutfit(a.username(), "orbital", true).points());
        assertEquals("female", accounts.selectCharacter(a.username(), "female").characterId());
        assertEquals(1000, after.casualRating()); assertEquals(0, after.placementsPlayed());
        var poor = account(); assertThrows(IllegalArgumentException.class, () -> accounts.purchaseWeapon(poor.username(), "m82")); assertFalse(accounts.profile(poor.id()).ownedWeapons().contains("m82")); assertEquals(0, accounts.profile(poor.id()).points());
    }
}
