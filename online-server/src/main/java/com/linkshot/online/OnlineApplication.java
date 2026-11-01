package com.linkshot.online;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableConfigurationProperties(OnlineProperties.class)
@EnableScheduling
public class OnlineApplication {
    public static void main(String[] args) { SpringApplication.run(OnlineApplication.class, args); }
}
