# Demo recording for the README (VHS, https://github.com/charmbracelet/vhs).
# Run through docs/record-demo.sh from the repository root; it crops the
# result to the sidebar and optimizes it into docs/assets/demo.gif.
#
# Privacy: Claude Code runs on a throwaway, signed-out profile with a fake API
# key (the header reads "API Usage Billing", no account), and /hud-demo is on
# before anything is shown, so every visible frame is fictional sample data.
# No prompt is sent, so nothing is billed.
Output docs/assets/demo-full.gif
Set Shell "bash"
Set FontSize 14
Set Width 1600
Set Height 1300
Set Padding 10
Set TypingSpeed 0
Set Theme "Catppuccin Mocha"

Hide
Type `export HUD_REPO="$PWD" HUD_PROFILE="$(mktemp -d)" HUD_DEMO="$(mktemp -d)/shop-api" && mkdir -p "$HUD_DEMO" && cd "$HUD_DEMO" && git init -q`
Enter
Type `clear; env -u CLAUDE_CODE_CHILD_SESSION CLAUDE_CONFIG_DIR="$HUD_PROFILE" ANTHROPIC_API_KEY=sk-ant-api03-demo-not-a-real-key claude --plugin-dir "$HUD_REPO" --settings '{"tui":"fullscreen"}'`
Enter
Sleep 8s
# First-run screens of a fresh profile: theme (keep), use the API key (Yes),
# security notes, trust this folder (Yes), external CLAUDE.md imports (No).
Enter
Sleep 3s
Up
Enter
Sleep 4s
Enter
Sleep 4s
Down
Enter
Sleep 4s
Enter
Sleep 8s
Type "/hud-demo"
Enter
Sleep 1s
Show
# The sample session: subagents start, finish (one fails), todos advance.
Sleep 20s
Hide
Ctrl+C
Ctrl+C
Sleep 1s
Type `cd "$HUD_REPO"; rm -rf "$HUD_PROFILE" "$(dirname "$HUD_DEMO")"`
Enter
Sleep 1s
