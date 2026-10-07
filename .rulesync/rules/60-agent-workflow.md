---
root: false
targets: ['*']
description: 'Issue tracking, triage labels, and domain documentation for agents'
---

# Agent workflow

## Issue tracker

Issues and PRDs live as GitHub issues in `rzru/nightingale`, reached through the
`gh` CLI. See `docs/agents/issue-tracker.md` for the query and authoring
conventions.

## Triage labels

Five canonical triage roles, with default label strings `needs-triage`,
`needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See
`docs/agents/triage-labels.md` for what each role means and when to move an
issue between them.

## Domain docs

Domain knowledge is kept in a single context: `CONTEXT.md` plus the decision
records under `docs/adr/`, both at the repository root. Record a new ADR when a
decision constrains future work rather than describing current behavior. See
`docs/agents/domain.md`.
