![nopus banner showing a speech bubble compressed into one clear word](https://raw.githubusercontent.com/Vistyy/nopus/main/assets/nopus-banner.png)

# nopus

nopus catches coding-agent answers that disappear into abstract LLM babble.
Using deterministic prose checks, it flags responses that cross your chosen complexity threshold and sends them back for one clearer rewrite.

## See it in action

![A real coding-agent response, the prose issues caught by nopus, and the clearer rewrite](https://raw.githubusercontent.com/Vistyy/nopus/main/assets/nopus-rewrite-example.png)

Currently supported: Pi, Claude Code, Codex

## How it works

nopus does not ban long answers or unusual words.
It looks for difficulty that accumulates across a response.

| nopus notices | What it can look like |
|---|---|
| Unnecessarily uncommon wording | “commence utilization” when “start using” means the same thing |
| Sustained abstract phrasing | Several sentences about “capability alignment” without saying who does what |
| Dense phrase stacks | “repository state mutation verification strategy” instead of “how we verify repository changes” |
| Formulaic framing | “Here’s where it gets interesting” before the actual point |

A single unusual word, dense phrase, or style cue does not normally trigger a rewrite.
nopus combines independent signals and checks whether the difficulty continues through the response.

Necessary technical terms, commands, identifiers, conditions, and qualifications stay intact.
`InteractiveSessionHost` stays `InteractiveSessionHost`; nopus targets the difficult prose around it.
Established computing terms receive less weight, and response length is not itself a failure.

When nopus requests a rewrite, the host displays this message:

```text
nopus requested a clearer rewrite.
```

### What the agent receives

With rewrite evidence enabled, nopus sends focused guidance and up to three examples from the response:

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

<details>
<summary>Show the same request with rewrite evidence disabled</summary>

```text
Rewrite the response for clarity and directness.
Keep its meaning and necessary detail.
Return only the revised response.

Focus on these areas:
- Replace formulaic framing with plain statements.
```

</details>

Sensitivity changes which responses receive this instruction.
It does not ask the agent to make a low, medium, or high rewrite.
The detected problems determine the focus areas, while the evidence setting controls whether excerpts appear.

nopus allows at most one automatic rewrite, so it cannot create a retry loop.

## Choose how sensitive it should be

The default is `medium`.

| Sensitivity | Behavior |
|---|---|
| `low` | Rewrites only the strongest cases. |
| `medium` | Rewrites sustained or compounded difficulty. |
| `high` | Also rewrites borderline cases and consistently prefers plain language. |

All three settings preserve necessary technical detail.

## Use nopus

nopus requires Node.js 22 or later on `PATH`.

<details>
<summary>Pi</summary>

Install nopus from npm:

```sh
pi install npm:nopus
```

You can install the GitHub repository instead:

```sh
pi install git:github.com/Vistyy/nopus
```

Start Pi normally after installation.
The extension checks each completed response.
Use these commands while working:

```text
/nopus status
/nopus check
/nopus rewrite
/nopus on
/nopus off
/nopus low
/nopus medium
/nopus high
/nopus evidence off
```

</details>

<details>
<summary>Claude Code</summary>

Add the marketplace from GitHub and install the plugin:

```text
/plugin marketplace add Vistyy/nopus
/plugin install nopus@vistyy
```

The plugin uses a Stop hook to request one clearer response.
Claude Code prompts for the native settings when it enables the plugin.
The identifier follows the `plugin@marketplace` format, so this plugin is `nopus@vistyy`.

To change the settings later, use the configuration skill:

```text
/nopus:nopus-configure medium
/nopus:nopus-configure evidence off
```

</details>

<details>
<summary>Codex</summary>

The Codex plugin uses the same bounded Stop hook.
Configure it through the bundled skill:

```text
$nopus-configure medium
$nopus-configure evidence off
```

</details>

<details>
<summary>Configuration file and environment variables</summary>

The configuration skill writes `$XDG_CONFIG_HOME/nopus/config.json`, or the platform user-configuration equivalent.

```json
{
  "complexitySensitivity": "medium",
  "includeEvidence": true
}
```

Rewrite evidence is enabled by default.
`NOPUS_COMPLEXITY_SENSITIVITY` and `NOPUS_INCLUDE_EVIDENCE` override native and file configuration for automation.

</details>

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
