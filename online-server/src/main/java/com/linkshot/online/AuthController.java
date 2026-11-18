package com.linkshot.online;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuthController {
    private final AccountService accounts;
    private final OnlineProperties properties;
    private final MatchmakingService matchmaking;
    private final CustomAccessService custom;
    private final RankBadgeService badges;
    public AuthController(AccountService accounts, OnlineProperties properties, MatchmakingService matchmaking, CustomAccessService custom, RankBadgeService badges) { this.accounts = accounts; this.properties = properties; this.matchmaking = matchmaking; this.custom = custom; this.badges = badges; }
    public record Registration(@NotBlank @Size(max = 24) String username, @NotBlank @Size(max = 72) String password) {}
    public record Callsign(@NotBlank @Size(max = 48) String callsign) {}
    public record Suppressor(@jakarta.validation.constraints.NotNull Boolean equipped) {}
    public record RankBadgeRequest(@NotBlank @Size(max = 64) String engineId) {}
    public record CharacterSelection(@NotBlank @Size(max = 16) String characterId) {}
    public record OutfitSelection(@NotBlank @Size(max = 32) String outfitId, boolean purchase) {}
    @PostMapping("/api/account/weapons/{weaponId}/purchase") public AccountService.Profile purchase(Authentication user, @PathVariable String weaponId) { return accounts.purchaseWeapon(user.getName(), weaponId); }
    @PostMapping("/api/account/character") public AccountService.Profile character(Authentication user, @Valid @RequestBody CharacterSelection request) { return accounts.selectCharacter(user.getName(), request.characterId()); }
    @PostMapping("/api/account/outfit") public AccountService.Profile outfit(Authentication user, @Valid @RequestBody OutfitSelection request) { return accounts.selectOutfit(user.getName(), request.outfitId(), request.purchase()); }
    @GetMapping("/api/health") public Map<String, Object> health() {
        return Map.ofEntries(Map.entry("status", "UP"), Map.entry("service", "linkshot-online"), Map.entry("auth", true),
            Map.entry("matchmaking", matchmaking.available()), Map.entry("combatEngine", "shared-js"), Map.entry("engineConfigured", properties.engineEnabled()),
            Map.entry("players", matchmaking.players()), Map.entry("rankedPlayers", matchmaking.players(MatchService.Mode.RANKED)), Map.entry("placementMatches", RatingPolicy.PLACEMENTS),
            Map.entry("casualWaitSeconds", matchmaking.waitSeconds()), Map.entry("rankedAiEnabled", matchmaking.rankedAiEnabled()), Map.entry("customRooms", custom.available()));
    }
    @GetMapping("/api/auth/csrf") public Map<String, String> csrf(CsrfToken token) { return Map.of("token", token.getToken(), "headerName", token.getHeaderName()); }
    @GetMapping("/api/auth/username-availability") public AccountService.UsernameAvailability usernameAvailability(@RequestParam String username) { return accounts.usernameAvailability(username); }
    @PostMapping("/api/auth/register") @ResponseStatus(HttpStatus.CREATED)
    public AccountService.Profile register(@Valid @RequestBody Registration request) { return accounts.register(request.username(), request.password()); }
    @GetMapping("/api/account") public AccountService.Profile account(Authentication user) { return accounts.profile(user.getName()); }
    @GetMapping("/internal/accounts/{id}/equipment") public AccountService.Profile equipment(@PathVariable java.util.UUID id) { return accounts.profile(id); }
    @PostMapping("/api/account/rank-badge-ticket") public RankBadgeService.Ticket rankBadgeTicket(Authentication user, @Valid @RequestBody RankBadgeRequest request) { return badges.issue(accounts.credentials(user.getName()).id(), request.engineId()); }
    @PostMapping("/api/account/callsign") public AccountService.Profile callsign(Authentication user, @Valid @RequestBody Callsign request) { return accounts.updateCallsign(user.getName(), request.callsign()); }
    @PostMapping("/api/account/weapons/{weaponId}/suppressor") public AccountService.Profile suppressor(Authentication user, @PathVariable String weaponId, @Valid @RequestBody Suppressor request) { return accounts.setSuppressor(user.getName(), weaponId, request.equipped()); }
}
