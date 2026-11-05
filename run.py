r"""
Central job entry point: one failed build in, at most one PR out.

Reads the facts of the failed build from env vars (set by vars/aiAutofix.groovy):
  REPO_URL, BRANCH, COMMIT, SOURCE_BUILD_URL, SOURCE_BUILD_NUMBER, LIBRARY_VERSION, DRY_RUN,
  and the log tail as LOG_TAIL_FILE (path) or LOG_TAIL (text)
and the central job's own settings:
  BITBUCKET_URL, BITBUCKET_TOKEN, SHARED_LIB_PROJECT, SHARED_LIB_REPO, ALLOWED_REPOS

Flow:
  1. checks      - allow-list, loop guard
  2. download    - app repo at COMMIT and shared library at LIBRARY_VERSION (Bitbucket archive API,
                   no git history, nothing pushed)
  3. agent.py    - investigate + propose edits
  4. validate.py - apply edits to a copy, diff, YAML check
  5. create_pr.py (skipped when DRY_RUN=true)

Everything lands in work/ ; work/summary.json is the one-line outcome for reporting.
"""

import fnmatch
import io
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import requests
import urllib3

HERE = Path(__file__).resolve().parent
WORK = Path("work").resolve()
MAX_ARCHIVE_BYTES = 300 * 1024 * 1024

REDACTIONS = [
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
     "[REDACTED KEY]"),
    (re.compile(r"(?i)(authorization:\s*(?:bearer|basic)\s+)\S+"), r"\1[REDACTED]"),
    (re.compile(r"(?i)((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)\S+"), r"\1[REDACTED]"),
]


def env(name: str, default: str | None = None, required: bool = False) -> str:
    value = os.getenv(name, default)
    if required and not value:
        raise SystemExit(f"missing parameter / environment variable {name}")
    return value or ""


def ssl_verify():
    if os.getenv("BITBUCKET_SSL_VERIFY", "false").lower() != "true":
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        return False
    return os.getenv("BITBUCKET_CA_BUNDLE") or True


def parse_repo_url(url: str) -> tuple[str, str]:
    """https://host/scm/PROJ/repo.git  or  ssh://git@host:7999/proj/repo.git -> (PROJ, repo)"""
    m = re.search(r"/([^/]+)/([^/]+?)(?:\.git)?/?$", url)
    if not m:
        raise SystemExit(f"cannot read project/repo from REPO_URL={url!r}")
    project, repo = m.group(1), m.group(2)
    return (project if project.startswith("~") else project.upper()), repo


def allowed(project: str, repo: str, patterns: str) -> bool:
    """ALLOWED_REPOS='PAY/payments-api, PAY/*' - empty means nothing is allowed."""
    name = f"{project}/{repo}".lower()
    return any(fnmatch.fnmatch(name, p.strip().lower()) for p in patterns.split(",") if p.strip())


def redact(text: str) -> str:
    for rx, repl in REDACTIONS:
        text = rx.sub(repl, text)
    return text


def download(session: requests.Session, base: str, project: str, repo: str, at: str, dest: Path):
    """Repo snapshot at a commit/branch/tag, without git history."""
    url = f"{base}/rest/api/latest/projects/{project}/repos/{repo}/archive"
    r = session.get(url, params={"at": at, "format": "zip"}, timeout=120, stream=True)
    if r.status_code >= 400:
        raise RuntimeError(f"archive {project}/{repo}@{at} -> HTTP {r.status_code}: {r.text[:300]}")
    buf = io.BytesIO()
    for chunk in r.iter_content(1024 * 1024):
        buf.write(chunk)
        if buf.tell() > MAX_ARCHIVE_BYTES:
            raise RuntimeError(f"{project}/{repo} archive is larger than {MAX_ARCHIVE_BYTES >> 20} MB")
    dest.mkdir(parents=True)
    with zipfile.ZipFile(buf) as z:
        for member in z.infolist():
            target = (dest / member.filename).resolve()
            if dest.resolve() not in target.parents and target != dest.resolve():
                raise RuntimeError(f"unsafe path in archive: {member.filename}")
        z.extractall(dest)


