![nopus banner showing a speech bubble compressed into one clear word](https://raw.githubusercontent.com/Vistyy/nopus/main/assets/nopus-banner.png)

# nopus

[![npm version](https://img.shields.io/npm/v/%40syzom%2Fnopus)](https://www.npmjs.com/package/@syzom/nopus)
[![Node.js version](https://img.shields.io/node/v/%40syzom%2Fnopus)](package.json)
[![MIT license](https://img.shields.io/npm/l/%40syzom%2Fnopus)](LICENSE)

nopus catches coding-agent answers that disappear into abstract LLM babble.
Using deterministic prose checks, it flags responses that cross your chosen complexity threshold and sends them back for one clearer rewrite.

## See it in action

![A real coding-agent response, the prose issues caught by nopus, and the clearer rewrite](https://raw.githubusercontent.com/Vistyy/nopus/main/assets/nopus-rewrite-example.png)

Currently supported: Pi, Claude Code, Codex

## Use nopus

To use nopus, install Node.js 22 or newer and make sure the `node` command is available.

<details>
<summary>Pi</summary>

Install nopus from npm:

```sh
pi install npm:@syzom/nopus
```

You can install the GitHub repository instead:

```sh
pi install git:github.com/Vistyy/nopus
```

Start Pi normally after installation.
The extension checks each completed response.
When it requests a rewrite, it hides the rejected response from the terminal transcript by default.
The response remains in the Pi session and model history.
Because nopus evaluates completed responses, the response remains visible while it streams and disappears only after nopus requests a rewrite.
Use these commands while working:

```text
/nopus status
/nopus check
/nopus on
/nopus off
/nopus hide-original on
/nopus hide-original off
```

</details>

<details>
<summary>Claude Code</summary>

Add the marketplace from GitHub and install the plugin:

```text
/plugin marketplace add Vistyy/nopus
/plugin install nopus@nopus
```

The plugin uses a Stop hook to request one clearer response.
The identifier follows the `plugin@marketplace` format, so this plugin is `nopus@nopus`.

</details>

<details>
<summary>Codex</summary>

Add the marketplace from GitHub and install the plugin:

```sh
codex plugin marketplace add Vistyy/nopus
codex plugin add nopus@nopus
```

Start a new Codex session after installation so the plugin and its skills load.
The Codex plugin uses the same bounded Stop hook.
The identifier follows the `plugin@marketplace` format, so this plugin is `nopus@nopus`.

</details>

## How it works

nopus examines the prose when a coding agent completes a response.
Its measurements are deterministic, so the same prose and sensitivity produce the same decision.
It measures these characteristics:

- **Uncommon wording** - Words that are rare in ordinary conversation.
  - *Example:* “Commence the task” instead of “Start the task.”
- **Very uncommon wording** - Words that are rare in both conversation and broad written English.
  - *Example:* “Ameliorate the problem” instead of “Fix the problem.”
- **Abstract vocabulary** - Concepts and qualities used without concrete people, objects, or actions.
  - *Example:* “capability, strategy, governance, and ownership.”
- **Abstract sentences** - Abstract wording that fills one sentence and continues across several sentences.
  - *Example:* “The strategy establishes capability ownership through governance transformation.”
- **Noun and modifier stacks** - Three or more nouns or modifiers compressed into one phrase.
  - *Example:* “repository state mutation verification strategy.”
- **Phrase load** - Dense phrases that appear frequently for the amount of prose.
  - *Example:* A short answer containing both “deployment policy validation process” and “repository state mutation strategy.”
- **Formulaic style cues** - Literal phrases that add inflated framing or filler.
  - *Example:* “Here’s where it gets interesting.”

Word rarity comes from packaged conversational and broad-web frequency data.
Abstractness comes from human-rated word concreteness, and technical exceptions come from a packaged computing glossary.
The style matcher uses only a small allowlist of literal cues rather than trying to classify arbitrary writing habits.

nopus then looks for combinations that make a response materially harder to read.
For example, uncommon words become more significant when they appear with sustained abstraction and dense phrase stacks.
Several abstract sentences become more significant when loaded phrases recur throughout them.

### How nopus avoids unnecessary rewrites

- It removes code blocks, inline code, URLs, file paths, and table rows before measuring prose.
- It excludes obvious identifiers and reduces the weight of established computing terms.
- It uses proportions and phrase density, so a long response is not penalized merely for being long.
- Most decision paths require several measurements to cross their thresholds together.
- A single rare word or dense phrase does not normally trigger a rewrite.
- Style cues require either two distinct cues or one cue supported by enough uncommon wording.
- It requests at most one automatic rewrite, so it cannot create a retry loop.

Necessary technical terms, commands, identifiers, conditions, and qualifications remain part of the requested answer.
`InteractiveSessionHost` stays `InteractiveSessionHost`; nopus targets the difficult prose around it.

When nopus requests a rewrite, the host displays this message:

```text
nopus requested a clearer rewrite.
```

### What the agent receives

For the response used in the example below, the default rewrite request gives the agent focused guidance and examples from its own response:

```text
Rewrite the response for clarity and directness.
Keep its meaning and necessary detail.
Return only the revised response.

Focus on these areas:
- Replace formulaic framing with plain statements.

Examples from the response:
- "here's where it gets interesting": lecture-hall framing.
- "paradigm shift": tired.
```

Turning rewrite evidence off removes the `Examples from the response` block.
The agent still receives the rewrite instructions and focus areas.

## Choose how sensitive it should be

Sensitivity controls how often nopus intervenes, and the default is `medium`.

| Sensitivity | What to expect | Observed rewrite rate | Best fit |
|---|---|---:|---|
| `low` | Uses the strictest thresholds to target clear cases where abstraction, uncommon wording, or dense phrasing accumulates strongly. | 5.3% | You want intervention only for the most difficult responses. |
| `medium` | Catches difficulty sustained across several sentences or supported by multiple characteristics without treating isolated wording as a problem. | 9.9% | You want a balanced default for regular use. |
| `high` | Uses lower thresholds so shorter runs of abstraction and borderline combinations can request a rewrite sooner. | 18.6% | You consistently prefer plain language and accept more interventions. |

The [observed rates](evaluation/README.md) come from 5,337 completed Pi responses and provide only a rough comparison because results vary by agent and task.

## Configure automatic rewrites

`nopus-configure` changes the settings used by the automatic integrations.
It does not rewrite a response.

| Action | Pi | Claude Code | Codex |
|---|---|---|---|
| Set medium sensitivity | `/skill:nopus-configure medium` | `/nopus:nopus-configure medium` | `$nopus-configure medium` |
| Disable rewrite evidence | `/skill:nopus-configure evidence off` | `/nopus:nopus-configure evidence off` | `$nopus-configure evidence off` |
| Show rejected Pi responses | `/skill:nopus-configure hide-original off` | - | - |

<details>
<summary>Configuration file and environment variables</summary>

The configuration skill writes `$XDG_CONFIG_HOME/nopus/config.json`, or the platform user-configuration equivalent.

```json
{
  "complexitySensitivity": "medium",
  "includeEvidence": true,
  "pi": {
    "hideOriginalResponse": true
  }
}
```

Rewrite evidence and Pi response hiding are enabled by default.
`NOPUS_COMPLEXITY_SENSITIVITY`, `NOPUS_INCLUDE_EVIDENCE`, and `NOPUS_PI_HIDE_ORIGINAL_RESPONSE` override the configuration file for automation.

</details>

## Simplify a response manually

`nopus-simplify` is the manual counterpart to the automatic rewrite.
Use it when nopus does not trigger but you still find the preceding response too complex.
Invoking the skill requests a rewrite immediately instead of applying the selected sensitivity threshold.
It uses the same clarity goals as the automatic rewrite and preserves meaning, necessary detail, technical terms, commands, identifiers, conditions, and qualifications.
It does not change nopus configuration.

| Pi | Claude Code | Codex |
|---|---|---|
| `/skill:nopus-simplify` | `/nopus:nopus-simplify` | `$nopus-simplify` |

## Development

Install dependencies and run all checks:

```sh
pnpm install
pnpm check
```

Update the normalized datasets from their checksum-pinned upstream sources:

```sh
pnpm import:data
```

See [`evaluation/README.md`](evaluation/README.md) for the private-corpus calibration and regression workflow.
Normal analysis and verification do not download runtime data.

<details>
<summary>Data sources and attribution</summary>

nopus retains normalized JSON rather than the original upstream formats.
The SHA-256 values below identify the exact upstream copies used to produce the normalized datasets.

### Claudisms

`data/ai-style-cues.json` is derived from <https://claudisms.ai/claudisms.md>.
The source describes itself as a living list of AI-writing habits that is free to copy and adapt.
The copy was retrieved on 2026-08-14 and has SHA-256 `f4a09fa849b61712838d3e56c854ddf37a59417823acb348a330721615f73b2b`.

### SUBTLEX-US word frequencies

`data/conversational-word-frequencies.json` is derived from `subtlex-word-frequencies@2.0.0`, available at <https://github.com/words/subtlex-word-frequencies>.
The package derives its data from SUBTLEX-US by Marc Brysbaert and Boris New.
The source paper is “Moving beyond Kučera and Francis: A Critical Evaluation of Current Word Frequency Norms and the Introduction of a New and Improved Word Frequency Measure for American English,” DOI <https://doi.org/10.3758/BRM.41.4.977>.
The source copy has SHA-256 `271c5a5fbf332f60762cfa34b11394427c220099d96c589751b6bc77e5b32c1a`.
The npm package declares the ISC license, which is preserved at `data/licenses/conversational-word-frequencies-ISC.txt`.

### Norvig web word counts

`data/broad-web-word-counts.json` is derived from <https://norvig.com/ngrams/count_1w.txt>.
Peter Norvig publishes the file as part of the data described at <https://norvig.com/ngrams/>.
The counts derive from the Google Web Trillion Word Corpus described by Thorsten Brants and Alex Franz and distributed by the Linguistic Data Consortium.
The source copy has SHA-256 `51df159fd3de12b20e403c108f526e96dbd723d9cabdd5f17955cdc16059e690`.

### Brysbaert concreteness ratings

`data/concreteness-ratings.json` is derived from the ArtsEngine mirror at <https://github.com/ArtsEngine/concreteness>.
The data accompanies Marc Brysbaert, Amy Beth Warriner, and Victor Kuperman, “Concreteness ratings for 40 thousand generally known English word lemmas,” DOI <https://doi.org/10.3758/s13428-013-0403-5>.
The source copy has SHA-256 `0b4082dbd38585b0ee1fd258145b7a50592f8d0d98e5fc6b6844ceef3cd8ecc8`.

### Carpentries Glosario

`data/technical-terms.json` is derived from The Carpentries `glosario` repository at revision `a4a774b6dea3881a7794d63aee10fbb5d34321d1`.
The source repository is <https://github.com/carpentries/glosario>, and its archived releases are available under DOI <https://doi.org/10.5281/zenodo.13589476>.
The source copy has SHA-256 `93a6371add7275d643cacb060ae0b65749d1ffdff329064feeaeaf7152c3715f`.
The data is licensed under Creative Commons Attribution 4.0 International, and the license is preserved at `data/licenses/computing-glossary-CC-BY-4.0.md`.
The Carpentries does not endorse nopus.

</details>
