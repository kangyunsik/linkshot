package com.linkshot.online;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class CustomAccessController {
    private final CustomAccessService custom;
    private final AccountService accounts;
    public CustomAccessController(CustomAccessService custom, AccountService accounts) { this.custom = custom; this.accounts = accounts; }
    public record Consume(String engineId, String ticket) {}
    @PostMapping("/api/custom/ticket") public CustomAccessService.Ticket ticket(Authentication user) { return custom.ticket(accounts.credentials(user.getName()).id()); }
    @PostMapping("/internal/custom/consume-ticket") public AccountService.Profile consume(@RequestBody Consume request) { return custom.consume(request.ticket(), request.engineId()); }
}
