# Evaluation

This directory contains the private-corpus evaluation workflow for nopus.
It supports policy calibration, regression checks, and human review without committing private response text or provenance.

## Current evidence

The 2026-08-14 corpus contains 5,337 unique completed Pi assistant responses from 515 session files.
The current policy rewrites 284 responses at low sensitivity, 531 at medium sensitivity, and 995 at high sensitivity.
These totals are 5.3%, 9.9%, and 18.6% of the corpus.

The reviewed medium-sensitivity batches contain 50 labels.
The policy agrees with 41 labels, incorrectly rewrites 5 accepted responses, and misses 4 responses marked for rewrite.
The second batch focused on the medium boundary, so these labels are not a representative population sample.

## Private corpus

The extractor reads only completed assistant responses from Pi version 3 session files.
It excludes user messages, tool calls, tool results, incomplete assistant turns, mock providers, nopus rewrite descendants, empty responses, and exact duplicates.
It uses keyed identifiers and does not copy session paths or message identifiers into the corpus.

The default private corpus directory is `$XDG_STATE_HOME/nopus/evaluation/pi-corpus/v1`.
The fallback is `~/.local/state/nopus/evaluation/pi-corpus/v1`.
The directory uses mode `0700`, and private artifacts use mode `0600`.
Nothing in that directory belongs in this repository.

Build, score, sample, and verify the corpus with this command:

```sh
pnpm evaluate:pi-corpus build
```

Run verification separately with this command:

```sh
pnpm evaluate:pi-corpus verify
```

Verification distinguishes analyzer drift, policy drift on frozen measurements, and end-to-end drift.
It also checks that decisions remain monotonic from low through high sensitivity.

## Human review

Generate a private medium-anchor review page with this command:

```sh
pnpm evaluate:pi-review -- --limit 30
```

Reviewers label whether medium sensitivity should `accept`, `rewrite`, or remain `uncertain`.
The page hides model identity, analyzer measurements, signals, and current policy decisions.
Do not inspect holdout labels while tuning the policy.

Import accepted labels with this command:

```sh
pnpm evaluate:pi-corpus medium-anchor-labels -- --input PATH
```

## Optional privacy filtering

OpenAI Privacy Filter can preprocess private response text before review.
It is a local defense-in-depth step, not an anonymization guarantee.

Create filter input with this command:

```sh
pnpm evaluate:pi-corpus privacy-input -- --role all
```

Run the local filter with this command:

```sh
python evaluation/privacy-filter-corpus.py \
  --input ~/.local/state/nopus/evaluation/pi-corpus/v1/privacy-input-all.jsonl \
  --output ~/.local/state/nopus/evaluation/pi-corpus/v1/sanitized-review.jsonl
```

## Public regression fixture

The committed regression fixture contains frozen scalar measurements without response text, notes, private identifiers, or provenance.
Regenerate it after an approved baseline or label change with this command:

```sh
pnpm evaluate:pi-corpus export-fixture
```

The fixture exercises more than 5,000 policy inputs in the normal test suite.
The private corpus remains authoritative for analyzer and end-to-end drift because the public fixture contains no source text.
