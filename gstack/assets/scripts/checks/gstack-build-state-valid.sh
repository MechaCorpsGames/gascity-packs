#!/usr/bin/env bash
set -euo pipefail

# gstack build semantic gate.
#
# The shared artifact gate proves the current Markdown artifact satisfies its
# schema. This wrapper additionally proves that the artifact describes the
# launch target and the runtime state that the gstack build actually created:
# source convoy traversal, exact implementation-convoy membership, member
# closure, and committed evidence in each authoritative implementation
# worktree.

fail() {
  echo "gstack-build-state-check: $*" >&2
  exit 1
}

BEAD_ID="${GC_BEAD_ID:-}"
[ -n "$BEAD_ID" ] || fail "GC_BEAD_ID is required"
command -v gc >/dev/null 2>&1 || fail "gc is required on PATH"
command -v python3 >/dev/null 2>&1 || fail "python3 is required on PATH"
command -v git >/dev/null 2>&1 || fail "git is required on PATH"

launcher_root_from_work_dir() {
  candidate="${GC_WORK_DIR:-}"
  [ -n "$candidate" ] || return 1
  candidate="$(cd "$candidate" 2>/dev/null && pwd -P)" || return 1

  while :; do
    if [ -x "$candidate/.gc/scripts/checks/build-artifact-valid.sh" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
    [ "$candidate" != "/" ] || return 1
    parent="$(dirname "$candidate")"
    [ "$parent" != "$candidate" ] || return 1
    candidate="$parent"
  done
}

LAUNCHER_ROOT="$(launcher_root_from_work_dir)" || fail "no launcher root containing .gc/scripts/checks/build-artifact-valid.sh exists at or above GC_WORK_DIR=${GC_WORK_DIR:-<unset>}"
BASE_CHECK="$LAUNCHER_ROOT/.gc/scripts/checks/build-artifact-valid.sh"
[ -x "$BASE_CHECK" ] || fail "shared build-artifact-valid.sh is missing or not executable: $BASE_CHECK"
VALIDATOR="$LAUNCHER_ROOT/.gc/scripts/validate_build_artifact.py"
[ -f "$VALIDATOR" ] || fail "shared validate_build_artifact.py is missing: $VALIDATOR"

cd "$LAUNCHER_ROOT"
"$BASE_CHECK"

python3 - "$BEAD_ID" "$LAUNCHER_ROOT" "$VALIDATOR" <<'PY'
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml


BEAD_ID = sys.argv[1]
LAUNCHER_ROOT = Path(sys.argv[2]).resolve()
VALIDATOR = Path(sys.argv[3]).resolve()


def fail(message: str) -> None:
    print(f"gstack-build-state-check: {message}", file=sys.stderr)
    raise SystemExit(1)


def command(args: list[str], *, label: str) -> str:
    result = subprocess.run(
        args,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        detail = result.stderr.strip().splitlines()
        suffix = f": {detail[0]}" if detail else ""
        fail(f"{label} failed{suffix}")
    return result.stdout


def json_command(args: list[str], *, label: str) -> Any:
    raw = command(args, label=label)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"{label} returned invalid JSON: {exc}")


def bead(bead_id: str) -> dict[str, Any]:
    data = json_command(["gc", "bd", "show", bead_id, "--json"], label=f"gc bd show {bead_id}")
    if isinstance(data, list):
        data = data[0] if data else {}
    if not isinstance(data, dict) or str(data.get("id") or "") != bead_id:
        fail(f"gc bd show {bead_id} did not return that bead")
    return data


def metadata(item: dict[str, Any], key: str) -> str:
    values = item.get("metadata")
    value = values.get(key, "") if isinstance(values, dict) else ""
    return value.strip() if isinstance(value, str) else ""


def convoy_status(convoy_id: str) -> dict[str, Any]:
    data = json_command(
        ["gc", "convoy", "status", convoy_id, "--json"],
        label=f"gc convoy status {convoy_id}",
    )
    if not isinstance(data, dict):
        fail(f"gc convoy status {convoy_id} did not return an object")
    convoy = data.get("convoy")
    if not isinstance(convoy, dict) or str(convoy.get("id") or "") != convoy_id:
        fail(f"gc convoy status {convoy_id} returned a different convoy")
    children = data.get("children")
    if not isinstance(children, list):
        fail(f"gc convoy status {convoy_id} omitted children")
    return data


def resolved_file(raw: str, *, key: str) -> Path:
    if not raw:
        fail(f"workflow root metadata {key} is missing")
    path = Path(raw)
    if not path.is_absolute():
        path = LAUNCHER_ROOT / path
    try:
        path = path.resolve(strict=True)
    except OSError as exc:
        fail(f"{key} does not resolve to an existing path: {raw}: {exc}")
    if not path.is_file():
        fail(f"{key} is not a regular file: {path}")
    return path


def front_matter(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    match = re.match(r"\A---\n(?P<front>.*?)\n---(?:\n|\Z)", text, re.DOTALL)
    if not match:
        fail(f"artifact has no parseable YAML front matter: {path}")
    try:
        data = yaml.safe_load(match.group("front")) or {}
    except yaml.YAMLError as exc:
        fail(f"artifact front matter is invalid at {path}: {exc}")
    if not isinstance(data, dict):
        fail(f"artifact front matter must be a mapping: {path}")
    return data


def validate_implementation_summary(
    path: Path,
    *,
    label: str,
    upstream_root: Path,
) -> None:
    result = subprocess.run(
        [
            sys.executable,
            str(VALIDATOR),
            "--schema",
            "gc.build.implementation-summary.v1",
            "--path",
            str(path),
            "--verify-absolute-upstreams",
            "--upstream-root",
            str(upstream_root),
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        detail = result.stderr.strip().splitlines()
        suffix = f": {detail[0]}" if detail else ""
        fail(f"{label} failed schema validation{suffix}")


def child_rows(status: dict[str, Any], *, convoy_id: str) -> list[dict[str, Any]]:
    children = status.get("children")
    rows = [row for row in children if isinstance(row, dict)] if isinstance(children, list) else []
    if len(rows) != len(children or []):
        fail(f"convoy {convoy_id} contains a malformed child row")
    ids = [str(row.get("id") or "").strip() for row in rows]
    if any(not child_id for child_id in ids) or len(ids) != len(set(ids)):
        fail(f"convoy {convoy_id} contains missing or duplicate child ids: {ids}")
    return rows


STEP = bead(BEAD_ID)
ROOT_ID = metadata(STEP, "gc.root_bead_id") or BEAD_ID
ROOT = bead(ROOT_ID) if ROOT_ID != BEAD_ID else STEP
SCHEMA = metadata(STEP, "gc.build.artifact_schema")
if not SCHEMA:
    fail(f"step metadata gc.build.artifact_schema is missing on {BEAD_ID}")

LAUNCH_CONVOY_ID = metadata(ROOT, "gc.var.convoy_id")
if not LAUNCH_CONVOY_ID:
    fail(f"workflow root {ROOT_ID} is missing reserved launch convoy metadata gc.var.convoy_id")
LAUNCH_STATUS = convoy_status(LAUNCH_CONVOY_ID)
LAUNCH_ROWS = child_rows(LAUNCH_STATUS, convoy_id=LAUNCH_CONVOY_ID)
SOURCE_IDS = [str(row["id"]) for row in LAUNCH_ROWS]
if not SOURCE_IDS:
    fail(f"launch convoy {LAUNCH_CONVOY_ID} has no source targets")

REQUIREMENTS_PATH = resolved_file(
    metadata(ROOT, "gc.build.requirements_path") or metadata(ROOT, "gc.var.requirements_path"),
    key="gc.build.requirements_path",
)
requirements_front = front_matter(REQUIREMENTS_PATH)
trace = requirements_front.get("trace")
upstream = trace.get("upstream") if isinstance(trace, dict) else None
if not isinstance(upstream, list):
    fail(f"requirements trace.upstream is missing: {REQUIREMENTS_PATH}")
observed_source_traces = [
    str(entry.get("path") or "")[len("beads/") :]
    for entry in upstream
    if isinstance(entry, dict)
    and str(entry.get("path") or "").startswith("beads/")
    and str(entry.get("hash") or "")
    == "bead:" + str(entry.get("path") or "")[len("beads/") :]
]
missing_sources = [source_id for source_id in SOURCE_IDS if source_id not in observed_source_traces]
if missing_sources:
    fail(
        "missing launch source trace in requirements: "
        f"launch_convoy={LAUNCH_CONVOY_ID} missing={missing_sources} "
        f"observed={sorted(observed_source_traces)}"
    )
duplicate_sources = sorted(
    source_id for source_id in SOURCE_IDS if observed_source_traces.count(source_id) != 1
)
if duplicate_sources:
    fail(
        "duplicate launch source trace in requirements: "
        f"launch_convoy={LAUNCH_CONVOY_ID} duplicates={duplicate_sources}"
    )


def git_common_dir(repo: Path, *, label: str) -> Path:
    raw = command(
        ["git", "-C", str(repo), "rev-parse", "--git-common-dir"],
        label=label,
    ).strip()
    path = Path(raw)
    if not path.is_absolute():
        path = repo / path
    try:
        return path.resolve(strict=True)
    except OSError as exc:
        fail(f"{label} returned an invalid path {raw!r}: {exc}")


def implementation_state(*, require_closed: bool, require_worktree_proof: bool) -> None:
    input_convoy_id = metadata(ROOT, "gc.input_convoy_id")
    report_convoy_id = metadata(ROOT, "gc.build.implementation_convoy_id")
    if not input_convoy_id or not report_convoy_id:
        fail(
            f"workflow root {ROOT_ID} must record gc.input_convoy_id and "
            "gc.build.implementation_convoy_id"
        )
    if input_convoy_id != report_convoy_id:
        fail(
            "implementation convoy metadata mismatch: "
            f"gc.input_convoy_id={input_convoy_id} "
            f"gc.build.implementation_convoy_id={report_convoy_id}"
        )
    if input_convoy_id == LAUNCH_CONVOY_ID:
        fail(f"implementation convoy must differ from launch convoy {LAUNCH_CONVOY_ID}")

    raw_member_ids = metadata(ROOT, "gc.build.implementation_member_ids")
    member_ids = [value.strip() for value in raw_member_ids.split(",") if value.strip()]
    if not member_ids:
        fail(f"workflow root {ROOT_ID} has no gc.build.implementation_member_ids")
    if len(member_ids) != len(set(member_ids)):
        fail(f"gc.build.implementation_member_ids contains duplicates: {member_ids}")

    status = convoy_status(input_convoy_id)
    convoy = status["convoy"]
    expected_title = f"gstack implementation for {ROOT_ID}"
    observed_title = str(convoy.get("title") or "")
    if observed_title != expected_title:
        fail(
            "implementation convoy title mismatch: "
            f"expected={expected_title!r} observed={observed_title!r}"
        )
    rows = child_rows(status, convoy_id=input_convoy_id)
    observed_ids = [str(row["id"]) for row in rows]
    if len(observed_ids) != len(member_ids) or set(observed_ids) != set(member_ids):
        fail(
            "implementation convoy membership mismatch: "
            f"expected={member_ids} observed={observed_ids}"
        )

    decomposition_path = resolved_file(
        metadata(ROOT, "gc.build.decomposition_path") or metadata(ROOT, "gc.var.decomposition_path"),
        key="gc.build.decomposition_path",
    )
    decomposition_text = decomposition_path.read_text(encoding="utf-8", errors="replace")
    work_items_match = re.search(r"(?ms)^## Work Items\s*$\n(?P<body>.*)\Z", decomposition_text)
    if not work_items_match:
        fail(f"decomposition has no ## Work Items section: {decomposition_path}")
    work_items = work_items_match.group("body")
    item_headers = list(
        re.finditer(
            r"(?m)^###\s+([A-Za-z0-9][A-Za-z0-9._-]*)(?=\s*:|\s+-|\s*$).*$",
            work_items,
        )
    )
    documented_ids = [match.group(1) for match in item_headers]
    if len(documented_ids) != len(member_ids) or set(documented_ids) != set(member_ids):
        fail(
            "decomposition work-item membership mismatch: "
            f"expected={member_ids} documented={documented_ids}"
        )

    accounted_sources: set[str] = set()
    source_id_set = set(SOURCE_IDS)
    for index, header in enumerate(item_headers):
        member_id = header.group(1)
        section_end = item_headers[index + 1].start() if index + 1 < len(item_headers) else len(work_items)
        section = work_items[header.end() : section_end]
        target_lines = re.findall(r"(?mi)^Source Targets:\s*(.*?)\s*$", section)
        if len(target_lines) != 1 or not target_lines[0].strip():
            fail(
                f"decomposition work item {member_id} must contain exactly one non-empty "
                "Source Targets field"
            )
        declared_targets = re.findall(r"[A-Za-z0-9][A-Za-z0-9._-]*", target_lines[0])
        unknown_targets = sorted(set(declared_targets) - source_id_set)
        if unknown_targets:
            fail(
                f"decomposition work item {member_id} names unknown Source Targets: "
                f"{unknown_targets}"
            )
        accounted_sources.update(declared_targets)

    missing_sources = sorted(source_id_set - accounted_sources)
    if missing_sources:
        fail(
            "decomposition Source Targets do not account for every launch source target: "
            f"missing={missing_sources}"
        )

    if not require_closed:
        implementation_target = metadata(ROOT, "gc.var.implementation_target")
        if not implementation_target:
            fail(
                f"workflow root {ROOT_ID} is missing "
                "gc.var.implementation_target for implementation drain validation"
            )
        for member_id in member_ids:
            item = bead(member_id)
            item_status = str(item.get("status") or "").strip()
            item_assignee = str(item.get("assignee") or "").strip()
            item_route = metadata(item, "gc.routed_to")
            if item_status != "open" or item_assignee or item_route:
                fail(
                    f"implementation member {member_id} must remain open, unassigned, "
                    "and unrouted until implementation drain: "
                    f"status={item_status!r} assignee={item_assignee!r} "
                    f"gc.routed_to={item_route!r}"
                )
            item_kind = metadata(item, "gc.kind")
            if item_kind != "implementation":
                fail(
                    f"implementation member {member_id} must record "
                    f"gc.kind=implementation: observed={item_kind!r}"
                )
            accepts_from = metadata(item, "gc.accepts_from")
            if accepts_from != implementation_target:
                fail(
                    f"implementation member {member_id} must record "
                    f"gc.accepts_from={implementation_target}: observed={accepts_from!r}"
                )
        return

    if str(convoy.get("status") or "") != "closed":
        fail(f"implementation convoy {input_convoy_id} is not closed")
    open_rows = [
        f"{row.get('id')}={row.get('status')}"
        for row in rows
        if str(row.get("status") or "") != "closed"
    ]
    if open_rows:
        fail(f"implementation convoy members are not all closed: {open_rows}")

    if not require_worktree_proof:
        return

    launcher_head = command(
        ["git", "-C", str(LAUNCHER_ROOT), "rev-parse", "HEAD"],
        label=f"git rev-parse launcher HEAD at {LAUNCHER_ROOT}",
    ).strip()
    launcher_common_dir = git_common_dir(
        LAUNCHER_ROOT,
        label=f"read launcher git common dir at {LAUNCHER_ROOT}",
    )
    drain_policy = metadata(ROOT, "gc.var.drain_policy") or "separate"
    if drain_policy not in {"separate", "same-session"}:
        fail(f"unsupported gstack drain policy in root metadata: {drain_policy}")

    member_records: list[tuple[str, Path, str, Path]] = []
    observed_summary_paths: set[Path] = set()
    for member_id in member_ids:
        item = bead(member_id)
        if str(item.get("status") or "") != "closed" or metadata(item, "gc.outcome") != "pass":
            fail(f"implementation member {member_id} must be status=closed with gc.outcome=pass")

        raw_worktree = metadata(item, "work_dir")
        recorded_worktree = metadata(item, "gc.implementation.worktree_path")
        if not raw_worktree or not recorded_worktree:
            fail(
                f"implementation member {member_id} must record work_dir and "
                "gc.implementation.worktree_path"
            )
        if not Path(raw_worktree).is_absolute() or not Path(recorded_worktree).is_absolute():
            fail(f"implementation member {member_id} worktree paths must be absolute")
        try:
            worktree = Path(raw_worktree).resolve(strict=True)
            proof_worktree = Path(recorded_worktree).resolve(strict=True)
        except OSError as exc:
            fail(f"implementation member {member_id} has an invalid worktree path: {exc}")
        if worktree != proof_worktree:
            fail(
                f"implementation member {member_id} worktree metadata disagrees: "
                f"work_dir={worktree} gc.implementation.worktree_path={proof_worktree}"
            )
        if worktree == LAUNCHER_ROOT:
            fail(
                f"implementation member {member_id} authoritative worktree must differ "
                f"from launcher checkout {LAUNCHER_ROOT}"
            )
        if not worktree.is_dir():
            fail(f"implementation member {member_id} worktree is not a directory: {worktree}")
        inside = command(
            ["git", "-C", str(worktree), "rev-parse", "--is-inside-work-tree"],
            label=f"validate implementation worktree for {member_id}",
        ).strip()
        if inside != "true":
            fail(f"implementation member {member_id} path is not a git worktree: {worktree}")
        worktree_common_dir = git_common_dir(
            worktree,
            label=f"read implementation git common dir for {member_id}",
        )
        if worktree_common_dir != launcher_common_dir:
            fail(
                f"implementation member {member_id} worktree is not linked to launcher repository: "
                f"worktree_common_dir={worktree_common_dir} "
                f"launcher_common_dir={launcher_common_dir}"
            )

        recorded_commit = metadata(item, "gc.implementation.commit")
        if re.fullmatch(r"[0-9a-f]{40}", recorded_commit) is None:
            fail(f"implementation member {member_id} lacks a full gc.implementation.commit SHA")

        raw_summary_path = metadata(item, "gc.implementation.summary_path")
        if not Path(raw_summary_path).is_absolute():
            fail(f"implementation member {member_id} summary path must be absolute")
        summary_path = resolved_file(
            raw_summary_path,
            key=f"{member_id}.gc.implementation.summary_path",
        )
        try:
            summary_path.relative_to(worktree)
        except ValueError:
            fail(
                f"implementation member {member_id} summary must be inside its authoritative "
                f"implementation worktree: summary={summary_path} worktree={worktree}"
            )
        if summary_path in observed_summary_paths:
            fail(f"implementation members must use distinct summary paths: {summary_path}")
        observed_summary_paths.add(summary_path)
        member_records.append((member_id, worktree, recorded_commit, summary_path))

    member_worktrees = [worktree for _, worktree, _, _ in member_records]
    distinct_worktrees = set(member_worktrees)
    if drain_policy == "same-session" and len(distinct_worktrees) != 1:
        fail(
            "same-session implementation members must share exactly one authoritative "
            f"worktree: observed={sorted(str(path) for path in distinct_worktrees)}"
        )
    if drain_policy == "separate" and len(distinct_worktrees) != len(member_worktrees):
        fail(
            "separate implementation members must use distinct authoritative worktrees: "
            f"observed={member_worktrees}"
        )

    summaries_by_worktree: dict[Path, set[Path]] = {}
    for _, worktree, _, summary_path in member_records:
        summaries_by_worktree.setdefault(worktree, set()).add(summary_path)

    for member_id, worktree, recorded_commit, summary_path in member_records:
        head = command(
            ["git", "-C", str(worktree), "rev-parse", "HEAD"],
            label=f"read implementation HEAD for {member_id}",
        ).strip()
        if drain_policy == "separate" and recorded_commit != head:
            fail(
                f"implementation member {member_id} commit does not match worktree HEAD: "
                f"recorded={recorded_commit} head={head}"
            )
        if drain_policy == "same-session":
            ancestor = subprocess.run(
                ["git", "-C", str(worktree), "merge-base", "--is-ancestor", recorded_commit, head],
                check=False,
            )
            if ancestor.returncode != 0:
                fail(
                    f"implementation member {member_id} commit is not retained in shared "
                    f"worktree HEAD: recorded={recorded_commit} head={head}"
                )
        if recorded_commit == launcher_head:
            fail(f"implementation member {member_id} has no commit beyond launcher HEAD")
        based_on_launcher = subprocess.run(
            [
                "git",
                "-C",
                str(worktree),
                "merge-base",
                "--is-ancestor",
                launcher_head,
                recorded_commit,
            ],
            check=False,
        )
        if based_on_launcher.returncode != 0:
            fail(
                f"implementation member {member_id} commit is not based on launcher HEAD: "
                f"launcher={launcher_head} recorded={recorded_commit}"
            )
        changed_files = command(
            [
                "git",
                "-C",
                str(worktree),
                "diff-tree",
                "--no-commit-id",
                "--name-only",
                "-r",
                recorded_commit,
            ],
            label=f"read implementation commit files for {member_id}",
        ).splitlines()
        if not [path for path in changed_files if path.strip()]:
            fail(f"implementation member {member_id} recorded an empty implementation commit")
        changed_product_files = [
            path
            for path in changed_files
            if path.strip()
            and (worktree / path).resolve() not in summaries_by_worktree[worktree]
        ]
        if not changed_product_files:
            fail(
                f"implementation member {member_id} changed only recorded summary artifacts"
            )
        validate_implementation_summary(
            summary_path,
            label=f"implementation member {member_id} per-item summary",
            upstream_root=worktree,
        )
        item_summary_front = front_matter(summary_path)
        if item_summary_front.get("status") != "approved":
            fail(f"implementation member {member_id} per-item summary must be approved")
        summary = summary_path.read_text(encoding="utf-8", errors="replace")
        required_evidence = (f"beads/{member_id}", str(worktree), recorded_commit)
        missing_evidence = [value for value in required_evidence if value not in summary]
        if missing_evidence:
            fail(
                f"implementation member {member_id} summary lacks exact worktree proof: "
                f"missing={missing_evidence}"
            )
        if re.search(r"(?i)\bpass(?:ed)?\b", summary) is None:
            fail(f"implementation member {member_id} summary has no observed passing proof result")

    for worktree, permitted_summaries in summaries_by_worktree.items():
        raw_status = command(
            [
                "git",
                "-C",
                str(worktree),
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
            ],
            label=f"read complete worktree status at {worktree}",
        )
        unexpected_status: list[str] = []
        for entry in (value for value in raw_status.split("\0") if value):
            if len(entry) >= 4 and entry[2] == " ":
                status_path = (worktree / entry[3:]).resolve()
                if status_path in permitted_summaries:
                    continue
            unexpected_status.append(entry)
        if unexpected_status:
            fail(
                "implementation worktree has uncommitted worktree state outside its "
                f"recorded summary artifacts: worktree={worktree} status={unexpected_status!r}"
            )

    root_summary_path = resolved_file(
        metadata(ROOT, "gc.build.implementation_summary_path"),
        key="gc.build.implementation_summary_path",
    )
    validate_implementation_summary(
        root_summary_path,
        label="canonical implementation summary",
        upstream_root=LAUNCHER_ROOT,
    )
    root_summary_front = front_matter(root_summary_path)
    if root_summary_front.get("status") != "approved":
        fail("canonical implementation summary must be approved")
    if root_summary_front.get("schema") != "gc.build.implementation-summary.v1":
        fail(
            "canonical implementation summary is stale: expected schema "
            f"gc.build.implementation-summary.v1 at {root_summary_path}"
        )
    root_trace = root_summary_front.get("trace")
    root_upstream = root_trace.get("upstream") if isinstance(root_trace, dict) else None
    if not isinstance(root_upstream, list):
        fail("canonical implementation summary is stale: trace.upstream is missing")

    expected_by_summary = {
        summary_path: (member_id, worktree, recorded_commit)
        for member_id, worktree, recorded_commit, summary_path in member_records
    }
    observed_root_summaries: set[Path] = set()
    for entry in root_upstream:
        if not isinstance(entry, dict):
            fail("canonical implementation summary is stale: malformed trace.upstream entry")
        raw_path = entry.get("path")
        if not isinstance(raw_path, str) or not Path(raw_path).is_absolute():
            fail("canonical implementation summary is stale: upstream paths must be absolute")
        try:
            traced_summary = Path(raw_path).resolve(strict=True)
        except OSError as exc:
            fail(f"canonical implementation summary is stale: invalid upstream path: {exc}")
        if traced_summary not in expected_by_summary or traced_summary in observed_root_summaries:
            fail(
                "canonical implementation summary is stale: upstream summary set does not "
                f"match current member metadata: {traced_summary}"
            )
        expected_hash = f"sha256:{hashlib.sha256(traced_summary.read_bytes()).hexdigest()}"
        if str(entry.get("hash") or "") != expected_hash:
            fail(
                "canonical implementation summary is stale: per-item summary digest mismatch: "
                f"summary={traced_summary} expected={expected_hash} "
                f"observed={entry.get('hash')!r}"
            )
        observed_root_summaries.add(traced_summary)
    if observed_root_summaries != set(expected_by_summary):
        missing = sorted(str(path) for path in set(expected_by_summary) - observed_root_summaries)
        fail(
            "canonical implementation summary is stale: missing current per-item summaries: "
            f"{missing}"
        )

    root_summary_text = root_summary_path.read_text(encoding="utf-8", errors="replace")
    for summary_path, (member_id, worktree, recorded_commit) in expected_by_summary.items():
        required_evidence = (member_id, str(worktree), recorded_commit, str(summary_path))
        missing_evidence = [value for value in required_evidence if value not in root_summary_text]
        if missing_evidence:
            fail(
                "canonical implementation summary is stale: current member proof is missing: "
                f"member={member_id} missing={missing_evidence}"
            )


if SCHEMA == "gc.build.requirements.v1":
    pass
elif SCHEMA == "gc.build.decomposition.v1":
    implementation_state(require_closed=False, require_worktree_proof=False)
elif SCHEMA in {"gc.build.implementation-summary.v1", "gc.build.final-report.v1"}:
    implementation_state(require_closed=True, require_worktree_proof=True)
else:
    fail(f"unsupported gstack semantic gate schema: {SCHEMA}")

print(
    f"gstack build state valid: schema={SCHEMA} root={ROOT_ID} "
    f"launch_convoy={LAUNCH_CONVOY_ID}"
)
PY
