package com.linkshot.online;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component @Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class RequestLimits extends OncePerRequestFilter {
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws IOException, ServletException {
        response.setHeader("Cache-Control", "no-store");
        if (request.getContentLengthLong() > 32_768) { SecurityConfig.error(response, 413, "Request too large"); return; }
        if (request.getContentType() == null || !request.getContentType().toLowerCase(java.util.Locale.ROOT).startsWith("application/json")) { chain.doFilter(request, response); return; }
        var input = request.getInputStream();
        var limited = new ServletInputStream() {
            int read;
            private void check(int count) throws IOException { if (count > 0 && (read += count) > 32_768) throw new IOException("Request too large"); }
            @Override public int read() throws IOException { int value = input.read(); check(value < 0 ? 0 : 1); return value; }
            @Override public int read(byte[] bytes, int offset, int length) throws IOException { int count = input.read(bytes, offset, Math.min(length, 32_769 - read)); check(count); return count; }
            @Override public boolean isFinished() { return input.isFinished(); }
            @Override public boolean isReady() { return input.isReady(); }
            @Override public void setReadListener(ReadListener listener) { input.setReadListener(listener); }
        };
        chain.doFilter(new HttpServletRequestWrapper(request) {
            @Override public ServletInputStream getInputStream() { return limited; }
            @Override public BufferedReader getReader() { return new BufferedReader(new InputStreamReader(limited, StandardCharsets.UTF_8)); }
        }, response);
    }
}
