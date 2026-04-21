# docket — agent rule (drop-in for Claude Code)

Copy this file to `~/.claude/rules/docket.md` (or your agent's equivalent rules directory) so any coding session automatically keeps the relevant checklist up to date.

---

# docket awareness

The user maintains a live HTML viewer at `file://~/.docket/dashboards.html` that aggregates multiple project checklists. Each checklist is a markdown file in `~/.docket/dashboards/`.

## When working on a task that has a checklist

1. **Check first**: `ls ~/.docket/dashboards/` to see if the current project has a checklist
2. **Match by `project:` frontmatter**: open each `.md` and look at the frontmatter — if `project:` matches the current repo (e.g. `reperio-telehealth`), that's the relevant checklist
3. **Update tasks as progress happens**: tick `[ ]` → `[x]`, add status notes after the em-dash (e.g. `— passed Apr 20`)
4. **Regenerate the HTML** after any edit:
   ```bash
   python3 ~/Development/docket/docket.py
   ```

## Format

See `~/Development/docket/format.md` for the full spec. Quick recap:

- Frontmatter at top: `name`, `description`, `project`, `status`
- H1 → title
- H2 → phase (collapsible card)
- H3/H4 → section
- Tasks: `- [ ] **<id>. <title>**` or `- [x] **<id>. <title>** — <note>`
- Blocked: pending tasks with "blocked" in the note render differently

## When to create a new checklist

If the user starts a new multi-phase rollout, migration, test matrix, or any effort with 20+ discrete items that will span multiple sessions:

- Propose creating `~/.docket/dashboards/<slug>.md`
- Include frontmatter with `project:` set to the current repo name
- Run the generator to register it in the viewer

Don't create checklists for small tasks — they'd clutter the viewer. Use them for sustained work.

## Don't

- Don't write checklists outside `~/.docket/dashboards/` — the viewer only reads from that directory
- Don't use non-GitHub checkbox syntax — the parser expects `- [ ]` / `- [x]`
- Don't put multi-line values in frontmatter — the parser is one-line-per-field
