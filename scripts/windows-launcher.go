package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"time"
)

// The packaging script copies this source beside the completed static build.
//go:embed web
var files embed.FS

func main() {
	content, err := fs.Sub(files, "web")
	if err != nil { fail(err) }
	listener, err := net.Listen("tcp4", "127.0.0.1:27007")
	if err != nil { listener, err = net.Listen("tcp4", "127.0.0.1:0") }
	if err != nil { fail(err) }
	url := "http://" + listener.Addr().String()
	fileServer := http.FileServer(http.FS(content))
	server := &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			host, _, splitErr := net.SplitHostPort(r.Host)
			if splitErr != nil || (host != "127.0.0.1" && host != "localhost") { http.Error(w, "Forbidden", http.StatusForbidden); return }
			if r.Method != http.MethodGet && r.Method != http.MethodHead { w.WriteHeader(http.StatusMethodNotAllowed); return }
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Cache-Control", "no-cache")
			fileServer.ServeHTTP(w, r)
		}),
	}
	fmt.Println("\n  LINKSHOT / SOLO EDITION")
	fmt.Println("  No installation, Node.js or Python required.")
	fmt.Println("  Opening your default browser...")
	fmt.Println("\n  " + url)
	fmt.Println("\n  Keep this window open while playing.")
	fmt.Println("  Close this window or press Ctrl+C to quit.\n")
	noBrowser := false
	for _, arg := range os.Args[1:] { if arg == "--no-browser" { noBrowser = true } }
	if !noBrowser {
		var command *exec.Cmd
		switch runtime.GOOS {
		case "windows": command = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
		case "darwin": command = exec.Command("open", url)
		default: command = exec.Command("xdg-open", url)
		}
		if err := command.Start(); err != nil { fmt.Println("  Open the URL above in Edge or Chrome.") } else { go command.Wait() }
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	go func() { <-stop; ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second); defer cancel(); server.Shutdown(ctx) }()
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed { fail(err) }
}

func fail(err error) {
	fmt.Println("LINKSHOT could not start: " + strings.TrimSpace(err.Error()))
	fmt.Println("Press Enter to close.")
	fmt.Scanln()
	os.Exit(1)
}
