package com.linkshot.online;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;

@RestController
public class MatchmakingController {
    private final MatchmakingService matchmaking;
    private final AccountService accounts;
    private final EngineRegistry engines;
    public MatchmakingController(MatchmakingService matchmaking, AccountService accounts, EngineRegistry engines) { this.matchmaking = matchmaking; this.accounts = accounts; this.engines = engines; }
    public record QueueRequest(MatchService.Mode mode) {}
    @PostMapping("/api/queue") public MatchmakingService.Status join(Authentication user, @RequestBody QueueRequest request) { return matchmaking.join(accounts.credentials(user.getName()).id(), request.mode()); }
    @GetMapping("/api/queue") public MatchmakingService.Status status(Authentication user) { return matchmaking.status(accounts.credentials(user.getName()).id()); }
    @DeleteMapping("/api/queue") public MatchmakingService.Status cancel(Authentication user) { return matchmaking.cancel(accounts.credentials(user.getName()).id()); }
    @PostMapping("/api/queue/heartbeat") public Map<String, Boolean> heartbeat(Authentication user) { matchmaking.heartbeat(accounts.credentials(user.getName()).id()); return Map.of("ok", true); }
    @PostMapping("/internal/engines/heartbeat") public Map<String, Boolean> heartbeat(@RequestBody EngineRegistry.Heartbeat request) { engines.heartbeat(request); return Map.of("ok", true); }
}
