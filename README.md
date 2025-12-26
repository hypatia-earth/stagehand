# Stagehand

A persistent browser automation skill for Claude Code using Playwright.

## What it does

Keeps a browser window open and lets you send commands to it - navigate, execute JavaScript, inspect console logs. Perfect for interactive debugging, development, and testing web applications.

## Installation

```bash
# Clone to your Claude skills folder
git clone git@github.com:hypatia-earth/stagehand.git ~/.claude/skills/playwright-skill

# Install dependencies
cd ~/.claude/skills/playwright-skill
npm install
```

## Usage

Start the daemon:
```bash
node ~/.claude/skills/playwright-skill/browser-daemon.js --browser firefox --size dev
```

Send commands:
```bash
# Navigate
node ~/.claude/skills/playwright-skill/browser-client.js goto "https://example.com"

# Execute JavaScript
node ~/.claude/skills/playwright-skill/browser-client.js exec "document.title"

# Read console logs
node ~/.claude/skills/playwright-skill/browser-client.js console

# Clear console
node ~/.claude/skills/playwright-skill/browser-client.js console-clear
```

## Claude Code Integration

Add to your project's `.claude/settings.json`:
```json
{
  "skills": ["playwright-skill"]
}
```

See [SKILL.md](SKILL.md) for full documentation.

## Credits

Inspired by [playwright-skill](https://github.com/lackeyjb/playwright-skill)

## License

MIT
