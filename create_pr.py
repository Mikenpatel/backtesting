r"""
Step 6 - turn a validated fix into a Bitbucket pull request.

Only runs if agent-output\validation.json says PASS. Uses the Bitbucket REST API only
(no git clone/commit/push on this machine):
  1. refuse if an AI fix PR is already open into the failing branch
  2. create branch ai/fix-<build>-<commit7> from the failing commit
  3. commit each fixed file onto that branch
  4. open a PR into the failing branch, with the failing commit's author as reviewer

Usage:
    set BITBUCKET_TOKEN=<HTTP access token with repository write>
    python create_pr.py agent-output --url https://bitbucket.example.com ^
        --project PROJ --repo my-repo --branch feature/broken --commit <full sha> [--build 42] [--dry-run]

Optional: BITBUCKET_SSL_VERIFY=true (default false), BITBUCKET_CA_BUNDLE=<path to CA .pem>
"""

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote

import requests
import urllib3

MAX_DIFF_IN_PR = 20_000        # characters of diff shown in the PR description


def ssl_verify():
    if os.getenv("BITBUCKET_SSL_VERIFY", "false").lower() != "true":
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        return False
    return os.getenv("BITBUCKET_CA_BUNDLE") or True


class Bitbucket:
    def __init__(self, url: str, token: str, project: str, repo: str):
        self.base = url.rstrip("/")
        self.project, self.repo = project, repo
        self.repo_api = f"{self.base}/rest/api/1.0/projects/{project}/repos/{repo}"
        self.s = requests.Session()
        self.s.verify = ssl_verify()
        self.s.headers.update({"Authorization": f"Bearer {token}",
                               "X-Atlassian-Token": "no-check"})   # needed for file upload

    def _req(self, method: str, url: str, **kw) -> dict:
        r = self.s.request(method, url, timeout=30, **kw)
        if r.status_code >= 400:
            raise RuntimeError(f"{method} {url}\n  -> HTTP {r.status_code}: {r.text[:800]}")
        return r.json() if r.content else {}

    def check_access(self) -> None:
        self._req("GET", self.repo_api)            # fails fast on bad URL / token / repo

    def open_ai_prs_into(self, branch: str) -> list[dict]:
        data = self._req("GET", f"{self.repo_api}/pull-requests", params={
            "state": "OPEN", "direction": "INCOMING", "at": f"refs/heads/{branch}", "limit": 100})
        return [pr for pr in data.get("values", [])
                if pr["fromRef"]["displayId"].startswith("ai/fix-")]

    def create_branch(self, name: str, start_point: str) -> None:
        self._req("POST",
                  f"{self.base}/rest/branch-utils/1.0/projects/{self.project}/repos/{self.repo}/branches",
                  json={"name": name, "startPoint": start_point})

    def commit_file(self, branch: str, path: str, content: bytes, message: str,
                    source_commit: str) -> str:
        """Same as editing a file in the Bitbucket web UI. Returns the new commit id."""
        r = self._req("PUT", f"{self.repo_api}/browse/{quote(path, safe='/')}", files={
            "branch": (None, branch),
            "content": (Path(path).name, content),      # sent as bytes: line endings kept
            "message": (None, message),
            "sourceCommitId": (None, source_commit),    # refuse if the file changed meanwhile
        })
        return r["id"]

    def commit_author(self, commit: str) -> str | None:
        try:
            return self._req("GET", f"{self.repo_api}/commits/{commit}")["author"].get("name")
        except Exception:
            return None

    def create_pr(self, from_branch: str, to_branch: str, title: str, description: str,
                  reviewer: str | None) -> dict:
        def ref(b):
            return {"id": f"refs/heads/{b}",
                    "repository": {"slug": self.repo, "project": {"key": self.project}}}
        url = f"{self.repo_api}/pull-requests"
        body = {"title": title, "description": description,
                "fromRef": ref(from_branch), "toRef": ref(to_branch)}
        if reviewer:
            try:
                return self._req("POST", url, json={**body, "reviewers": [{"user": {"name": reviewer}}]})
            except RuntimeError as e:
                # e.g. reviewer is the PR author (your own token while testing) or an unknown user
                print(f"Reviewer '{reviewer}' not accepted, creating the PR without it.\n  {e}")
        return self._req("POST", url, json=body)


