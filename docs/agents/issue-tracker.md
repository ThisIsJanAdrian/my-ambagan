# Issue tracker: local markdown

Issues and specs for this repo live as markdown files in `.scratch/issues/`. No external tooling (`gh`) is needed; use the file tools and `git` only.

## File format

One issue per file, named `NNN-short-slug.md` (zero-padded, e.g. `001-add-expense-form.md`). The number is the issue's id: the next one is the highest existing number + 1. Refer to issues as `#NNN`.

```markdown
---
title: Add expense form
status: open        # open | closed
labels: [needs-triage]
assignee:           # empty when unclaimed
parent:             # issue number this is a sub-issue of, if any
blocked_by: []      # issue numbers, e.g. [2, 5]
---

Body of the issue.

## Comments

### 2026-11-12: <author>
Comment text.
```

## Conventions

- **Create an issue**: write a new `.scratch/issues/NNN-slug.md` with the frontmatter above and `status: open`.
- **Read an issue**: read the file. Find it by number with a glob on `.scratch/issues/NNN-*.md`.
- **List issues**: glob `.scratch/issues/*.md` and read the frontmatter; filter on `status` and `labels` as needed.
- **Make an issue a sub-issue**: set `parent: <number>` in the child's frontmatter.
- **Comment on an issue**: append a `### <date>: <author>` entry under `## Comments` (create the section if missing).
- **Apply / remove labels**: edit the `labels` list in the frontmatter.
- **Close**: set `status: closed`, and add a closing comment if one is useful.

## When a skill says "publish to the issue tracker"

Create a new issue file as above.

## When a skill says "fetch the relevant ticket"

Read the issue file as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: an issue with `parent: <map number>`. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, `assignee` is set to the driving dev.
- **Blocking**: the child's `blocked_by` list. A ticket is unblocked when every listed issue has `status: closed`.
- **Frontier query**: list the map's open children (`parent: <map>`, `status: open`), drop any with an open blocker or a non-empty `assignee`; lowest number wins.
- **Claim**: set `assignee` in the frontmatter, the session's first write.
- **Resolve**: add the answer as a comment, set `status: closed`, then append a pointer to the issue file in the map's Decisions-so-far.

## Pull requests

Not used as a triage surface.
