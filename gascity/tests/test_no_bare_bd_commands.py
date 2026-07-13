from __future__ import annotations

import ast
from pathlib import Path
import re
import subprocess


REPO_ROOT = Path(__file__).resolve().parents[2]
THIS_FILE = Path(__file__).resolve()

BD_SUBCOMMANDS = (
    "admin",
    "ado",
    "assign",
    "audit",
    "backup",
    "batch",
    "blocked",
    "bootstrap",
    "branch",
    "children",
    "close",
    "comment",
    "comments",
    "compact",
    "completion",
    "config",
    "context",
    "cook",
    "count",
    "create",
    "create-form",
    "defer",
    "delete",
    "dep",
    "diff",
    "doctor",
    "dolt",
    "duplicate",
    "duplicates",
    "edit",
    "epic",
    "export",
    "federation",
    "find-duplicates",
    "flatten",
    "forget",
    "formula",
    "gate",
    "gc",
    "github",
    "gitlab",
    "graph",
    "heartbeat",
    "help",
    "history",
    "hooks",
    "human",
    "import",
    "info",
    "init",
    "init-safety",
    "jira",
    "kv",
    "label",
    "linear",
    "link",
    "list",
    "lint",
    "mail",
    "memories",
    "merge-slot",
    "meta",
    "metrics",
    "migrate",
    "migrate-personal",
    "mol",
    "note",
    "notion",
    "onboard",
    "orphans",
    "ping",
    "preflight",
    "prime",
    "priority",
    "promote",
    "prune",
    "purge",
    "q",
    "query",
    "quickstart",
    "ready",
    "recall",
    "reclaim",
    "recompute-blocked",
    "remember",
    "rename-prefix",
    "rename",
    "reopen",
    "repo",
    "restore",
    "rules",
    "search",
    "set-state",
    "setup",
    "show",
    "ship",
    "sql",
    "stale",
    "state",
    "status",
    "statuses",
    "supersede",
    "swarm",
    "sync",
    "tag",
    "todo",
    "type",
    "types",
    "unclaim",
    "undefer",
    "update",
    "upgrade",
    "vc",
    "version",
    "where",
    "worktree",
)
BD_SUBCOMMAND_PATTERN = "|".join(re.escape(command) for command in BD_SUBCOMMANDS)
BARE_BD_COMMAND = re.compile(rf"\bbd[ \t]+(?:{BD_SUBCOMMAND_PATTERN})\b")
MULTILINE_BARE_BD_COMMAND = re.compile(
    rf"\bbd[ \t]*\r?\n[ \t]*(?:{BD_SUBCOMMAND_PATTERN})\b"
)
BARE_BD_GO_EXEC = re.compile(
    r'(?:exec\.Command(?:Context)?|dispatchExecCommand)\(\s*["\']bd["\']'
)
BARE_BD_PATH_CHECK = re.compile(r"\bcommand[ \t]+-v[ \t]+bd\b")
BARE_BD_SERIALIZED_ARGV = re.compile(
    rf'''(?:\[|\{{|=|:)[ \t]*["']bd["'][ \t]*,[ \t]*["'](?:{BD_SUBCOMMAND_PATTERN})["']'''
)
GC_BD_ARGV_TAIL_MARKER = "gc-bd-argv-tail"


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    )
    return [
        REPO_ROOT / path
        for path in result.stdout.decode().split("\0")
        if path.startswith("gascity/")
    ]


def python_argv_violations(path: Path, text: str) -> list[str]:
    if path.suffix != ".py":
        return []
    tree = ast.parse(text, filename=str(path))
    violations = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.List, ast.Tuple)) or not node.elts:
            continue
        first = node.elts[0]
        if isinstance(first, ast.Constant) and first.value == "bd":
            violations.append(f"{path.relative_to(REPO_ROOT)}:{node.lineno}: argv starts with bd")
    return violations


def bare_bd_violations(path: Path, text: str) -> list[str]:
    violations = []
    relative = path.relative_to(REPO_ROOT)
    for line_number, line in enumerate(text.splitlines(), start=1):
        if GC_BD_ARGV_TAIL_MARKER in line:
            continue
        for match in BARE_BD_COMMAND.finditer(line):
            before = line[: match.start()]
            if re.search(r"\bgc[ \t]+$", before):
                continue
            violations.append(f"{relative}:{line_number}: {line.strip()}")
        if BARE_BD_GO_EXEC.search(line):
            violations.append(f"{relative}:{line_number}: direct bd argv")
        if BARE_BD_PATH_CHECK.search(line):
            violations.append(f"{relative}:{line_number}: checks bd instead of gc")
        if BARE_BD_SERIALIZED_ARGV.search(line):
            violations.append(f"{relative}:{line_number}: serialized argv starts with bd")
        if "BD_BIN" in line:
            violations.append(f"{relative}:{line_number}: BD_BIN bypasses gc bd routing")
    for match in MULTILINE_BARE_BD_COMMAND.finditer(text):
        if re.search(r"\bgc[ \t]+$", text[: match.start()]):
            continue
        line_number = text.count("\n", 0, match.start()) + 1
        violations.append(f"{relative}:{line_number}: bd command is split across lines")
    violations.extend(python_argv_violations(path, text))
    return violations


def test_gascity_pack_assets_route_beads_commands_through_gc() -> None:
    violations = []
    for path in tracked_files():
        if path.resolve() == THIS_FILE:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        violations.extend(bare_bd_violations(path, text))

    assert not violations, "bare bd commands bypass store-aware routing:\n" + "\n".join(violations)


def test_detector_covers_shell_multiline_and_serialized_argv_forms() -> None:
    fixture = REPO_ROOT / "fixture.txt"

    assert bare_bd_violations(fixture, 'command = ["bd", "show"]')
    assert bare_bd_violations(fixture, "value=$(bd\n  list --json)")
    assert not bare_bd_violations(fixture, 'command = ["gc", "bd", "show"]')
