package com.linkshot.online;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.session.web.http.DefaultCookieSerializer;
import org.springframework.beans.factory.annotation.Value;
import tools.jackson.databind.ObjectMapper;

@Configuration
public class SecurityConfig {
    @Bean PasswordEncoder passwords() { return new BCryptPasswordEncoder(12); }
    @Bean CookieSerializer cookieSerializer(@Value("${server.servlet.session.cookie.secure}") boolean secure, @Value("${server.servlet.session.cookie.same-site}") String sameSite) {
        sameSite = sameSite.toLowerCase(java.util.Locale.ROOT);
        if (!List.of("lax", "strict", "none").contains(sameSite) || sameSite.equals("none") && !secure) throw new IllegalArgumentException("Cross-site session cookies require HTTPS");
        var cookie = new DefaultCookieSerializer(); cookie.setCookieName("LINKSHOTSESSION"); cookie.setCookiePath("/api"); cookie.setUseHttpOnlyCookie(true); cookie.setUseSecureCookie(secure); cookie.setSameSite(Character.toUpperCase(sameSite.charAt(0)) + sameSite.substring(1)); return cookie;
    }
    @Bean UserDetailsService users(AccountService accounts) {
        return username -> { var user = accounts.credentials(username); return User.withUsername(user.username()).password(user.passwordHash()).roles("USER").build(); };
    }
    static void error(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status); response.setContentType("application/json;charset=UTF-8"); response.getWriter().write("{\"message\":\"" + message + "\"}");
    }

    @Bean @Order(1)
    SecurityFilterChain engine(HttpSecurity http, OnlineProperties properties) throws Exception {
        http.securityMatcher("/internal/**").csrf(csrf -> csrf.disable()).sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
        http.addFilterBefore(new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws IOException, ServletException {
                if (!properties.engineEnabled()) { error(response, 503, "Engine integration is not configured"); return; }
                String header = request.getHeader("Authorization");
                boolean valid = header != null && header.startsWith("Bearer ") && MessageDigest.isEqual(header.substring(7).getBytes(StandardCharsets.UTF_8), properties.engineSecret().getBytes(StandardCharsets.UTF_8));
                if (!valid || request.getHeader("Origin") != null) { error(response, 401, "Engine authentication required"); return; }
                SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("combat-engine", null, List.of(new SimpleGrantedAuthority("ROLE_ENGINE")))); chain.doFilter(request, response);
            }
        }, UsernamePasswordAuthenticationFilter.class);
        http.authorizeHttpRequests(auth -> auth.anyRequest().hasRole("ENGINE"));
        return http.build();
    }

    @Bean
    SecurityFilterChain browser(HttpSecurity http, AccountService accounts, ObjectMapper json, CorsConfigurationSource corsConfigurationSource) throws Exception {
        http.cors(cors -> cors.configurationSource(corsConfigurationSource)).authorizeHttpRequests(auth -> auth.requestMatchers("/api/health", "/api/auth/csrf", "/api/auth/register", "/api/auth/login", "/error").permitAll().anyRequest().authenticated());
        http.addFilterBefore(new AuthRateLimitFilter(), UsernamePasswordAuthenticationFilter.class);
        http.exceptionHandling(errors -> errors.authenticationEntryPoint((request, response, exception) -> error(response, 401, "Login required")).accessDeniedHandler((request, response, exception) -> error(response, 403, "Request not permitted")));
        http.formLogin(login -> login.loginProcessingUrl("/api/auth/login").successHandler((request, response, authentication) -> { response.setContentType("application/json;charset=UTF-8"); json.writeValue(response.getOutputStream(), Map.of("profile", accounts.profile(authentication.getName()))); }).failureHandler((request, response, exception) -> error(response, 401, "Invalid credentials")));
        http.logout(logout -> logout.logoutUrl("/api/auth/logout").invalidateHttpSession(true).logoutSuccessHandler((request, response, authentication) -> response.setStatus(204)));
        return http.build();
    }

    @Bean CorsConfigurationSource corsConfigurationSource(OnlineProperties properties) {
        var policy = new CorsConfiguration();
        for (String origin : properties.allowedOrigins()) if (origin.contains("*") || !origin.matches("https?://[^/]+")) throw new IllegalArgumentException("FRONTEND_ORIGINS must contain explicit HTTP(S) origins");
        policy.setAllowedOrigins(properties.allowedOrigins()); policy.setAllowCredentials(true); policy.setAllowedMethods(List.of("GET", "POST", "DELETE", "OPTIONS")); policy.setAllowedHeaders(List.of("Content-Type", "X-CSRF-TOKEN")); policy.setMaxAge(600L);
        var source = new UrlBasedCorsConfigurationSource(); source.registerCorsConfiguration("/api/**", policy); return source;
    }
}
