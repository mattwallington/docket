---
name: Example — Aurora Migration
description: Aurora 14 → 17 cutover plan (example checklist)
project: my-repo
status: active
---

# Aurora 14 → 17 Migration

## Phase 1 — Prep

### Infrastructure

- [x] **1. Create staging cluster** — done Mar 3
- [x] **2. Snapshot production** — done Mar 3
- [ ] **3. Migrate secrets to new cluster**
  - See `~/docs/secrets.md` for the list
- [ ] **4. DNS cutover plan approved** — blocked on TLS cert provisioning

### Application compatibility

- [x] **5. Verify driver version** — `pg@14.x` works on server 17
- [ ] **6. Run regression tests against PG17 staging**

## Phase 2 — Cutover

- [ ] **7. Schedule maintenance window**
- [ ] **8. Execute cutover** — blocked by 4, 6
- [ ] **9. Post-cutover smoke tests**
