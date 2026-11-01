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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuthController {
    private final AccountService accounts;
    private final OnlineProperties properties;
    private final MatchmakingService matchmaking;
    public AuthController(AccountService accounts, OnlineProperties properties, MatchmakingService matchmaking) { this.accounts = accounts; this.properties = properties; this.matchmaking = matchmaking; }
    public record Registration(@NotBlank @Size(max = 24) String username, @NotBlank @Size(max = 72) String password, @NotBlank @Size(max = 32) String callsign) {}
    @GetMapping("/api/health") public Map<String, Object> health() { return Map.of("status", "UP", "service", "linkshot-online", "auth", true, "matchmaking", matchmaking.available(), "combatEngine", "shared-js", "engineConfigured", properties.engineEnabled(), "players", matchmaking.players(), "casualWaitSeconds", matchmaking.waitSeconds()); }
    @GetMapping("/api/auth/csrf") public Map<String, String> csrf(CsrfToken token) { return Map.of("token", token.getToken(), "headerName", token.getHeaderName()); }
    @PostMapping("/api/auth/register") @ResponseStatus(HttpStatus.CREATED)
    public AccountService.Profile register(@Valid @RequestBody Registration request) { return accounts.register(request.username(), request.password(), request.callsign()); }
    @GetMapping("/api/account") public AccountService.Profile account(Authentication user) { return accounts.profile(user.getName()); }
}
