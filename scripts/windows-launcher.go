package main

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
)

// The packaging script copies this source beside the completed static build.
//go:embed web
var files embed.FS

func main() {
	noBrowser := false
	for _, arg := range os.Args[1:] { if arg == "--no-browser" { noBrowser = true } }
	content, err := fs.Sub(files, "web")
	if err != nil { fail(err) }
	profiles, profileErr := openProfileStore(content)
	listener, err := net.Listen("tcp4", "127.0.0.1:27007")
	if err != nil && !noBrowser && profileErr == nil && os.Getenv("LINKSHOT_DATA_DIR") == "" {
		client := &http.Client{Timeout: 600 * time.Millisecond}
		if response, checkErr := client.Get("http://127.0.0.1:27007/api/profile"); checkErr == nil {
			var existing struct { Profile struct { ID string `json:"id"` } `json:"profile"` }
			decoded := json.NewDecoder(io.LimitReader(response.Body, 256*1024)).Decode(&existing) == nil
			running := decoded && response.StatusCode == 200 && response.Header.Get("X-Linkshot-Profile") == "1" && existing.Profile.ID == profiles.profile.ID
			io.Copy(io.Discard, response.Body); response.Body.Close()
			if running { openBrowser("http://127.0.0.1:27007"); return }
		}
	}
	if err != nil { listener, err = net.Listen("tcp4", "127.0.0.1:0") }
	if err != nil { fail(err) }
	url := "http://" + listener.Addr().String()
	fileServer := http.FileServer(http.FS(content))
	server := &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Frame-Options", "DENY")
			host, _, splitErr := net.SplitHostPort(r.Host)
			if splitErr != nil || (host != "127.0.0.1" && host != "localhost") { http.Error(w, "Forbidden", http.StatusForbidden); return }
			if r.URL.Path == "/api/profile" {
				if profileErr != nil { writeJSON(w, 503, map[string]any{"message": "PC 프로필 저장 파일을 읽을 수 없습니다. 브라우저 저장을 사용하세요."}); return }
				profiles.serve(w, r); return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead { w.WriteHeader(http.StatusMethodNotAllowed); return }
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Cache-Control", "no-cache")
			if r.URL.Path == "/runtime-config.js" {
				w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
				if r.Method != http.MethodHead { fmt.Fprint(w, "export const APP_MODE = 'solo';\nexport const PROFILE_STORAGE = 'host';\n") }; return
			}
			fileServer.ServeHTTP(w, r)
		}),
	}
	fmt.Println("\n  LINKSHOT / SOLO EDITION")
	fmt.Println("  No installation, Node.js or Python required.")
	fmt.Println("  Opening your default browser...")
	fmt.Println("\n  " + url)
	fmt.Println("\n  Keep this window open while playing.")
	fmt.Println("  Close this window or press Ctrl+C to quit.\n")
	if !noBrowser { openBrowser(url) }
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	go func() { <-stop; ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second); defer cancel(); server.Shutdown(ctx) }()
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed { fail(err) }
}

func openBrowser(url string) {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows": command = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin": command = exec.Command("open", url)
	default: command = exec.Command("xdg-open", url)
	}
	if err := command.Start(); err != nil { fmt.Println("  Open the local game URL in Edge or Chrome.") } else { go command.Wait() }
}

func fail(err error) {
	fmt.Println("LINKSHOT could not start: " + strings.TrimSpace(err.Error()))
	fmt.Println("Press Enter to close.")
	fmt.Scanln()
	os.Exit(1)
}

