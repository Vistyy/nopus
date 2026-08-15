---
name: nopus-configure
description: Configure nopus complexity sensitivity and rewrite evidence for this user.
disable-model-invocation: true
allowed-tools: Bash
---

# Configure nopus

Use `low`, `medium`, or `high` to change complexity sensitivity.
Use `evidence on` or `evidence off` to control whether rewrite requests include examples from the response.
Ask the user to select a supported value when the argument is absent or invalid.

Resolve `../../dist/configure.mjs` relative to this `SKILL.md` file.
Run the applicable command:

```sh
node <resolved-configure-path> <low|medium|high>
node <resolved-configure-path> evidence <on|off>
```

Report the setting and configuration path printed by the command.
Do not edit host configuration files.
