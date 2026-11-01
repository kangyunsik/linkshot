package com.linkshot.online;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("linkshot")
public record OnlineProperties(String engineSecret, String enginePublicUrl, List<String> allowedOrigins) {
    public boolean engineEnabled() { return engineSecret != null && engineSecret.length() >= 32; }
}
