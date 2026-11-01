package com.linkshot.online;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.nio.file.Files;
import java.nio.file.Path;

// Development entry point, loopback by default with an explicit LAN opt-in.
// The database stays on loopback even when ONLINE_BIND exposes the HTTP API.
// Not included in the server JAR.
public final class DevelopmentServer {
    public static void main(String[] args) throws Exception {
        Path root = Path.of(System.getenv().getOrDefault("ONLINE_DATA_DIR", "../data/online-dev")).toAbsolutePath();
        Files.createDirectories(root); Files.createDirectories(Path.of("target", "postgres-dev"));
        var postgres = EmbeddedPostgres.builder().setOverrideWorkingDirectory(Path.of("target", "postgres-dev").toAbsolutePath().toFile()).setDataDirectory(root.resolve("postgres")).setCleanDataDirectory(false).setLocaleConfig("locale", "C").setServerConfig("listen_addresses", "127.0.0.1").setServerConfig("unix_socket_directories", "").setPort(0).start();
        System.setProperty("spring.datasource.url", postgres.getJdbcUrl("postgres", "postgres")); System.setProperty("spring.datasource.username", "postgres"); System.setProperty("spring.datasource.password", "");
        var context = org.springframework.boot.SpringApplication.run(OnlineApplication.class, args);
        System.out.println("LINKSHOT LOCAL API http://127.0.0.1:" + context.getEnvironment().getProperty("local.server.port"));
    }
}
