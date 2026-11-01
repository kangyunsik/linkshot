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
    @Test void tenPlacementsAssignATierWithoutGrantingPromotionPointsEarly() {
        var state = new RatingPolicy.RankProgress(0, 0, 0, 0);
        for (int i = 1; i <= 10; i++) { state = RatingPolicy.advance(state, 1000, 1).progress(); assertEquals(i < 10 ? "UNRANKED" : "SILVER", RatingPolicy.tier(state)); }
        assertEquals(5, RatingPolicy.division(state)); assertEquals(0, state.points());
    }
    @Test void hundredPointsPromotesAndALossBelowZeroDemotesWithoutMixingShopCurrency() {
        var before = new RatingPolicy.RankProgress(4, 90, 10, 20); var promoted = RatingPolicy.advance(before, 1000, 1);
        assertEquals(5, promoted.progress().index()); assertEquals("SILVER", RatingPolicy.tier(promoted.progress())); assertEquals(16, promoted.progress().points());
        var demoted = RatingPolicy.advance(new RatingPolicy.RankProgress(5, 0, 10, 21), 1000, -1); assertEquals(4, demoted.progress().index()); assertEquals(75, demoted.progress().points());
        assertEquals(0, RatingPolicy.advance(new RatingPolicy.RankProgress(0, 0, 10, 30), 0, -1).progress().points());
    }
    @Test void placementAndDiamondCapsRemainBoundedForExtremeRatings() {
        assertEquals(14, RatingPolicy.advance(new RatingPolicy.RankProgress(0, 0, 9, 9), 10_000, 1).progress().index());
        var cap = RatingPolicy.advance(new RatingPolicy.RankProgress(24, 100, 10, 50), 4000, 1); assertEquals(24, cap.progress().index()); assertEquals(100, cap.progress().points());
    }
}
