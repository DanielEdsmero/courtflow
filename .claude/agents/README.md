# Project agents

Three subagents live here, one markdown file each. Claude Code picks them up
automatically from `.claude/agents/` — there is nothing to install and nothing to
turn on. Once this directory is committed, anyone who clones the repo gets them.

Invoke one by naming it: *"use research-scout to find out how paddle racks
handle a no-show"*.

## They are a chain, in this order

```
research-scout   →  docs/domain/   →  queue-architect  →  docs/specs/  →  court-builder
  (web research)     (what real         (state machine,     (a spec)      (the actual
                      courts do)         fairness rules)                    code + tests)
```

Each one reads what the previous one wrote, because none of them can see this
conversation. The handoff *is* the files on disk.

**`docs/domain/` and `docs/specs/` do not exist yet.** That is expected — the
agents create them. But it does mean the chain has to be run in order the first
time: `queue-architect` is under instructions to stop and ask for `research-scout`
rather than invent domain facts, and `court-builder` has no spec to build from
until `queue-architect` has written one.

## Why they are split this way

The split is deliberate and worth keeping: the researcher may not design, the
architect may not write code, and the implementer may not redesign the spec. Each
boundary exists because crossing it hides a decision. An implementer who quietly
"fixes" a spec produces a system nobody can reason about, because the written
design and the running code have silently diverged.

## Editing them

The prompt is just the markdown body; the frontmatter sets the name, the
description Claude matches against, and which tools the agent may use. Keep the
tool list tight — `queue-architect` has no `Bash` and no `Edit` precisely so it
cannot start implementing.

Machine-specific settings live in `.claude/settings.local.json`, which is
deliberately not committed.