type roundProgress struct {
	Kills int64 `json:"kills"`
	Deaths int64 `json:"deaths"`
	WeaponKills map[string]int64 `json:"weaponKills"`
	Awarded bool `json:"awarded"`
	UpdatedAt int64 `json:"updatedAt"`
}
type localProfile struct {
	Version int `json:"version"`
	ID string `json:"id"`
	Callsign string `json:"callsign"`
	CharacterID string `json:"characterId"`
	Kills int64 `json:"kills"`
	Deaths int64 `json:"deaths"`
	Points int64 `json:"points"`
	TotalEarned int64 `json:"totalEarned"`
	RoundsPlayed int64 `json:"roundsPlayed"`
	Wins int64 `json:"wins"`
	OwnedOutfits []string `json:"ownedOutfits"`
	EquippedOutfitID string `json:"equippedOutfitId"`
	OwnedWeapons []string `json:"ownedWeapons"`
	WeaponKills map[string]int64 `json:"weaponKills"`
	RoundLedger map[string]roundProgress `json:"roundLedger"`
	CreatedAt int64 `json:"createdAt"`
	UpdatedAt int64 `json:"updatedAt"`
}
type economyConfig struct {
	Version int `json:"version"`
	Points struct { Completion int64 `json:"completion"`; PerKill int64 `json:"perKill"`; Victory int64 `json:"victory"` } `json:"points"`
	Outfits []struct { ID string `json:"id"`; Price int64 `json:"price"` } `json:"outfits"`
	Weapons []struct { ID string `json:"id"`; Price int64 `json:"price"` } `json:"weapons"`
	FreeWeapons []string `json:"freeWeapons"`
}
type profileOperation struct {
	Type string `json:"type"`
	Callsign string `json:"callsign"`
	CharacterID string `json:"characterId"`
	RoundID string `json:"roundId"`
	Kills int64 `json:"kills"`
	Deaths int64 `json:"deaths"`
	Completed bool `json:"completed"`
	Won bool `json:"won"`
	OutfitID string `json:"outfitId"`
	WeaponID string `json:"weaponId"`
	WeaponKills map[string]int64 `json:"weaponKills"`
}
type profileStore struct {
	mu sync.Mutex
	file string
	profile localProfile
	economy economyConfig
	prices map[string]int64
	weaponPrices map[string]int64
}
var profileIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$`)
func validLocalID(id string) bool { return profileIDPattern.MatchString(id) && id != "constructor" && id != "prototype" && id != "__proto__" }

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status); json.NewEncoder(w).Encode(value)
}
func profileCount(value int64) int64 { if value < 0 { return 0 }; if value > 1000000000 { return 1000000000 }; return value }
func hasOutfit(p localProfile, id string) bool { for _, owned := range p.OwnedOutfits { if owned == id { return true } }; return false }
func hasWeapon(p localProfile, id string) bool { for _, owned := range p.OwnedWeapons { if owned == id { return true } }; return false }
func (s *profileStore) weaponCounts(raw map[string]int64) map[string]int64 {
	result := map[string]int64{}; for _, id := range s.combatIDs() { if value := profileCount(raw[id]); value > 0 { result[id] = value } }; return result
}
func (s *profileStore) combatIDs() []string {
	ids := []string{}; for _, item := range s.economy.Weapons { ids = append(ids, item.ID) }; return append(ids, "knife")
}
func (s *profileStore) migrateWeapons() {
	if s.profile.CharacterID != "male" && s.profile.CharacterID != "female" { s.profile.CharacterID = "male" }
	owned := s.profile.OwnedWeapons; s.profile.OwnedWeapons = []string{}
	for _, item := range s.economy.Weapons { found := item.Price == 0; for _, id := range owned { if id == item.ID { found = true } }; if found { s.profile.OwnedWeapons = append(s.profile.OwnedWeapons, item.ID) } }
	s.profile.WeaponKills = s.weaponCounts(s.profile.WeaponKills)
	for id, entry := range s.profile.RoundLedger { entry.WeaponKills = s.weaponCounts(entry.WeaponKills); s.profile.RoundLedger[id] = entry }
}
func cleanCallsign(value string) string {
	runes := []rune(strings.TrimSpace(strings.Map(func(r rune) rune { if unicode.IsControl(r) || r == '<' || r == '>' { return -1 }; return r }, value)))
	if len(runes) > 16 { runes = runes[:16] }; if len(runes) == 0 { return "OPERATOR" }; return string(runes)
}
func openProfileStore(content fs.FS) (*profileStore, error) {
	// A random per-OS-user ID is persisted; hostname, MAC, IP and account names are never collected.
	dir := os.Getenv("LINKSHOT_DATA_DIR")
	if dir == "" { base, err := os.UserConfigDir(); if err != nil { return nil, err }; dir = filepath.Join(base, "LINKSHOT") }
	if err := os.MkdirAll(dir, 0700); err != nil { return nil, err }
	s := &profileStore{file: filepath.Join(dir, "profile.json"), prices: map[string]int64{}, weaponPrices: map[string]int64{}}
	config, err := fs.ReadFile(content, "economy.json"); if err != nil { return nil, err }
	if err := json.Unmarshal(config, &s.economy); err != nil || s.economy.Version != 1 { return nil, fmt.Errorf("invalid economy configuration") }
	for _, outfit := range s.economy.Outfits { if outfit.Price < 0 || outfit.Price > 1000000 { return nil, fmt.Errorf("invalid cosmetic price") }; s.prices[outfit.ID] = outfit.Price }
	if _, ok := s.prices["field"]; !ok { return nil, fmt.Errorf("missing default cosmetic") }
	for _, item := range s.economy.Weapons { if item.Price != 0 && (item.Price < 600 || item.Price > 2000) { return nil, fmt.Errorf("invalid weapon price") }; s.weaponPrices[item.ID] = item.Price }
	if price, ok := s.weaponPrices["rifle"]; !ok || price != 0 { return nil, fmt.Errorf("missing starter weapon") }
	bytes, err := os.ReadFile(s.file)
	if err == nil {
		if len(bytes) > 1024*1024 || json.Unmarshal(bytes, &s.profile) != nil || s.profile.Version != 1 || !validLocalID(s.profile.ID) { return nil, fmt.Errorf("existing profile needs recovery") }
		if s.profile.RoundLedger == nil { s.profile.RoundLedger = map[string]roundProgress{} }
		if !hasOutfit(s.profile, "field") { s.profile.OwnedOutfits = append(s.profile.OwnedOutfits, "field") }
		if !hasOutfit(s.profile, s.profile.EquippedOutfitID) { s.profile.EquippedOutfitID = "field" }
		s.migrateWeapons()
		return s, nil
	}
	if !os.IsNotExist(err) { return nil, err }
	var id [16]byte; if _, err := rand.Read(id[:]); err != nil { return nil, err }; id[6] = (id[6] & 0x0f) | 0x40; id[8] = (id[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(id[:]); uuid := encoded[:8]+"-"+encoded[8:12]+"-"+encoded[12:16]+"-"+encoded[16:20]+"-"+encoded[20:]
	now := time.Now().UnixMilli()
	s.profile = localProfile{Version: 1, ID: uuid, Callsign: "OPERATOR", OwnedOutfits: []string{"field"}, EquippedOutfitID: "field", RoundLedger: map[string]roundProgress{}, CreatedAt: now, UpdatedAt: now}
	s.migrateWeapons()
	if err := s.save(s.profile); err != nil { return nil, err }; return s, nil
}
func (s *profileStore) save(profile localProfile) error {
	bytes, err := json.MarshalIndent(profile, "", "  "); if err != nil { return err }
	temporary := s.file + ".tmp"
	file, err := os.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600); if err != nil { return err }
	if _, err := file.Write(bytes); err != nil { file.Close(); return err }
	if err := file.Sync(); err != nil { file.Close(); return err }
	if err := file.Close(); err != nil { return err }
	return os.Rename(temporary, s.file)
}
func (s *profileStore) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Linkshot-Profile", "1")
	if r.Method != http.MethodGet && r.Method != http.MethodPost { w.WriteHeader(405); return }
	if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host { http.Error(w, "Forbidden", 403); return }
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" { http.Error(w, "Forbidden", 403); return }
	s.mu.Lock(); defer s.mu.Unlock()
	if r.Method == http.MethodGet { writeJSON(w, 200, map[string]any{"scope": "host", "profile": s.profile}); return }
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") { writeJSON(w, 415, map[string]any{"message": "JSON 요청만 허용됩니다."}); return }
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024); defer r.Body.Close()
	decoder := json.NewDecoder(r.Body); decoder.DisallowUnknownFields(); var operation profileOperation
	if decoder.Decode(&operation) != nil || decoder.Decode(new(any)) != io.EOF { writeJSON(w, 400, map[string]any{"message": "잘못된 프로필 요청입니다."}); return }
	next := s.profile; next.OwnedOutfits = append([]string{}, s.profile.OwnedOutfits...); next.RoundLedger = map[string]roundProgress{}
	next.OwnedWeapons = append([]string{}, s.profile.OwnedWeapons...); next.WeaponKills = s.weaponCounts(s.profile.WeaponKills)
	for id, entry := range s.profile.RoundLedger { next.RoundLedger[id] = entry }
	now := time.Now().UnixMilli(); changed := false; var award map[string]any; var cost int64
	responseError := func(message string) { writeJSON(w, 409, map[string]any{"message": message, "profile": s.profile}) }
	switch operation.Type {
	case "name":
		name := cleanCallsign(operation.Callsign); changed = name != next.Callsign; next.Callsign = name
	case "character":
		if operation.CharacterID != "male" && operation.CharacterID != "female" { responseError("존재하지 않는 캐릭터입니다."); return }
		changed = next.CharacterID != operation.CharacterID; next.CharacterID = operation.CharacterID
	case "round":
		if !validLocalID(operation.RoundID) { responseError("라운드 ID가 올바르지 않습니다."); return }
		prior := next.RoundLedger[operation.RoundID]; kills := max(prior.Kills, profileCount(operation.Kills)); deaths := max(prior.Deaths, profileCount(operation.Deaths))
		pay := operation.Completed && !prior.Awarded; changed = kills != prior.Kills || deaths != prior.Deaths || pay
		weapons := s.weaponCounts(prior.WeaponKills); remaining := kills; for _, value := range weapons { remaining -= value }; remaining = max(int64(0), remaining)
		for _, id := range s.combatIDs() {
			delta := min(remaining, max(int64(0), profileCount(operation.WeaponKills[id]) - weapons[id]))
			if delta > 0 { weapons[id] += delta; next.WeaponKills[id] = profileCount(next.WeaponKills[id] + delta); remaining -= delta; changed = true }
		}
		next.Kills = profileCount(next.Kills + kills - prior.Kills); next.Deaths = profileCount(next.Deaths + deaths - prior.Deaths)
		if changed { next.RoundLedger[operation.RoundID] = roundProgress{Kills: kills, Deaths: deaths, WeaponKills: weapons, Awarded: prior.Awarded || pay, UpdatedAt: now} }
		if pay {
			killBonus := min(kills, 10000) * s.economy.Points.PerKill; winBonus := int64(0); if operation.Won { winBonus = s.economy.Points.Victory; next.Wins = profileCount(next.Wins + 1) }
			points := s.economy.Points.Completion + killBonus + winBonus; next.Points = profileCount(next.Points + points); next.TotalEarned = profileCount(next.TotalEarned + points); next.RoundsPlayed = profileCount(next.RoundsPlayed + 1)
			award = map[string]any{"completion": s.economy.Points.Completion, "killBonus": killBonus, "winBonus": winBonus, "points": points, "won": operation.Won}
		}
	case "purchase", "equip":
		price, exists := s.prices[operation.OutfitID]; if !exists { responseError("존재하지 않는 외형입니다."); return }
		if !hasOutfit(next, operation.OutfitID) {
			if operation.Type == "equip" { responseError("보유한 외형만 장착할 수 있습니다."); return }
			if next.Points < price { responseError("포인트가 부족합니다."); return }
			next.Points -= price; cost = price; next.OwnedOutfits = append(next.OwnedOutfits, operation.OutfitID); changed = true
		}
		changed = changed || next.EquippedOutfitID != operation.OutfitID; next.EquippedOutfitID = operation.OutfitID
	case "purchaseWeapon":
		price, exists := s.weaponPrices[operation.WeaponID]; if !exists { responseError("존재하지 않는 무기입니다."); return }
		if !hasWeapon(next, operation.WeaponID) {
			if next.Points < price { responseError("포인트가 부족합니다."); return }
			next.Points -= price; cost = price; next.OwnedWeapons = append(next.OwnedWeapons, operation.WeaponID); changed = true
		}
	default: responseError("지원하지 않는 프로필 작업입니다."); return
	}
	if len(next.RoundLedger) > 256 {
		ids := make([]string, 0, len(next.RoundLedger)); for id := range next.RoundLedger { ids = append(ids, id) }
		sort.Slice(ids, func(i,j int) bool { return next.RoundLedger[ids[i]].UpdatedAt < next.RoundLedger[ids[j]].UpdatedAt })
		for _, id := range ids[:len(ids)-256] { delete(next.RoundLedger, id) }
	}
	if changed { next.UpdatedAt = now; if s.save(next) != nil { writeJSON(w, 503, map[string]any{"message": "PC 프로필을 저장하지 못했습니다.", "profile": s.profile}); return }; s.profile = next }
	writeJSON(w, 200, map[string]any{"scope": "host", "profile": s.profile, "award": award, "cost": cost})
}
