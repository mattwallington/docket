# docket — format spec

Each checklist is a standard markdown file with a small YAML frontmatter block at the top, stored in `~/.docket/dashboards/`.

## Architecture

```
~/.docket/
├── dashboards/                        # one .md per checklist
│   ├── my-rollout.md
│   └── my-migration.md
└── dashboards.html                    # generated viewer

<docket repo>/
├── docket.py                          # generator
└── format.md                          # this file
```

Run `python3 <docket repo>/docket.py` to regenerate the viewer.

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
- [x] **5a. Both roles + B2B invite (legacy format)** — passed Apr 20 (matt+patient2)
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
  - URL: `?invitation_token=<UUID>` using `matt+provider1@reperiohealth.com`
  - Expected: sign-in → ActivateRolePage → `POST /add-role`
  - Verify: `custom:customer_uuid` added
```

## Minimal working example

See [`examples/example-plan.md`](examples/example-plan.md).

## Design choices

**Why static HTML, not a web service?** No backend, no auth, works offline via `file://`. Only state is the markdown files.

**Why one viewer for all dashboards?** So many concurrent checklists (one per project, one per major initiative) live in one tab. Sidebar picker, per-dashboard collapsed state.

**Why regenerate on demand?** `file://` URLs can't fetch other files due to Chrome's security model. Inline HTML sidesteps it entirely.

**Why strip detail bullets from the viewer?** The viewer is "what's done" at a glance. Detail stays in the markdown for anyone running the task.

**Why GitHub-compatible checkbox syntax?** The markdown has to remain readable as a normal doc.
