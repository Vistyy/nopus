#!/usr/bin/env python3
"""Run OpenAI Privacy Filter over the private nopus response corpus."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys
from typing import Any

from opf import OPF, RedactionResult


def state_home() -> Path:
    configured = os.environ.get("XDG_STATE_HOME", "").strip()
    if not configured:
        return Path.home() / ".local" / "state"
    path = Path(configured)
    if not path.is_absolute():
        raise ValueError("XDG_STATE_HOME must be an absolute path.")
    return path


def private_root() -> Path:
    return state_home() / "nopus" / "evaluation" / "pi-corpus" / "v1"


def tool_root() -> Path:
    return state_home() / "nopus" / "tools" / "privacy-filter"


def deterministic_redact(text: str) -> tuple[str, list[str]]:
    """Remove machine-specific identifiers that are outside OPF's PII taxonomy."""
    findings: list[str] = []
    home = str(Path.home())
    username = Path.home().name
    replacements = [
        (re.compile(re.escape(home), re.IGNORECASE), "<HOME>", "home_path"),
        (re.compile(rf"(?<![\w.-]){re.escape(username)}(?![\w.-])", re.IGNORECASE), "<USER>", "local_username"),
        (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), "<IP_ADDRESS>", "ip_address"),
    ]
    result = text
    for pattern, placeholder, label in replacements:
        result, count = pattern.subn(placeholder, result)
        if count:
            findings.extend([label] * count)
    return result, findings


def retain_partial(path: Path, allowed: set[str]) -> set[str]:
    if not path.exists():
        return set()
    retained: list[str] = []
    completed: set[str] = set()
    with path.open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
                candidate_id = value["candidateId"]
            except Exception as error:
                raise RuntimeError(f"Invalid partial output at {path}:{line_number}: {error}") from error
            if candidate_id in allowed:
                retained.append(json.dumps(value, ensure_ascii=False))
                completed.add(candidate_id)
    path.write_text("".join(line + "\n" for line in retained), encoding="utf-8")
    os.chmod(path, 0o600)
    return completed


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    root = private_root()
    tools = tool_root()
    parser.add_argument("--input", type=Path, default=root / "candidates.jsonl")
    parser.add_argument("--output", type=Path, default=root / "sanitized.jsonl")
    parser.add_argument("--checkpoint", type=Path, default=tools / "checkpoint")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--context-window", type=int, default=32768)
    return parser.parse_args()


def main() -> None:
    args = arguments()
    args.output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(args.output.parent, 0o700)
    partial = args.output.with_suffix(args.output.suffix + ".new")
    input_ids = {
        json.loads(line)["candidateId"]
        for line in args.input.open(encoding="utf-8")
        if line.strip()
    }
    completed = retain_partial(partial, input_ids)

    redactor = OPF(
        model=args.checkpoint,
        device=args.device,
        context_window_length=args.context_window,
        trim_whitespace=True,
        output_mode="typed",
        decode_mode="viterbi",
        output_text_only=False,
    )
    redactor.get_runtime()

    total = len(input_ids)
    mode = "a" if partial.exists() else "x"
    with args.input.open(encoding="utf-8") as source, partial.open(mode, encoding="utf-8") as destination:
        os.chmod(partial, 0o600)
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            candidate = json.loads(line)
            candidate_id = candidate["candidateId"]
            if candidate_id in completed:
                continue
            try:
                result = redactor.redact(candidate["text"])
                if not isinstance(result, RedactionResult):
                    raise TypeError(f"Unexpected OPF result: {type(result).__name__}")
                redacted_text, deterministic = deterministic_redact(result.redacted_text)
                record: dict[str, Any] = {
                    "schemaVersion": 1,
                    "candidateId": candidate_id,
                    "redactedText": redacted_text,
                    "privacyFilter": {
                        "spanCount": len(result.detected_spans),
                        "byLabel": result.to_dict()["summary"]["by_label"],
                        "decodedMismatch": bool(result.to_dict()["summary"]["decoded_mismatch"]),
                    },
                    "deterministicFindings": deterministic,
                    "requiresReview": bool(result.warning),
                }
                if result.warning:
                    record["warning"] = result.warning
            except Exception as error:
                record = {
                    "schemaVersion": 1,
                    "candidateId": candidate_id,
                    "error": f"{type(error).__name__}: {error}",
                    "requiresReview": True,
                }
            destination.write(json.dumps(record, ensure_ascii=False) + "\n")
            destination.flush()
            completed.add(candidate_id)
            if len(completed) % 25 == 0:
                os.fsync(destination.fileno())
                print(f"Sanitized {len(completed)}/{total}", file=sys.stderr, flush=True)
        os.fsync(destination.fileno())
    if len(completed) != total:
        raise RuntimeError(f"Sanitization incomplete: {len(completed)}/{total}")
    partial.replace(args.output)
    os.chmod(args.output, 0o600)
    print(json.dumps({"output": str(args.output), "responses": total}))


if __name__ == "__main__":
    main()
