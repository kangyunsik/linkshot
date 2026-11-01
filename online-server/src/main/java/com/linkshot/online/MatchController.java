package com.linkshot.online;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MatchController {
    private final MatchService matches;
    private final AccountService accounts;
    public MatchController(MatchService matches, AccountService accounts) { this.matches = matches; this.accounts = accounts; }
    public record Engine(String engineId) {}
    public record Consume(String engineId, String ticket) {}
    public record Abandon(String engineId, UUID accountId) {}
    @GetMapping("/api/match") public Map<String, Object> active(Authentication user) { var plan = matches.active(accounts.credentials(user.getName()).id()); return plan == null ? Map.of("status", "NONE") : Map.of("id", plan.id(), "status", plan.status(), "mode", plan.mode(), "mapId", plan.mapId()); }
    @PostMapping("/api/match/ticket") public MatchService.Ticket ticket(Authentication user) { return matches.ticket(accounts.credentials(user.getName()).id()); }
    @GetMapping("/api/results/{id}") public MatchService.Receipt result(Authentication user, @PathVariable UUID id) { return matches.receipt(id, accounts.credentials(user.getName()).id()); }
    @GetMapping("/api/results") public List<MatchService.Receipt> history(Authentication user) { return matches.history(accounts.credentials(user.getName()).id()); }
    @GetMapping("/internal/matches/pending") public List<UUID> pending() { return matches.pending(); }
    @PostMapping("/internal/matches/{id}/claim") public MatchService.Plan claim(@PathVariable UUID id, @RequestBody Engine engine) { return matches.claim(id, engine.engineId()); }
    @PostMapping("/internal/matches/{id}/heartbeat") public Map<String, Boolean> heartbeat(@PathVariable UUID id, @RequestBody Engine engine) { matches.heartbeat(id, engine.engineId()); return Map.of("ok", true); }
    @PostMapping("/internal/matches/{id}/consume-ticket") public AccountService.Profile consume(@PathVariable UUID id, @RequestBody Consume request) { return matches.consume(id, request.ticket(), request.engineId()); }
    @PostMapping("/internal/matches/{id}/results") public Map<String, Boolean> results(@PathVariable UUID id, @RequestBody MatchService.Completion result) { return Map.of("settled", matches.complete(id, result)); }
    @PostMapping("/internal/matches/{id}/cancel") public Map<String, Boolean> cancel(@PathVariable UUID id, @RequestBody Engine engine) { return Map.of("cancelled", matches.cancel(id, engine.engineId())); }
    @PostMapping("/internal/matches/{id}/abandon") public Map<String, Boolean> abandon(@PathVariable UUID id, @RequestBody Abandon request) { matches.abandon(id, request.engineId(), request.accountId()); return Map.of("ok", true); }
}
