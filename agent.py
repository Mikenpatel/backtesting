r"""
Step 4 - investigating agent.

The LLM gets the failure log plus read-only tools over two local repos:
  app     = the failing project (checked out at the failing commit)
  shared  = the shared pipeline library
It explores both, then returns a root cause, evidence and small search/replace edits.
Nothing is changed in either repo: results go to the agent-output folder,
and validate.py applies and checks the edits.

Usage:
    python agent.py console.log C:\path\to\app-repo C:\path\to\shared-library
"""

import json
import sys
from pathlib import Path

from LLM_CIB_CLIENT import LLMCIB

MODEL = "gpt-oss-120b-ITG"
MAX_STEPS = 15            # max tool rounds before forcing an answer
MAX_LINES = 400           # max lines returned by one read_file call
MAX_HITS = 50             # max lines returned by one search call
MAX_FILE_BYTES = 500_000  # search skips files bigger than this
TEXT_EXT = {".groovy", ".yml", ".yaml", ".md", ".txt", ".json",
            ".properties", ".gradle", ".xml", ".sh", ""}
OUT_DIR = Path("agent-output")

# ------------------------------------------------------------ 1. instructions

SYSTEM = """You diagnose and fix failed Jenkins pipelines that use the shared pipeline library.

You have read-only tools over two repositories:
- "app": the failing project (ci-cd.yml, Jenkinsfile, ...)
- "shared": the shared pipeline library that reads and executes ci-cd.yml

Method:
1. Read the failing project's pipeline files.
2. Find in the shared library the code or docs that define the setting involved in the error
   (search for the key name or the error message, then read that file).
3. Base your conclusion ONLY on what you found in these repos. If the repos do not support a fix,
   or the cause is not in the pipeline config (tests, application code, infrastructure,
   permissions, missing Jenkins credentials), answer not fixable.

Rules for a fix: smallest possible change, only files in the "app" repo, never add secrets,
never remove stages, steps, scans or approvals.

Describe the fix as EDITS, never as a whole file:
- "old" is text copied EXACTLY from the current file (same spaces and indentation),
  WITHOUT the "12: " line-number prefixes that read_file shows.
- "old" must appear exactly once in the file: include a neighbouring line if needed.
- "new" is the replacement text. Keep "old" as short as possible (usually 1-3 lines).

When you are done, reply with JSON only and no tool call:
{
  "fixable": true or false,
  "reason": "root cause in 1-3 sentences",
  "evidence": [{"repo": "shared", "path": "...", "lines": "120-135", "why": "..."}],
  "edits": [{"path": "<path in app repo>", "old": "<exact current text>", "new": "<replacement>"}]
}"""

# ------------------------------------------------------------ 2. tool menu (sent to the LLM)

TOOLS = [
    {"type": "function", "function": {
        "name": "list_dir",
        "description": "List files and folders in a repo directory.",
        "parameters": {"type": "object", "properties": {
            "repo": {"type": "string", "enum": ["app", "shared"]},
            "path": {"type": "string", "description": "Directory path, '.' for the repo root"}},
            "required": ["repo"]}}},
    {"type": "function", "function": {
        "name": "read_file",
        "description": "Read a text file from a repo. Lines are numbered.",
        "parameters": {"type": "object", "properties": {
            "repo": {"type": "string", "enum": ["app", "shared"]},
            "path": {"type": "string"},
            "start_line": {"type": "integer", "description": "First line to return, default 1"}},
            "required": ["repo", "path"]}}},
    {"type": "function", "function": {
        "name": "search",
        "description": "Case-insensitive text search across a repo. Returns path:line: text.",
        "parameters": {"type": "object", "properties": {
            "repo": {"type": "string", "enum": ["app", "shared"]},
            "text": {"type": "string"}},
            "required": ["repo", "text"]}}},
]

# ------------------------------------------------------------ 3. tool implementations (our code)


def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


