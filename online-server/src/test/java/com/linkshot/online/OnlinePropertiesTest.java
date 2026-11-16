package com.linkshot.online;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;

class OnlinePropertiesTest {
    private static final String LAN_HOST = String.join(".", "192", "168", "40", "25");
    @Test void lanOriginsAlsoAllowMatchingPortLoopbackWithoutAnyModeFlag() {
        var properties = new OnlineProperties(null, null, List.of("http://" + LAN_HOST + ":4181"));
        assertEquals(List.of("http://" + LAN_HOST + ":4181", "http://127.0.0.1:4181", "http://localhost:4181"), properties.allowedOrigins());
        assertFalse(properties.allowedOrigins().contains("http://127.0.0.1:4173"));
    }
    @Test void productionOriginsAndExactOriginValidationAreNotWeakened() {
        for (String origin : List.of("https://game.example.invalid", "http://game.example.invalid", "https://" + LAN_HOST + ":4173")) assertEquals(List.of(origin), new OnlineProperties(null, null, List.of(origin)).allowedOrigins());
        String credentialed = String.join("", "http://", "test-user", ":", "test-only-value", "@localhost:4173");
        for (String origin : List.of("http://*.example.invalid", "http://localhost:4173/path", credentialed, "http://localhost:4173?x=1", "ws://localhost:4173")) assertThrows(IllegalArgumentException.class, () -> new OnlineProperties(null, null, List.of(origin)));
    }
}
