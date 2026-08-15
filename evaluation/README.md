# Portable analyzer evaluation

## Hypothesis

`wink-nlp` and `wink-eng-lite-web-model` can replace NLTK for the prose measurements without materially changing which responses receive a rewrite.

The earlier Python experiment's 300-response analysis is the baseline.
The parity comparison reuses its response text and the original three retry branches.
This isolates measurement changes from later production policy changes.
It measures lexical rarity from the packaged frequency and technical-term datasets.
It replaces sentence detection, part-of-speech tagging, and lemmatization with winkNLP.
The output also reports the current production low-sensitivity decisions separately.

## Run

```sh
pnpm evaluate:parity
```

Use `--baseline`, `--concreteness`, `--output`, and `--report` to override the private evaluation paths.
The default machine-readable output is `tmp/wink-parity.json`.
The default human review report is `tmp/wink-parity-changes.md`.
Neither file is committed.

## Result

The run on 2026-08-14 produced these observations:

- It analyzed 300 responses.
- Retry decisions agreed for 274 responses, or 91.3%.
- The Python baseline flagged 61 responses.
- With the unchanged policy, the portable measurements flagged 59 responses.
- Measurement changes added 12 flags and removed 14 flags.
- After human calibration, the production low-sensitivity policy flagged 20 responses (6.7%).
- On the same sample, medium flagged 68 responses (22.7%), and high flagged 108 (36.0%).
- The mean absolute uncommon-word ratio difference was 1.02 percentage points.
- The mean absolute abstract-word ratio difference was 0.88 percentage points.
- The mean absolute eligible-sentence count difference was 1.02 sentences.
- The mean absolute high-abstractness-sentence count difference was 0.54 sentences.
- The mean absolute noun-stack count difference was 0.69 stacks.

## Human calibration

The human review covered the union of 31 parity and production disagreements plus eight style-cue and control examples.
The reviewer accepted 30 disagreement responses and marked `452d7bc4` for rewrite.
They marked the five two-cue examples and the uncommon single-cue `load-bearing` example for rewrite.
They were uncertain about the literal `lean into` control and marked the direct cache-control example for rewrite.

The calibrated low profile requires phrase-load evidence for sustained abstractness and stronger response-level abstractness for combined and concentrated complexity.
Two distinct style cues are sufficient by themselves.
One style cue requires supporting uncommon-word evidence.
The policy matches 36 of the 38 certain labels with no false-positive labels.
It does not yet catch `452d7bc4` or the direct cache-control example because each would require a new behavior inferred from one example.

## Private Pi response corpus

The larger evaluation reads only completed assistant responses from Pi version 3 session files.
It excludes user messages, tool calls, tool results, incomplete assistant turns, mock providers, Nopus rewrite descendants, empty responses, and exact duplicate responses.
It does not copy raw session paths or message identifiers into the corpus.
It uses keyed identifiers so private provenance cannot be recovered from committed artifacts.

The default private corpus directory is `$XDG_STATE_HOME/nopus/evaluation/pi-corpus/v1`, with `~/.local/state` as the fallback state directory.
The directory uses mode `0700`, and private artifacts use mode `0600`.
Nothing under that directory is part of this repository.

Run the complete extraction, baseline, stratified sampling, and verification workflow with this command:

```sh
pnpm evaluate:pi-corpus build
```

The extractor hashes an immutable view of each input file and rejects a file that changes while it is hashed or parsed.
The baseline freezes analyzer measurements and low, medium, and high policy decisions for every eligible response.
The verification report distinguishes analyzer drift, policy drift on frozen measurements, and end-to-end drift.
It also checks that profile decisions remain monotonic.

The run on 2026-08-14 extracted 5,337 unique completed assistant responses from 515 session files.
The calibrated policy produces 4,342 `AAA`, 464 `AAR`, 247 `ARR`, and 284 `RRR` decisions, where `A` means accept and `R` means rewrite from low through high sensitivity.

## Stratified human calibration

