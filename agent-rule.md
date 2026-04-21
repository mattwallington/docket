# docket — agent rule

Copy this file to `~/.claude/rules/docket.md` (or your agent's rules directory) so coding sessions automatically keep the relevant checklist up to date.

## docket awareness

docket is a native macOS app that browses markdown files. The default root is `~/.docket/projects/`, but the user can add more roots via Preferences (⌘,). Any checklist-shaped markdown file the agent works with probably lives in one of those roots or in a repo the user is working on.

## When working on a task that has a checklist

1. **Find it**: look for a markdown file with frontmatter (`name:`, `status:`, `project:` or `repo:`) and H2 phases containing `- [ ]` tasks. Common locations:
   - `~/.docket/projects/` — the default docket root
   - The repo's `docs/` or top level
2. **Match by `project:` or `repo:` frontmatter** — if it matches the current repo name, that's the relevant checklist.
3. **Update tasks as progress happens**: tick `[ ]` → `[x]`, add status notes after an em-dash (e.g. `— passed Apr 20`).
4. **No regeneration step**: docket live-refreshes. Just save the markdown file; the open viewer picks it up.

## Format

See `format.md` in this repo for the full checklist spec. Quick recap:

- Frontmatter at top: `name`, `description`, `project`/`repo`, `status`
- H1 → title
- H2 → phase (collapsible card)
- H3/H4 → section
- Tasks: `- [ ] **<id>. <title>**` or `- [x] **<id>. <title>** — <note>`
- Blocked: pending tasks with "blocked" in the note render differently

## When to create a new checklist

If the user starts a new multi-phase rollout, migration, test matrix, or any effort with 20+ discrete items that will span multiple sessions:

- Propose creating the file under `~/.docket/projects/<slug>.md` or in the repo's docs folder (which may be a docket root)
- Include frontmatter with `project:` (or `repo:`) set to the current repo name

Don't create checklists for small tasks — they'd clutter the sidebar. Use them for sustained work.

## Don't

- Don't use non-GitHub checkbox syntax — the parser expects `- [ ]` / `- [x]`
- Don't put multi-line values in frontmatter — the parser is one-line-per-field
