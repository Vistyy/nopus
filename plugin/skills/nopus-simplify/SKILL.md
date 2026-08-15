---
name: nopus-simplify
description: Rewrite the immediately preceding assistant response with clearer and more direct prose when the user invokes this skill.
disable-model-invocation: true
---

# Simplify the previous response

Rewrite your immediately preceding completed response.
If there is no preceding completed response, ask the user which text to rewrite.

Preserve its meaning and necessary detail.
Preserve technical terms, identifiers, commands, paths, errors, quotations, constraints, conditions, causes, contrasts, and consequences.
Do not shorten or summarize content when doing so would remove necessary information.

Use concrete subjects and actions where possible.
Prefer familiar words when they are equally precise.
Unpack dense phrases.
Replace formulaic framing and filler with plain statements.

Return only the revised response.
