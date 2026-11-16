package com.linkshot.online;

import java.util.List;
import java.util.LinkedHashSet;
import java.net.URI;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("linkshot")
public record OnlineProperties(String engineSecret, String enginePublicUrl, List<String> allowedOrigins) {
    public OnlineProperties {
        var origins = new LinkedHashSet<>(allowedOrigins == null ? List.<String>of() : allowedOrigins);
        for (String origin : List.copyOf(origins)) {
            var uri = URI.create(origin);
            if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null || uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || !uri.getPath().isEmpty() || origin.contains("*")) throw new IllegalArgumentException("FRONTEND_ORIGINS must contain explicit HTTP(S) origins");
            if (!"http".equals(uri.getScheme()) || !privateHost(uri.getHost())) continue;
            String port = uri.getPort() == -1 || uri.getPort() == 80 ? "" : ":" + uri.getPort();
            origins.add("http://127.0.0.1" + port); origins.add("http://localhost" + port);
        }
        allowedOrigins = List.copyOf(origins);
    }
    private static boolean privateHost(String host) {
        if ("127.0.0.1".equals(host) || "localhost".equals(host)) return true;
        if (host == null || !host.matches("\\d{1,3}(\\.\\d{1,3}){3}")) return false;
        var parts = host.split("\\."); var numbers = new int[4];
        for (int i = 0; i < 4; i++) { numbers[i] = Integer.parseInt(parts[i]); if (numbers[i] > 255) return false; }
        return numbers[0] == 10 || numbers[0] == 172 && numbers[1] >= 16 && numbers[1] <= 31 || numbers[0] == 192 && numbers[1] == 168;
    }
    public boolean engineEnabled() { return engineSecret != null && engineSecret.length() >= 32; }
}
