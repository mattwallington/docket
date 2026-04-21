# docket

A self-refreshing HTML viewer for markdown checklists.

Write your checklists as ordinary markdown files with a small YAML frontmatter. Run `docket.py` and open `~/.docket/dashboards.html` in a browser. Leave the tab open — it auto-refreshes every 30 seconds and picks up whatever you edited last.

```
┌─────────────────┬────────────────────────────────────────┐
│ Dashboards      │  Unified Auth Rollout          ☰       │
│                 │  reperio-telehealth                     │
│ ▸ Unified Auth  │                                         │
│   41/55 done    │  Done: 41  Pending: 10  Blocked: 4     │
│ ▸ DB Migration  │  ██████████████░░░░░░░░ 75%            │
│   3/12 done     │                                         │
│                 │  ▾ Phase 1 — Auth-App          36/42   │
└─────────────────┴────────────────────────────────────────┘
```

- Sidebar lists every checklist with progress stats
- Last-selected checklist persists across refreshes
- Phase cards collapse/expand; state persists too
- Pure static HTML — no server, no dependencies, works offline via `file://`

## Why

For long-running work — test matrices, migrations, multi-phase rollouts — where a "what's done, what's left" view on a permanent tab is useful.

## Install

No dependencies beyond Python 3.10+. Clone this repo anywhere:

```sh
git clone https://github.com/<you>/docket.git ~/Development/docket
```

Then create your first checklist:

```sh
mkdir -p ~/.docket/dashboards
cat > ~/.docket/dashboards/my-plan.md <<'EOF'
---
name: My Plan
description: What I'm working on this quarter
project: my-repo
status: active
---

# My Plan

## Phase 1

- [ ] **1. First task**
- [x] **2. Already done** — finished last week
EOF

python3 ~/Development/docket/docket.py
open ~/.docket/dashboards.html
```

## Usage

```sh
python3 ~/Development/docket/docket.py            # regenerate HTML
python3 ~/Development/docket/docket.py --output /tmp/foo.html   # different output
```

Re-run after every edit. Optional file-watcher:

```sh
fswatch -o ~/.docket/dashboards/ | xargs -n1 -I{} python3 ~/Development/docket/docket.py
```

## Format

See [`format.md`](format.md) for the full spec. Quick recap:

- One `.md` file per checklist in `~/.docket/dashboards/`
- YAML frontmatter (`name`, `description`, `project`, `status`) at the top
- H1 → title, H2 → phase (collapsible card), H3/H4 → section
- Tasks are GitHub-style checkboxes: `- [ ] **<id>. <title>** — <optional note>`

An example is in [`examples/example-plan.md`](examples/example-plan.md).

## AI agent integration

docket plays nicely with AI coding agents (Claude Code, Cursor, etc.). Add a rule to your agent config telling it to:

1. Check `~/.docket/dashboards/` for a file matching the current project
2. Tick checkboxes off as work is completed
3. Run `python3 ~/Development/docket/docket.py` after each edit

The provided `agent-rule.md` is a drop-in rule for Claude Code (`~/.claude/rules/docket.md`).

## License

MIT
