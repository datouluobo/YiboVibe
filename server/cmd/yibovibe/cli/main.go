// CLI entry for YiboVibe IDE provider management
// Usage: yibovibe ide attach <provider> | yibovibe ide list | yibovibe session ls

package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	subcommand := os.Args[1]
	switch subcommand {
	case "ide":
		handleIDE(os.Args[2:])
	case "session":
		handleSession(os.Args[2:])
	case "doctor":
		handleDoctor()
	case "help", "--help", "-h":
		printUsage()
	default:
		fmt.Printf("Unknown command: %s\n\n", subcommand)
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println(`YiboVibe CLI — manage AI IDE providers and sessions

Usage:
  yibovibe ide attach <provider>   Connect to an AI provider (codex, cursor, claude-code)
  yibovibe ide list                 List available and active providers
  yibovibe ide set <provider>       Set the active provider
  yibovibe session ls               List active sessions
  yibovibe session inspect <id>     Show session details
  yibovibe doctor                   Diagnose environment and provider availability
  yibovibe help                     Show this help`)
}

func handleIDE(args []string) {
	if len(args) == 0 {
		fmt.Println("Usage: yibovibe ide attach <provider> | yibovibe ide list | yibovibe ide set <provider>")
		return
	}

	sub := args[0]
	switch sub {
	case "attach":
		if len(args) < 2 {
			fmt.Println("Usage: yibovibe ide attach <provider>")
			fmt.Println("Providers: codex, cursor, claude-code")
			return
		}
		provider := args[1]
		attachProvider(provider)

	case "list":
		listProviders()

	case "set":
		if len(args) < 2 {
			fmt.Println("Usage: yibovibe ide set <provider>")
			return
		}
		setProvider(args[1])

	default:
		fmt.Printf("Unknown ide subcommand: %s\n", sub)
	}
}

func handleSession(args []string) {
	if len(args) == 0 || args[0] == "ls" || args[0] == "list" {
		listSessions()
		return
	}
	if args[0] == "inspect" {
		if len(args) < 2 {
			fmt.Println("Usage: yibovibe session inspect <id>")
			return
		}
		inspectSession(args[1])
		return
	}
	fmt.Printf("Unknown session subcommand: %s\n", args[0])
}

func handleDoctor() {
	fmt.Println("YiboVibe Environment Diagnostics")
	fmt.Println("================================")
	fmt.Println()
	fmt.Println("Checking AI providers...")
	// TODO: Probe each registered provider
	fmt.Println("  [ ] Codex (Cline fork)")
	fmt.Println("  [ ] Cursor")
	fmt.Println("  [ ] Claude Code")
	fmt.Println()
	fmt.Println("Run 'yibovibe ide list' for detailed provider status.")
}

func attachProvider(provider string) {
	fmt.Printf("Attaching to %s...\n", provider)
	// TODO: Delegate to Tauri backend or start the provider bridge
	fmt.Printf("Provider '%s' attachment initiated (stub).\n", provider)
}

func listProviders() {
	fmt.Println("Available AI Providers:")
	fmt.Println("  codex       — Codex (Cline fork) [active]")
	fmt.Println("  cursor      — Cursor IDE [not connected]")
	fmt.Println("  claude-code — Claude Code CLI [not connected]")
	fmt.Println()
	fmt.Println("Use 'yibovibe ide attach <provider>' to connect.")
}

func setProvider(provider string) {
	fmt.Printf("Setting active provider to %s...\n", provider)
	// TODO: Persist provider selection
	fmt.Println("Provider set (stub).")
}

func listSessions() {
	fmt.Println("Active Sessions:")
	fmt.Println("  No active sessions (stub).")
}

func inspectSession(id string) {
	fmt.Printf("Session %s:\n", id)
	fmt.Println("  Status: stub")
	fmt.Println("  Provider: stub")
	fmt.Println("  Started: stub")
}
