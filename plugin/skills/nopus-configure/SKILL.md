---
name: nopus-configure
description: Configure nopus complexity sensitivity, extra-simple rewrites, rewrite evidence, and Pi response hiding for this user.
disable-model-invocation: true
allowed-tools: Bash
---

# Configure nopus

Use `low`, `medium`, or `high` to change complexity sensitivity.
Use `evidence on` or `evidence off` to control whether rewrite requests include examples from the response.
Use `extra-simple on` or `extra-simple off` to control whether nopus requests a short initial answer that keeps the conclusion, immediate action, and conditions that could change that action while leaving supporting detail for follow-up.
Use `hide-original on` or `hide-original off` to control whether Pi hides a rejected response before it displays the rewrite.
This setting affects Pi only.
Ask the user to select a supported value when the argument is absent or invalid.

Resolve `../../dist/configure.mjs` relative to this `SKILL.md` file.
Run the applicable command:

```sh
node <resolved-configure-path> <low|medium|high>
node <resolved-configure-path> evidence <on|off>
node <resolved-configure-path> extra-simple <on|off>
node <resolved-configure-path> hide-original <on|off>
```

Report the setting and configuration path printed by the command.
Do not edit host configuration files.