def short_title(reason: str) -> str:
    first = (reason or "Fix pipeline configuration").strip().split(". ")[0].rstrip(".")
    return ("[AI fix] " + first)[:120]


def pr_description(result: dict, diff: str, build: str) -> str:
    shown = diff if len(diff) <= MAX_DIFF_IN_PR else diff[:MAX_DIFF_IN_PR] + "\n... (truncated)"
    evidence = "\n".join(
        f"- `{e.get('repo')}/{e.get('path')}` lines {e.get('lines')}: {e.get('why')}"
        for e in result.get("evidence", [])) or "- (none given)"
    return (
        "**AI-suggested fix (LLM@CIB). Review carefully before merging.**\n\n"
        f"**Failed build:** {build}\n\n"
        f"**Root cause:** {result.get('reason', 'n/a')}\n\n"
        f"**Evidence from the repositories:**\n{evidence}\n\n"
        f"```diff\n{shown}\n```\n\n"
        "Validated: edits applied exactly, YAML still parses. "
        "Decline this PR if the change is wrong."
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Create a Bitbucket PR from a validated AI fix")
    ap.add_argument("out_dir", help="agent-output folder")
    ap.add_argument("--url", required=True, help="Bitbucket base URL")
    ap.add_argument("--project", required=True, help="project key, e.g. PROJ (or ~username)")
    ap.add_argument("--repo", required=True, help="repository slug")
    ap.add_argument("--branch", required=True, help="the failing branch (PR target)")
    ap.add_argument("--commit", required=True, help="full id of the failing commit")
    ap.add_argument("--build", default="local", help="build number or label, used in the branch name")
    ap.add_argument("--dry-run", action="store_true", help="check everything, create nothing")
    args = ap.parse_args()

    out = Path(args.out_dir)

    # 0. only validated fixes go further
    validation = json.loads((out / "validation.json").read_text(encoding="utf-8"))
    if validation.get("status") != "PASS":
        print(f"validation.json status is {validation.get('status')}, not PASS. No PR created.")
        return 1
    result = json.loads((out / "result.json").read_text(encoding="utf-8"))
    diff = (out / "fix.diff").read_text(encoding="utf-8")
    files = {p: (out / "fixed" / p).read_bytes() for p in validation["changed_files"]}

    token = os.environ.get("BITBUCKET_TOKEN")
    if not token:
        raise SystemExit("Set BITBUCKET_TOKEN first")

    bb = Bitbucket(args.url, token, args.project, args.repo)
    fix_branch = f"ai/fix-{args.build}-{args.commit[:7]}"
    title = short_title(result.get("reason", ""))
    message = f"{title}\n\nGenerated by LLM@CIB for build {args.build}"

    bb.check_access()
    print(f"Repo OK: {args.project}/{args.repo}")

    # 1. no duplicates
    existing = bb.open_ai_prs_into(args.branch)
    if existing:
        print("An AI fix PR is already open into this branch:",
              existing[0]["links"]["self"][0]["href"])
        return 1

    reviewer = bb.commit_author(args.commit)
    print(f"Fix branch : {fix_branch}  (from {args.commit[:12]})")
    print(f"Files      : {', '.join(files)}")
    print(f"PR         : {fix_branch} -> {args.branch}")
    print(f"Title      : {title}")
    print(f"Reviewer   : {reviewer or '(none found)'}")
    if args.dry_run:
        print("\nDry run: nothing created.")
        return 0

    # 2. branch
    bb.create_branch(fix_branch, args.commit)
    print("Branch created")

    # 3. commit each fixed file, chaining commits
    head = args.commit
    for path, content in files.items():
        head = bb.commit_file(fix_branch, path, content, message, head)
        print(f"Committed {path} -> {head[:12]}")

    # 4. pull request
    pr = bb.create_pr(fix_branch, args.branch, title,
                      pr_description(result, diff, args.build), reviewer)
    url = pr["links"]["self"][0]["href"]
    (out / "pr.json").write_text(json.dumps({"url": url, "id": pr.get("id"),
                                             "branch": fix_branch, "commit": head}, indent=2),
                                 encoding="utf-8")
    print(f"\nPR created: {url}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:
        print(f"\nBitbucket error:\n{e}")
        sys.exit(1)
    except requests.RequestException as e:
        print(f"\nCannot reach Bitbucket: {type(e).__name__}: {e}")
        sys.exit(1)
