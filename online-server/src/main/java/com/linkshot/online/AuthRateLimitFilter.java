package com.linkshot.online;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.web.filter.OncePerRequestFilter;

// Volatile abuse control only: no IP address is persisted in account profiles.
final class AuthRateLimitFilter extends OncePerRequestFilter {
    private record Window(long until, int count) {}
    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws IOException, ServletException {
        String path = request.getRequestURI();
        if (!"POST".equals(request.getMethod()) || !(path.equals("/api/auth/login") || path.equals("/api/auth/register"))) { chain.doFilter(request, response); return; }
        long now = System.currentTimeMillis();
        if (windows.size() >= 10_000) windows.entrySet().removeIf(entry -> entry.getValue().until() <= now);
        if (windows.size() >= 10_000) { SecurityConfig.error(response, 429, "Try again later"); return; }
        Window window = windows.compute(request.getRemoteAddr(), (key, prior) -> prior == null || prior.until() <= now ? new Window(now + 60_000, 1) : new Window(prior.until(), prior.count() + 1));
        if (window.count() > 20) { response.setHeader("Retry-After", "60"); SecurityConfig.error(response, 429, "Try again later"); return; }
        if (path.endsWith("/login")) {
            String password = request.getParameter("password"), username = request.getParameter("username");
            if (password == null || password.getBytes(StandardCharsets.UTF_8).length > 72 || username == null || username.length() > 24) { SecurityConfig.error(response, 401, "Invalid credentials"); return; }
        }
        chain.doFilter(request, response);
    }
}
