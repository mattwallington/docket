# docket — format spec

Each checklist is a standard markdown file with a small YAML frontmatter block at the top, stored in a configured root. The default root is `~/.docket/projects/`; additional roots can be added in Preferences.

## Architecture

```
~/.docket/
├── docket.json                       # user config (roots, theme)
├── state.json                        # recents, per-file view overrides
└── projects/                         # default root; drop .md files here
```

Docket is a native macOS Electron app — it watches each configured root live, so any edit in your editor shows up instantly.

## Frontmatter

```markdown
---
name: My Rollout
description: One-line summary shown in the sidebar.
project: my-repo
status: active
---
```

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | yes | Display name in the sidebar and panel header. Falls back to the H1 if missing. |
| `description` | no | One-line summary shown under the name in the sidebar. |
| `project` | no | Which repo/project this checklist belongs to. Shown in sidebar. Useful when running many checklists. |
| `status` | no | `active` (default) or `archived`. Archived items are de-emphasized in the sidebar. |

Values must fit on one line (no multi-line YAML).

## H1 — title

The first `# Heading` after the frontmatter is the page title. If `name:` isn't set, this is the sidebar label too.

## H2 — phases (collapsible cards)

Each `## <name>` creates a phase card. Any wording works — "Phase 1 — X", "Milestone 2", "Round A".

```markdown
## Phase 1 — Infrastructure
```

## H3/H4/H5 — sections (labels within a phase)

Sub-headings become section labels. Useful for grouping related tasks.

```markdown
### Signup flows

#### B2B customer invite
```

## Tasks (GitHub-style checkboxes)

```markdown
- [ ] **4a. Existing provider + B2B invite (legacy format)**
- [x] **5a. Both roles + B2B invite (legacy format)** — passed Apr 20
```

The parser extracts:
- **Status** from `[x]` vs `[ ]`
- **Title** from the bolded portion
- **Note** from anything after the closing `**`

## Status rules

- `[x]` → rendered green as **Done**
- `[ ]` → rendered amber as **Pending**
- `[ ]` becomes **Blocked** (grey) if:
  - The note contains "blocked" (case-insensitive)
  - The note contains "E2E pending" (convention for "plumbing verified, waiting on downstream work")
  - The enclosing section name contains "blocked"

## Task details (optional)

Indented bullets below a task are valid markdown and ignored by the viewer (they're for humans reading the source).

```markdown
- [ ] **4a. Existing provider + B2B invite (legacy format)**
  - URL: `?invitation_token=<UUID>`
  - Expected: sign-in → ActivateRolePage → `POST /add-role`
  - Verify: `custom:customer_uuid` added
```

## Minimal working example

See [`examples/example-plan.md`](examples/example-plan.md).

## Design choices

**Why auto-detect checklist vs markdown?** A file with the frontmatter fields above (or any `- [ ]` task) renders as a checklist; everything else is plain markdown. One app, two modes, zero configuration.

**Why one viewer for all docs?** Sidebar covers every configured root. Recents + search + browse tree make any file reachable in a keystroke or two.

**Why GitHub-compatible checkbox syntax?** The markdown has to remain readable as a normal doc.
