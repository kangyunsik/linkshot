package com.linkshot.online;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class RankBadgeController {
    public record Proof(@NotBlank @Size(max = 64) String engineId, @NotBlank @Size(max = 43) String ticket) {}
    private final RankBadgeService badges;
    public RankBadgeController(RankBadgeService badges) { this.badges = badges; }
    @PostMapping("/internal/lan/rank-badge")
    public AccountService.Profile consume(@Valid @RequestBody Proof proof) { return badges.consume(proof.ticket(), proof.engineId()); }
}
