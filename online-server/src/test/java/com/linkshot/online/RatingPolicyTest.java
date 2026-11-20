package com.linkshot.online;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;

class RatingPolicyTest {
    @Test void casualWinsAgainstAiRaiseSkillRatingAndLossesLowerIt() {
        var result = RatingPolicy.settle(false, List.of(new RatingPolicy.Player("human", 1000, 2, 0, 0, 0, false), new RatingPolicy.Player("bot", 1000, 0, 2, 0, 0, false)));
        assertEquals(12, result.get("human").ratingDelta()); assertEquals(-12, result.get("bot").ratingDelta());
    }
    @Test void casualRatingUsesTotalCombatIncludingAiKills() {
        var farmer = new RatingPolicy.Player("farmer", 1000, 40, 2, 0, 2, false); var fighter = new RatingPolicy.Player("fighter", 1000, 2, 0, 2, 0, false);
        var result = RatingPolicy.settle(false, List.of(farmer, fighter));
        assertEquals(12, result.get("farmer").ratingDelta()); assertEquals(-12, result.get("fighter").ratingDelta());
    }
    @Test void rankedPairwiseEloRewardsHumanPlacementAndIsZeroSumWithoutAbandonment() {
        var players = List.of(new RatingPolicy.Player("a", 1000, 4, 1, 4, 1, false), new RatingPolicy.Player("b", 1000, 3, 2, 3, 2, false), new RatingPolicy.Player("c", 1000, 2, 3, 2, 3, false), new RatingPolicy.Player("d", 1000, 1, 4, 1, 4, false));
        var result = RatingPolicy.settle(true, players); assertEquals(0, result.values().stream().mapToInt(RatingPolicy.Change::ratingDelta).sum());
        assertTrue(result.get("a").ratingDelta() > result.get("b").ratingDelta()); assertEquals(1, result.get("b").outcome()); assertEquals(-1, result.get("c").outcome());
    }
    @Test void abandonmentIsBottomPlaceEvenWithTheLargestKillCount() {
        var result = RatingPolicy.settle(true, List.of(new RatingPolicy.Player("leaver", 1000, 20, 0, 20, 0, true), new RatingPolicy.Player("stayer", 1000, 1, 0, 1, 0, false)));
        assertTrue(result.get("leaver").ratingDelta() <= -16); assertEquals(-1, result.get("leaver").outcome()); assertEquals(1, result.get("stayer").outcome());
    }
    @Test void exactTiesAndNoCombatDoNotGenerateFreeRankPoints() {
        var result = RatingPolicy.settle(true, List.of(new RatingPolicy.Player("a", 1000, 0, 0, 0, 0, false), new RatingPolicy.Player("b", 1000, 0, 0, 0, 0, false)));
        assertTrue(result.values().stream().allMatch(change -> change.ratingDelta() == 0 && change.outcome() == 0));
    }
    @Test void placementRpIsSignedAndDoubledBeforeThereIsAnEstablishedTierBalance() {
        var state = new RatingPolicy.RankProgress(0, 0, 0, 0);
        var win = RatingPolicy.advance(state, 1032, 1, RatingPolicy.PlacementRun.EMPTY);
        assertEquals(50, win.pointDelta()); assertEquals("UNRANKED", RatingPolicy.tier(win.progress())); assertEquals(0, win.progress().points());
        var loss = RatingPolicy.advance(win.progress(), 1000, -1, RatingPolicy.PlacementRun.EMPTY);
        assertEquals(-50, loss.pointDelta());
        var draw = RatingPolicy.advance(new RatingPolicy.RankProgress(0, 0, 4, 4), 1000, 0, RatingPolicy.PlacementRun.EMPTY);
        assertEquals("SILVER", RatingPolicy.tier(draw.progress())); assertEquals(5, RatingPolicy.division(draw.progress())); assertEquals(0, draw.progress().points());
    }
    @Test void hundredPointsPromotesAndALossBelowZeroDemotesWithoutMixingShopCurrency() {
        var before = new RatingPolicy.RankProgress(4, 90, 5, 20); var promoted = RatingPolicy.advance(before, 1000, 1, RatingPolicy.PlacementRun.EMPTY);
        assertEquals(5, promoted.progress().index()); assertEquals("SILVER", RatingPolicy.tier(promoted.progress())); assertEquals(16, promoted.progress().points());
        var demoted = RatingPolicy.advance(new RatingPolicy.RankProgress(5, 0, 5, 21), 1000, -1, RatingPolicy.PlacementRun.EMPTY); assertEquals(4, demoted.progress().index()); assertEquals(75, demoted.progress().points());
        assertEquals(0, RatingPolicy.advance(new RatingPolicy.RankProgress(0, 0, 5, 30), 0, -1, RatingPolicy.PlacementRun.EMPTY).progress().points());
    }
    @Test void highCombatPerformanceWithAllFiveWinsCanPlaceGoldVAndNoHigher() {
        var last = new RatingPolicy.RankProgress(0, 0, 4, 4);
        var gold = RatingPolicy.advance(last, 1100, 1, new RatingPolicy.PlacementRun(5, 30, 20, 200)).progress();
        assertEquals("GOLD", RatingPolicy.tier(gold)); assertEquals(5, RatingPolicy.division(gold)); assertEquals(0, gold.points());
        for (var run : List.of(new RatingPolicy.PlacementRun(5, 30, 21, 200), new RatingPolicy.PlacementRun(5, 19, 0, 200), new RatingPolicy.PlacementRun(4, 40, 10, 100))) {
            var capped = RatingPolicy.advance(last, 10_000, 1, run).progress();
            assertEquals("SILVER", RatingPolicy.tier(capped)); assertEquals(1, RatingPolicy.division(capped)); assertEquals(99, capped.points());
        }
        assertEquals(0, RatingPolicy.advance(last, 0, -1, new RatingPolicy.PlacementRun(0, 1, 30, -200)).progress().index());
        var cap = RatingPolicy.advance(new RatingPolicy.RankProgress(24, 100, 5, 50), 4000, 1, RatingPolicy.PlacementRun.EMPTY); assertEquals(24, cap.progress().index()); assertEquals(100, cap.progress().points());
    }
    @Test void onlyMatchesOneThroughTwentyDoubleBothPositiveAndNegativeRp() {
        for (int outcome : List.of(-1, 0, 1)) {
            var early = new RatingPolicy.RankProgress(6, 50, 5, 19); var regular = new RatingPolicy.RankProgress(6, 50, 5, 20);
            var accelerated = RatingPolicy.advance(early, 1100, outcome, RatingPolicy.PlacementRun.EMPTY);
            var normal = RatingPolicy.advance(regular, 1100, outcome, RatingPolicy.PlacementRun.EMPTY);
            assertEquals(2, RatingPolicy.progressionMultiplier(early)); assertEquals(1, RatingPolicy.progressionMultiplier(regular));
            assertEquals(2 * normal.pointDelta(), accelerated.pointDelta()); assertEquals(20, accelerated.progress().games()); assertEquals(21, normal.progress().games());
        }
    }
}