The deterministic sample contains 160 responses, with 40 from each current decision band.
It reserves 40 responses as a holdout and exposes 120 responses for calibration.
The sample also covers response-length bands and limits repeated responses from one source session when the available corpus permits it.
A normal rebuild preserves the frozen sample and its calibration/holdout roles.
Before any labels exist, `pnpm evaluate:pi-corpus sample -- --force` explicitly replaces the sample.
After labels exist, the tool rejects sample replacement.
Each imported label carries the frozen sample identifier.

Human calibration starts with one fixed question: whether medium sensitivity should rewrite the response.
A reviewer chooses `accept`, `rewrite`, or `uncertain`.
This anchor makes each decision concrete instead of asking the reviewer to place all three profile boundaries at once.
Later refinement batches split medium accepts into `high` or `none` and medium rewrites into `low` or `medium`.
Those refinements produce the final ordinal label without assuming information that the medium decision does not provide.

Each final ordinal label records the first profile at which a rewrite is appropriate:

- `low` means rewrite at low, medium, and high.
- `medium` means accept at low and rewrite at medium and high.
- `high` means rewrite only at high.
- `none` means accept at every profile.
- `uncertain` excludes the response from hard scoring.

The review artifact hides model identity, measurements, signals, and current policy decisions.
Generate a medium-anchor review batch with this command:

```sh
pnpm evaluate:pi-review -- --limit 30
```

The review page is written to the private corpus directory with mode `0600` and does not load third-party scripts or styles.
It can queue labels through Lavish and can download the same labels as JSON Lines before the browser closes.
Import accepted medium-anchor labels with `pnpm evaluate:pi-corpus medium-anchor-labels -- --input PATH`.
They remain private in `medium-anchor-labels.jsonl`.
Store final ordinal labels only in the private corpus as `labels.jsonl`.
Do not inspect holdout labels while tuning the policy.

The first medium-anchor batch on 2026-08-15 contained 30 stratified calibration responses.
A second batch contained 20 responses selected near the medium boundary instead of requiring review of the other 90 calibration responses.
Across both batches, the reviewer accepted 36 and selected rewrite for 14, with no uncertain labels.
After calibration, the medium policy agrees on 41 responses, incorrectly rewrites 5 accepted responses, and misses 4 rewrite responses.
The boundary-focused batch is intentionally not a representative population sample.
The medium policy rewrites 531 of the 5,337 corpus responses, or 9.9%.
High sensitivity requires modest phrase-load evidence for sustained abstractness after review showed that abstract but organized technical responses triggered too readily.
The high policy rewrites 995 corpus responses, or 18.6%.
These anchor labels remain private and do not yet imply final ordinal labels.

## Privacy filtering

OpenAI Privacy Filter is an optional local preprocessing layer for reviewable response text.
It does not receive user messages because the extractor does not collect them.
The filter output remains private and is not an anonymization guarantee.

Create the 160-response private filter input with this command:

```sh
pnpm evaluate:pi-corpus privacy-input -- --role all
```

Run the filter with the Python environment that contains the official `opf` package:

```sh
python evaluation/privacy-filter-corpus.py \
  --input ~/.local/state/nopus/evaluation/pi-corpus/v1/privacy-input-all.jsonl \
  --output ~/.local/state/nopus/evaluation/pi-corpus/v1/sanitized-review.jsonl
```

The filter process loads the model once, supports restart from its private partial output, and never persists detected source spans separately.
It also masks the local home directory, local username, and IPv4-shaped strings.
A warning or processing error marks that response for review.

The public regression fixture contains frozen scalar measurements without response text or provenance.
After review, regeneration adds the ordinal human labels without notes or private identifiers.
Regenerate it after an approved baseline or label change with this command:

```sh
pnpm evaluate:pi-corpus export-fixture
```

The fixture exercises more than 5,000 real-response policy inputs in the normal test suite.
The private corpus remains the authority for analyzer and end-to-end drift because the public fixture contains no source text.
Any future public text fixture requires separate human review after local filtering.

## Conclusion

The result supports continuing with winkNLP because its measurement changes are bounded and the production policy has now been calibrated directly rather than optimized for NLTK decision parity.
Low sensitivity is intentionally conservative after review.
The private Pi corpus now supplies profile-wide calibration and regression machinery without placing session text in the repository.
Exact NLTK parity is not required if the production policy proves useful without becoming annoying during dogfooding.