def run_step(name: str, args: list[str]) -> subprocess.CompletedProcess:
    """Run one step, streaming its output live to the console while keeping a copy."""
    print(f"\n========== {name} ==========", flush=True)
    lines = []
    with subprocess.Popen([sys.executable, "-u", *args], cwd=WORK, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as p:
        for line in p.stdout:
            print(line, end="", flush=True)
            lines.append(line)
    return subprocess.CompletedProcess(args, p.returncode, "".join(lines))


def main() -> int:
    summary: dict = {"status": "error"}

    def finish(status: str, **extra) -> int:
        summary.update(status=status, **extra)
        (WORK / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        line = f"AI-AUTOFIX STATUS: {status}"
        if summary.get("pr_url"):
            line += f" | {summary['pr_url']}"
        print("\n" + line)
        return 1 if status.startswith("error") else 0    # errors turn the central build red

    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir()

    repo_url = env("REPO_URL", required=True)
    branch = env("BRANCH", required=True)
    commit = env("COMMIT", required=True)
    build_no = env("SOURCE_BUILD_NUMBER", "0")
    lib_version = env("LIBRARY_VERSION", "main")
    dry_run = env("DRY_RUN", "true").lower() == "true"
    base = env("BITBUCKET_URL", required=True).rstrip("/")
    project, repo = parse_repo_url(repo_url)

    summary.update(repo=f"{project}/{repo}", branch=branch, commit=commit,
                   source_build=env("SOURCE_BUILD_URL"), library_version=lib_version,
                   dry_run=dry_run)

    # 1. checks
    if branch.startswith("ai/fix-"):
        return finish("skipped_ai_branch")
    if not allowed(project, repo, env("ALLOWED_REPOS")):
        return finish("skipped_not_in_pilot")

    # 2. inputs
    log_file = env("LOG_TAIL_FILE")
    raw_log = Path(log_file).read_text(encoding="utf-8", errors="replace") if log_file else env("LOG_TAIL")
    log_tail = redact(raw_log)
    if not log_tail.strip():
        return finish("skipped_no_log")
    (WORK / "console.log").write_text(log_tail, encoding="utf-8")

    s = requests.Session()
    s.verify = ssl_verify()
    s.headers["Authorization"] = f"Bearer {env('BITBUCKET_TOKEN', required=True)}"
    try:
        download(s, base, project, repo, commit, WORK / "app")
        download(s, base, env("SHARED_LIB_PROJECT", required=True),
                 env("SHARED_LIB_REPO", required=True), lib_version, WORK / "shared")
    except (RuntimeError, requests.RequestException) as e:
        return finish("error_download", error=str(e))

    # 3. agent
    p = run_step("agent", [str(HERE / "agent.py"), "console.log", "app", "shared"])
    result_file = WORK / "agent-output" / "result.json"
    if p.returncode != 0 or not result_file.exists():
        return finish("error_agent", error=p.stdout[-1000:])
    result = json.loads(result_file.read_text(encoding="utf-8"))
    summary["reason"] = result.get("reason")
    if result.get("fixable") is not True:
        return finish("not_fixable")

    # 4. validate
    p = run_step("validate", [str(HERE / "validate.py"), "agent-output", "app"])
    validation = json.loads((WORK / "agent-output" / "validation.json").read_text(encoding="utf-8"))
    summary["validation_errors"] = validation.get("errors")
    if validation.get("status") != "PASS":
        return finish("rejected_validation")
    if dry_run:
        return finish("dry_run_ok")

    # 5. pull request
    p = run_step("create_pr", [str(HERE / "create_pr.py"), "agent-output",
                               "--url", base, "--project", project, "--repo", repo,
                               "--branch", branch, "--commit", commit, "--build", build_no])
    pr_file = WORK / "agent-output" / "pr.json"
    if pr_file.exists():
        return finish("pr_created", pr_url=json.loads(pr_file.read_text(encoding="utf-8"))["url"])
    return finish("pr_not_created", error=p.stdout[-1000:])


if __name__ == "__main__":
    sys.exit(main())
