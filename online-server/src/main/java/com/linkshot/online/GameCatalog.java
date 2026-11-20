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
    public record Mastery(int suppressorLevel, long suppressorKills) {}
    public record Catalog(List<Weapon> weapons, List<String> maps, List<String> freeWeapons, Map<String, Integer> rewards, Mastery mastery, List<String> characters, Map<String, Integer> outfits) {}
    private final Catalog data;
    public GameCatalog() throws IOException {
        try (var input = new ClassPathResource("game-catalog.json").getInputStream()) { data = JsonMapper.builder().build().readValue(input, Catalog.class); }
    }
    public List<String> freeWeapons() { return data.freeWeapons(); }
    public List<String> maps() { return data.maps(); }
    public boolean weapon(String id) { return "knife".equals(id) || data.weapons().stream().anyMatch(weapon -> weapon.id().equals(id)); }
    public boolean firearm(String id) { return data.weapons().stream().anyMatch(weapon -> weapon.id().equals(id)); }
    public int weaponCount() { return data.weapons().size(); }
    public int weaponPrice(String id) { return data.weapons().stream().filter(weapon -> weapon.id().equals(id)).findFirst().orElseThrow(() -> new IllegalArgumentException("총기를 확인해 주세요.")).price(); }
    public boolean character(String id) { return id != null && data.characters().contains(id); }
    public int outfitPrice(String id) {
        Integer price = id == null ? null : data.outfits().get(id);
        if (price == null) throw new IllegalArgumentException("외형을 확인해 주세요.");
        return price;
    }
    public Mastery mastery() { return data.mastery(); }
    public int reward(String kind) { return data.rewards().get(kind); }
}