class RepoTools:
    def __init__(self, app_dir: str, shared_dir: str):
        self.roots = {"app": Path(app_dir).resolve(), "shared": Path(shared_dir).resolve()}
        for name, root in self.roots.items():
            if not root.is_dir():
                raise SystemExit(f"{name} repo folder not found: {root}")

    def _safe(self, repo: str, path: str = ".") -> Path:
        """Resolve a path and refuse anything outside the repo (e.g. ../../secrets)."""
        root = self.roots[repo]
        p = (root / path).resolve()
        if p != root and root not in p.parents:
            raise ValueError("path outside repository")
        return p

    def _text_files(self, repo: str):
        for p in self.roots[repo].rglob("*"):
            if (p.is_file() and ".git" not in p.parts
                    and p.suffix.lower() in TEXT_EXT
                    and p.stat().st_size <= MAX_FILE_BYTES):
                yield p

    def list_dir(self, repo: str, path: str = ".") -> str:
        d = self._safe(repo, path)
        entries = sorted(e.name + ("/" if e.is_dir() else "")
                         for e in d.iterdir() if e.name != ".git")
        return "\n".join(entries[:200]) or "(empty)"

    def read_file(self, repo: str, path: str, start_line: int = 1) -> str:
        lines = read_text(self._safe(repo, path)).splitlines()
        start = max(int(start_line), 1)
        chunk = lines[start - 1:start - 1 + MAX_LINES]
        out = "\n".join(f"{i}: {line}" for i, line in enumerate(chunk, start))
        if start - 1 + MAX_LINES < len(lines):
            out += f"\n... ({len(lines)} lines total, call again with start_line={start + MAX_LINES})"
        return out or "(empty file)"

    def search(self, repo: str, text: str) -> str:
        hits, needle, root = [], text.lower(), self.roots[repo]
        for p in self._text_files(repo):
            for n, line in enumerate(read_text(p).splitlines(), 1):
                if needle in line.lower():
                    hits.append(f"{p.relative_to(root).as_posix()}:{n}: {line.strip()[:200]}")
                    if len(hits) >= MAX_HITS:
                        return "\n".join(hits) + "\n... (more results, use a more specific search)"
        return "\n".join(hits) or "no matches"

    def run(self, name: str, args: dict) -> str:
        """Dispatch a tool call. Errors are returned as text so the LLM can correct itself."""
        if name not in ("list_dir", "read_file", "search"):
            return f"ERROR: unknown tool {name}"
        try:
            return getattr(self, name)(**args)
        except Exception as e:
            return f"ERROR: {type(e).__name__}: {e}"

# ------------------------------------------------------------ 4. the agent loop


def ask(llm: LLMCIB, messages: list, with_tools: bool = True):
    kwargs = {"model": MODEL, "messages": messages, "temperature": 0}
    if with_tools:
        kwargs["tools"] = TOOLS
    r = llm._call(lambda c: c.chat.completions.create(**kwargs))
    return r.choices[0].message


def run_agent(log_tail: str, tools: RepoTools, trace: list) -> str:
    llm = LLMCIB()
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": "The build failed. Last lines of the log:\n\n" + log_tail},
    ]

    for step in range(1, MAX_STEPS + 1):
        msg = ask(llm, messages)
        messages.append(msg.model_dump(exclude_none=True))      # remember the LLM's turn

        if not msg.tool_calls:                                   # no tool call = final answer
            return msg.content or ""

        for tc in msg.tool_calls:                                # run each requested tool
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = tools.run(tc.function.name, args)
            print(f"[{step}] {tc.function.name}({args}) -> {len(result)} chars")
            trace.append({"step": step, "tool": tc.function.name, "args": args,
                          "result_preview": result[:300]})
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

    # out of steps: force an answer with what it has
    print(f"Reached {MAX_STEPS} steps, asking for the final answer")
    messages.append({"role": "user", "content": "Stop investigating. Give your final JSON answer now."})
    return ask(llm, messages, with_tools=False).content or ""


def parse_json(text: str) -> dict | None:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None

# ------------------------------------------------------------ 5. main


def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    log_path, app_dir, shared_dir = sys.argv[1], sys.argv[2], sys.argv[3]

    log_tail = "\n".join(read_text(Path(log_path)).splitlines()[-200:])
    tools = RepoTools(app_dir, shared_dir)
    OUT_DIR.mkdir(exist_ok=True)

    trace: list = []
    raw = run_agent(log_tail, tools, trace)
    (OUT_DIR / "trace.json").write_text(json.dumps(trace, indent=2), encoding="utf-8")
    (OUT_DIR / "raw_answer.txt").write_text(raw, encoding="utf-8")

    result = parse_json(raw)
    if result is None:
        print("\nThe final answer was not valid JSON. See agent-output\\raw_answer.txt")
        return

    print("\n===== RESULT =====")
    print("Fixable:", result.get("fixable"))
    print("Reason :", result.get("reason"))
    for ev in result.get("evidence", []):
        print(f"Evidence: {ev.get('repo')}/{ev.get('path')} lines {ev.get('lines')} - {ev.get('why')}")

    for e in result.get("edits", []):
        print(f"\nEdit in {e.get('path')}:")
        print("  - " + str(e.get("old", "")).replace("\n", "\n  - "))
        print("  + " + str(e.get("new", "")).replace("\n", "\n  + "))
    print("\nNext: python validate.py agent-output <app repo>  (applies and checks the edits)")

    (OUT_DIR / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
