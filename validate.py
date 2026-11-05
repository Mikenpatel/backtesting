r"""
Step 5 - apply and validate the agent's proposed edits before they can become a PR.

Checks (stops at the first failing stage):
  1. sanity  - agent said fixable, files exist in the app repo,
               every edit's "old" text is found exactly once
  2. diff    - apply the edits to a copy and build fix.diff (old file vs fixed file)
  3. syntax  - every changed .yml/.yaml file must still parse

Policy rules (OPA) are not included yet; they plug in after the syntax check.

Usage:
    python validate.py agent-output C:\path\to\app-repo

Writes agent-output\fix.diff, agent-output\fixed\<files>, agent-output\original\<files>
and agent-output\validation.json.
The app repo itself is never modified.
Exit code 0 = PASS, 1 = FAIL (so Jenkins can use it later).
"""

import difflib
import json
import re
import sys
from pathlib import Path

MAX_FILE_BYTES = 500_000
LINE_NO_PREFIX = re.compile(r"^\s*\d+: ?", re.M)     # "12: " as shown by the agent's read_file


def read_keep_newlines(p: Path) -> str:
    """Read without converting line endings, so CRLF files stay CRLF."""
    with open(p, encoding="utf-8", errors="replace", newline="") as f:
        return f.read()


def write_keep_newlines(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="") as f:
        f.write(text)


# ------------------------------------------------------------ 1. sanity + apply edits

def apply_edit(text: str, old: str, new: str) -> tuple[str | None, str | None]:
    """Replace `old` with `new` exactly once. Returns (new_text, error)."""
    count = text.count(old)
    if count == 0:
        # common LLM mistake: it copied the "12: " prefixes from read_file
        lines = old.splitlines()
        if lines and all(LINE_NO_PREFIX.match(l) for l in lines):
            stripped_old = LINE_NO_PREFIX.sub("", old)
            stripped_new = LINE_NO_PREFIX.sub("", new)
            if text.count(stripped_old) == 1:
                return text.replace(stripped_old, stripped_new, 1), None
        return None, "old text not found in the file"
    if count > 1:
        return None, f"old text appears {count} times (ambiguous)"
    return text.replace(old, new, 1), None


def check_and_apply(result: dict, app_root: Path) -> tuple[list[str], dict[str, tuple[str, str]]]:
    """Returns (errors, {path: (original, fixed)}) for the files that really change."""
    errors: list[str] = []
    if result.get("fixable") is not True:
        return ["agent did not propose a fix (fixable is not true)"], {}

    edits = result.get("edits") or []
    if not edits:
        return ["agent said fixable but returned no edits"], {}

    originals: dict[str, str] = {}        # path -> original text (as on disk)
    working: dict[str, str] = {}          # path -> text with LF endings, edits applied

    for i, e in enumerate(edits, 1):
        path, old, new = e.get("path"), e.get("old"), e.get("new")
        label = f"edit {i} ({path})"
        if not path or not isinstance(old, str) or not isinstance(new, str):
            errors.append(f"{label}: malformed edit")
            continue
        if not old.strip():
            errors.append(f"{label}: empty 'old' text")
            continue

        key = Path(path).as_posix()
        if key not in originals:
            target = (app_root / path).resolve()
            if app_root not in target.parents:
                errors.append(f"{label}: outside the app repo")
                continue
            if not target.is_file():
                errors.append(f"{label}: file does not exist in the app repo")
                continue
            if target.stat().st_size > MAX_FILE_BYTES:
                errors.append(f"{label}: file too large")
                continue
            originals[key] = read_keep_newlines(target)
            working[key] = originals[key].replace("\r\n", "\n")

        updated, err = apply_edit(working[key],
                                  old.replace("\r\n", "\n"), new.replace("\r\n", "\n"))
        if err:
            errors.append(f"{label}: {err}")
        else:
            working[key] = updated

    if errors:
        return errors, {}

    changes = {}
    for key, text in working.items():
        if "\r\n" in originals[key]:
            text = text.replace("\n", "\r\n")         # restore Windows line endings
        if text != originals[key]:
            changes[key] = (originals[key], text)
    if not changes:
        return ["edits do not change anything"], {}
    return [], changes


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

def yaml_parser():
    """PyYAML if installed, otherwise ruamel.yaml (pure Python, no compiler needed)."""
    try:
        import yaml
        return lambda s: list(yaml.safe_load_all(s)), yaml.YAMLError
    except ImportError:
        from ruamel.yaml import YAML
        from ruamel.yaml.error import YAMLError
        return lambda s: list(YAML(typ="safe", pure=True).load_all(s)), YAMLError


def check_syntax(changes: dict[str, tuple[str, str]]) -> list[str]:
    parse, yaml_error = yaml_parser()
    errors = []
    for path, (_, new) in changes.items():
        if path.lower().endswith((".yml", ".yaml")):
            try:
                parse(new)
            except yaml_error as e:
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

    # 1. sanity + apply edits (in memory only)
    errors, changes = check_and_apply(result, app_root)
    if errors:
        return finish("sanity", errors)

    # 2. diff + save fixed copies
    diff, added, removed = build_diff(changes)
    (out_dir / "fix.diff").write_text(diff, encoding="utf-8")
    for path, (old, new) in changes.items():
        write_keep_newlines(out_dir / "fixed" / path, new)
        write_keep_newlines(out_dir / "original" / path, old)   # create_pr.py checks against it
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
