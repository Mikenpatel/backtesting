r"""
Step 5 - validate the agent's proposed fix before it can become a PR.

Checks (stops at the first failing stage):
  1. sanity  - agent said fixable, files exist in the app repo, content changed
  2. diff    - build fix.diff locally (old file vs fixed file)
  3. syntax  - every changed .yml/.yaml file must parse

Policy rules (OPA) are not included yet; they plug in after the syntax check.

Usage:
    python validate.py agent-output C:\path\to\app-repo

Writes agent-output\fix.diff and agent-output\validation.json.
Exit code 0 = PASS, 1 = FAIL (so Jenkins can use it later).
"""

import difflib
import json
import sys
from pathlib import Path

import yaml

MAX_FILE_BYTES = 500_000


def read_keep_newlines(p: Path) -> str:
    """Read without converting line endings, so CRLF files stay CRLF."""
    with open(p, encoding="utf-8", errors="replace", newline="") as f:
        return f.read()


def match_style(original: str, new: str) -> str:
    """Give the fixed file the same line endings and final newline as the original.
    LLMs always answer with LF; without this every line of a CRLF file would show as changed."""
    new = new.replace("\r\n", "\n")
    if "\r\n" in original:
        new = new.replace("\n", "\r\n")
    nl = "\r\n" if "\r\n" in original else "\n"
    if original.endswith(("\n", "\r\n")) and not new.endswith(nl):
        new += nl
    return new


# ------------------------------------------------------------ 1. sanity

def check_sanity(result: dict, app_root: Path) -> tuple[list[str], dict[str, tuple[str, str]]]:
    """Returns (errors, {path: (original, fixed)}) for the files that really change."""
    errors: list[str] = []
    changes: dict[str, tuple[str, str]] = {}

    if result.get("fixable") is not True:
        return ["agent did not propose a fix (fixable is not true)"], changes

    files = result.get("files") or []
    if not files:
        return ["agent said fixable but returned no files"], changes

    for f in files:
        path, content = f.get("path"), f.get("content")
        if not path or not isinstance(content, str):
            errors.append(f"malformed file entry: {f!r:.100}")
            continue

        target = (app_root / path).resolve()
        if app_root not in target.parents:
            errors.append(f"{path}: outside the app repo")
            continue
        if not target.is_file():
            errors.append(f"{path}: does not exist in the app repo (new files are not allowed)")
            continue
        if target.stat().st_size > MAX_FILE_BYTES:
            errors.append(f"{path}: file too large to handle")
            continue
        if not content.strip():
            errors.append(f"{path}: proposed content is empty")
            continue

        original = read_keep_newlines(target)
        fixed = match_style(original, content)
        if fixed == original:
            continue                      # agent returned it unchanged; ignore this file
        changes[Path(path).as_posix()] = (original, fixed)

    if not errors and not changes:
        errors.append("proposed files are identical to the originals - nothing to fix")
    return errors, changes


# ------------------------------------------------------------ 2. diff

def build_diff(changes: dict[str, tuple[str, str]]) -> tuple[str, list[str], list[str]]:
    diff_parts, added, removed = [], [], []
    for path, (old, new) in changes.items():
        old_lines = old.replace("\r\n", "\n").splitlines(keepends=True)
        new_lines = new.replace("\r\n", "\n").splitlines(keepends=True)
        for line in difflib.unified_diff(old_lines, new_lines, f"a/{path}", f"b/{path}"):
            diff_parts.append(line if line.endswith("\n") else line + "\n")
            if line.startswith(("+++", "---")):
                continue
            if line.startswith("+"):
                added.append(line[1:].rstrip("\n"))
            elif line.startswith("-"):
                removed.append(line[1:].rstrip("\n"))
    return "".join(diff_parts), added, removed


# ------------------------------------------------------------ 3. syntax

def check_syntax(changes: dict[str, tuple[str, str]]) -> list[str]:
    errors = []
    for path, (_, new) in changes.items():
        if path.lower().endswith((".yml", ".yaml")):
            try:
                list(yaml.safe_load_all(new))        # supports multi-document YAML too
            except yaml.YAMLError as e:
                errors.append(f"{path}: fixed file is still invalid YAML: {e}")
    return errors


# ------------------------------------------------------------ main

def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    out_dir, app_root = Path(sys.argv[1]), Path(sys.argv[2]).resolve()

    report = {"status": "FAIL", "stage": None, "errors": [], "changed_files": [],
              "diff_stats": None}

    def finish(stage: str, errors: list[str]) -> int:
        report["stage"], report["errors"] = stage, errors
        report["status"] = "PASS" if not errors else "FAIL"
        (out_dir / "validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\n===== VALIDATION: {report['status']} (stage: {stage}) =====")
        for e in errors:
            print(" -", e)
        return 0 if not errors else 1

    try:
        result = json.loads((out_dir / "result.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return finish("load", [f"cannot read result.json: {e}"])

    # 1. sanity
    errors, changes = check_sanity(result, app_root)
    if errors:
        return finish("sanity", errors)

    # 2. diff
    diff, added, removed = build_diff(changes)
    (out_dir / "fix.diff").write_text(diff, encoding="utf-8")
    report["changed_files"] = list(changes)
    report["diff_stats"] = {"added": len(added), "removed": len(removed)}
    print(diff)
    print(f"{len(changes)} file(s), +{len(added)} / -{len(removed)} lines")

    # 3. syntax
    errors = check_syntax(changes)
    if errors:
        return finish("syntax", errors)

    # 4. policy (OPA) - not enabled yet

    return finish("syntax", [])


if __name__ == "__main__":
    sys.exit(main())
