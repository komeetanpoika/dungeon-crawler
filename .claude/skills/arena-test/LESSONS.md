# Arena Test Lessons

Read this before every arena test. Append one imperative line when a run teaches something reusable — this file is why run N+1 goes better than run N.

- Launch via `.claude/skills/run-game/driver.mjs` (`launch` → `press`/`ss`/`eval`/`quit`); on WSLg set `DISPLAY=:0`.
- Type the level0 cheat on the title screen one key at a time: `press l`, `press e`, `press v`, `press e`, `press l`, `press 0`.
- `arena-config.json` is re-read on every level0 entry — edit the config and re-enter the arena instead of relaunching Electron.
- Screenshots land in `$SCREENSHOT_DIR` (default `/tmp/shots`) via the driver's `ss` command.
- After any automated run, `git status --porcelain renderer/data/` must be clean (editor autosave hazard) — restore `painter-maps.json` if it changed.
