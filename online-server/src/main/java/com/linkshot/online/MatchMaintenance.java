package com.linkshot.online;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class MatchMaintenance {
    private final MatchService matches;
    public MatchMaintenance(MatchService matches) { this.matches = matches; }
    @Scheduled(fixedDelay = 10_000, initialDelay = 10_000) public void expireInactive() { matches.expireInactive(); }
}
