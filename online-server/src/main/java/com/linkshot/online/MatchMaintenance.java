package com.linkshot.online;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class MatchMaintenance {
    private final MatchService matches;
    private final CustomAccessService custom;
    public MatchMaintenance(MatchService matches, CustomAccessService custom) { this.matches = matches; this.custom = custom; }
    @Scheduled(fixedDelay = 10_000, initialDelay = 10_000) public void expireInactive() { matches.expireInactive(); custom.expire(); }
}
