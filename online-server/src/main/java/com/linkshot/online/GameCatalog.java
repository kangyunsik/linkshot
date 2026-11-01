package com.linkshot.online;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

@Component
public class GameCatalog {
    public record Weapon(String id, int price) {}
    public record Catalog(List<Weapon> weapons, List<String> maps, List<String> freeWeapons, Map<String, Integer> rewards) {}
    private final Catalog data;
    public GameCatalog() throws IOException {
        try (var input = new ClassPathResource("game-catalog.json").getInputStream()) { data = JsonMapper.builder().build().readValue(input, Catalog.class); }
    }
    public List<String> freeWeapons() { return data.freeWeapons(); }
    public List<String> maps() { return data.maps(); }
    public boolean weapon(String id) { return "knife".equals(id) || data.weapons().stream().anyMatch(weapon -> weapon.id().equals(id)); }
    public int reward(String kind) { return data.rewards().get(kind); }
}
