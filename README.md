# Claude Code for Obsidian

An Obsidian plugin that lets you run [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) tasks on your notes — summarize, review, fix grammar, extract action items, or run any custom prompt.

![Desktop Only](https://img.shields.io/badge/platform-desktop%20only-blue)

## Prerequisites

You need the Claude Code CLI installed and authenticated:

```bash
npm install -g @anthropic-ai/claude-code
claude  # follow the auth flow once
```

## Installation

### Manual (recommended for now)

1. Copy `main.js`, `manifest.json`, and `styles.css` into your vault at `.obsidian/plugins/claude-code/`
2. Open Obsidian → Settings → Community Plugins → enable "Claude Code"

### BRAT

You can also install via [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install the BRAT plugin
2. Add `datvo06/obsidian-claude-code` as a beta plugin

## Usage

Open the command palette (`Cmd/Ctrl + P`) and search for **Claude Code**. Available commands:

| Command | What it does |
|---------|-------------|
| **Summarize note** | Concise summary preserving key info |
| **Explain note** | Plain-language explanation of the content |
| **Review & suggest improvements** | Clarity, accuracy, and completeness review |
| **Extract action items** | Pulls TODOs into a markdown checklist |
| **Fix grammar & spelling** | Corrects errors, preserves formatting |
| **ELI5** | Explains it like you're five |
| **Custom prompt…** | Opens a text box for any prompt you want |

All commands work on the **full note** or just the **current selection**.

## Settings

In Settings → Claude Code:

- **Claude CLI path** — defaults to `claude`. Set a full path if it's not in your PATH (e.g. `~/.local/bin/claude`).
- **Output mode**:
  - *Show in modal* — displays the result in a popup with a copy button
  - *Append to note* — adds the result at the end of the note
  - *Replace selection* — replaces your selected text with the result
- **Custom tasks** — define reusable prompts (name + prompt) that show up in the command palette

## How it works

The plugin shells out to `claude -p --output-format text` with your note content piped via stdin. It runs in your vault directory as the working directory. No data is sent anywhere except through the Claude Code CLI, which uses your own Anthropic account.

## License

MIT
