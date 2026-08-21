"""Run the shipped shared-drain worktree gate against real git repositories.

`gascity/assets/scripts/checks/prepare-shared-worktree.sh` is the only writer of
the `work_dir` metadata that every same-session shared-drain item reads. Nothing
about that contract is observable by reading the file, so this test executes it:
it builds a launcher checkout and a bare origin on disk, puts a fake `gc` on PATH
that answers `gc bd show` and `gc bd update` out of a JSON fixture directory, and
asserts what the script did to the filesystem and to the fixtures.

Two deliberate fixture choices carry the load:

* the default branch is named `trunk`, so a resolution that falls back to `main`
  fails on the wrong answer rather than on absence;
* the launcher's local `HEAD` is one commit AHEAD of `origin/trunk`, so a script
  that based the worktree on `HEAD` -- which is what the upstream pattern did --
  produces a detectably wrong base instead of an indistinguishable one.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "gascity/assets/scripts/checks/prepare-shared-worktree.sh"
ERROR_PREFIX = "gc-shared-worktree:"

# A `gc` that is only ever asked the two questions the gate asks. Writing it out
# rather than mocking keeps the test honest about the command line the script
# actually builds: a typo in `--set-metadata` fails here.
FAKE_GC = '''#!/usr/bin/env python3
import json
import sys
from pathlib import Path

beads = Path(sys.argv[0]).resolve().parent.parent / "beads"
argv = sys.argv[1:]
if argv[:1] != ["bd"]:
    sys.exit("fake gc: only `gc bd` is supported, got: " + " ".join(argv))

command = argv[1]
bead_id = argv[2]
path = beads / (bead_id + ".json")
if not path.is_file():
    sys.exit("fake gc: no such bead: " + bead_id)
bead = json.loads(path.read_text())

if command == "show":
    if "--json" not in argv:
        sys.exit("fake gc: `gc bd show` must be called with --json")
    print(json.dumps(bead))
elif command == "update":
    if argv[3] != "--set-metadata":
        sys.exit("fake gc: `gc bd update` must be called with --set-metadata")
    key, _, value = argv[4].partition("=")
    bead.setdefault("metadata", {})[key] = value
    path.write_text(json.dumps(bead))
else:
    sys.exit("fake gc: unsupported subcommand: " + command)
'''


def git(*args: str, cwd: Path) -> str:
    proc = subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    )
    return proc.stdout.strip()


class PrepareSharedWorktreeTest(unittest.TestCase):
    def setUp(self) -> None:
        for tool in ("git", "python3"):
            if not shutil.which(tool):
                self.skipTest(f"{tool} is not available")
        # Canonical: the script reports canonical paths (`pwd -P`), so a
        # symlinked temp root would make every path assertion here a coin flip.
        self.tmp = Path(tempfile.mkdtemp(prefix="shared-worktree-")).resolve()
        self.addCleanup(shutil.rmtree, self.tmp, True)

        seed = self.tmp / "seed"
        seed.mkdir()
        git("init", "--initial-branch", "trunk", cwd=seed)
        git("config", "user.email", "test@example.invalid", cwd=seed)
        git("config", "user.name", "test", cwd=seed)
        (seed / "README").write_text("seed\n", encoding="utf-8")
        git("add", "README", cwd=seed)
        git("commit", "-m", "seed", cwd=seed)

        self.origin = self.tmp / "origin.git"
        git("clone", "--bare", str(seed), str(self.origin), cwd=self.tmp)

        self.launcher = self.tmp / "launcher"
        git("clone", str(self.origin), str(self.launcher), cwd=self.tmp)
        git("config", "user.email", "test@example.invalid", cwd=self.launcher)
        git("config", "user.name", "test", cwd=self.launcher)
        self.origin_tip = git("rev-parse", "origin/trunk", cwd=self.launcher)

        # The control: local work the remote has never seen. Basing the shared
        # worktree here instead of on origin/trunk is the bug this guards.
        (self.launcher / "LOCAL").write_text("unpushed\n", encoding="utf-8")
        git("add", "LOCAL", cwd=self.launcher)
        git("commit", "-m", "unpushed local work", cwd=self.launcher)
        self.launcher_head = git("rev-parse", "HEAD", cwd=self.launcher)
        self.assertNotEqual(self.launcher_head, self.origin_tip)

        self.beads = self.tmp / "beads"
        self.beads.mkdir()
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir()
        fake_gc = bin_dir / "gc"
        fake_gc.write_text(FAKE_GC, encoding="utf-8")
        fake_gc.chmod(0o755)
        self.path = f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"

    # --- fixtures ---------------------------------------------------------

    def write_bead(self, bead_id: str, metadata: dict[str, str]) -> None:
        (self.beads / f"{bead_id}.json").write_text(
            json.dumps({"id": bead_id, "metadata": metadata}), encoding="utf-8"
        )

    def read_bead(self, bead_id: str) -> dict:
        return json.loads((self.beads / f"{bead_id}.json").read_text(encoding="utf-8"))

    def run_script(
        self, *args: str, bead_id: str | None = None
    ) -> subprocess.CompletedProcess[str]:
        env = dict(os.environ, PATH=self.path)
        env.pop("GC_BEAD_ID", None)
        if bead_id is not None:
            env["GC_BEAD_ID"] = bead_id
        return subprocess.run(
            ["bash", str(SCRIPT), *args],
            cwd=self.tmp,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def assert_failed_closed(
        self, proc: subprocess.CompletedProcess[str], fragment: str
    ) -> None:
        self.assertNotEqual(proc.returncode, 0, f"expected failure, got:\n{proc.stdout}")
        self.assertIn(ERROR_PREFIX, proc.stderr)
        self.assertIn(fragment, proc.stderr)

    def worktree_dirs(self) -> list[str]:
        container = self.launcher / "worktrees"
        if not container.is_dir():
            return []
        return sorted(child.name for child in container.iterdir())

    # --- the happy paths --------------------------------------------------

    def test_it_creates_the_worktree_on_the_remote_default_branch(self) -> None:
        self.write_bead("anchor-1", {})
        proc = self.run_script(str(self.launcher), "drain-1", "anchor-1")
        self.assertEqual(proc.returncode, 0, proc.stderr)

        worktree = self.launcher / "worktrees" / "shared-drain-1"
        self.assertEqual(proc.stdout.strip(), str(worktree))
        self.assertTrue(worktree.is_dir())
        self.assertEqual(
            git("rev-parse", "HEAD", cwd=worktree),
            self.origin_tip,
            "the shared worktree must be based on the fetched remote default "
            "branch, not on the launcher's local HEAD",
        )
        self.assertFalse((worktree / "LOCAL").exists())

    def test_it_persists_work_dir_on_the_source_anchor(self) -> None:
        self.write_bead("anchor-1", {})
        proc = self.run_script(str(self.launcher), "drain-1", "anchor-1")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(
            self.read_bead("anchor-1")["metadata"]["work_dir"],
            str(self.launcher / "worktrees" / "shared-drain-1"),
        )

    def test_a_second_item_reuses_the_same_worktree_without_the_remote(self) -> None:
        """The point of a shared drain: item 2 sees item 1's commits.

        The remote is unreachable for the second run, so a reuse path that
        re-fetched would fail here rather than pass quietly.
        """
        self.write_bead("anchor-1", {})
        self.write_bead("anchor-2", {})
        first = self.run_script(str(self.launcher), "drain-1", "anchor-1")
        self.assertEqual(first.returncode, 0, first.stderr)

        worktree = self.launcher / "worktrees" / "shared-drain-1"
        (worktree / "ITEM1").write_text("done\n", encoding="utf-8")
        git("add", "ITEM1", cwd=worktree)
        git("commit", "-m", "item 1", cwd=worktree)
        item_one_commit = git("rev-parse", "HEAD", cwd=worktree)

        self.origin.rename(self.tmp / "origin.git.moved")
        second = self.run_script(str(self.launcher), "drain-1", "anchor-2")
        self.assertEqual(second.returncode, 0, second.stderr)

        self.assertEqual(second.stdout.strip(), str(worktree))
        self.assertEqual(self.worktree_dirs(), ["shared-drain-1"])
        self.assertEqual(git("rev-parse", "HEAD", cwd=worktree), item_one_commit)
        self.assertEqual(
            self.read_bead("anchor-2")["metadata"]["work_dir"], str(worktree)
        )

    def test_formula_check_mode_resolves_everything_from_beads(self) -> None:
        """The production path: no arguments, only $GC_BEAD_ID."""
        self.write_bead("step-1", {"gc.root_bead_id": "root-1"})
        self.write_bead(
            "root-1",
            {
                "gc.work_dir": str(self.launcher),
                "gc.drain_control_id": "drain-1",
                "gc.drain_member_id": "anchor-1",
                "gc.drain_index": "0",
            },
        )
        self.write_bead("anchor-1", {})

        proc = self.run_script(bead_id="step-1")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        worktree = self.launcher / "worktrees" / "shared-drain-1"
        self.assertEqual(proc.stdout.strip(), str(worktree))
        self.assertEqual(
            self.read_bead("anchor-1")["metadata"]["work_dir"], str(worktree)
        )
        # The item root is not the anchor; nothing may be stamped on it.
        self.assertNotIn("work_dir", self.read_bead("root-1")["metadata"])

    # --- the fail-closed paths --------------------------------------------

    def test_it_rejects_an_anchor_recorded_against_another_worktree(self) -> None:
        stale = self.tmp / "stale"
        stale.mkdir()
        self.write_bead("anchor-1", {"work_dir": str(stale)})
        self.assert_failed_closed(
            self.run_script(str(self.launcher), "drain-1", "anchor-1"),
            "points at a different worktree",
        )

    def test_it_rejects_a_shared_path_that_resolves_to_the_launcher(self) -> None:
        """A symlinked worktree dir is the realistic way this happens."""
        container = self.launcher / "worktrees"
        container.mkdir()
        (container / "shared-drain-1").symlink_to(self.launcher)
        self.write_bead("anchor-1", {})
        self.assert_failed_closed(
            self.run_script(str(self.launcher), "drain-1", "anchor-1"),
            "must differ from launcher checkout",
        )

    def test_it_rejects_a_non_numeric_drain_index(self) -> None:
        self.write_bead("step-1", {"gc.root_bead_id": "root-1"})
        self.write_bead(
            "root-1",
            {
                "gc.work_dir": str(self.launcher),
                "gc.drain_control_id": "drain-1",
                "gc.drain_member_id": "anchor-1",
                "gc.drain_index": "second",
            },
        )
        self.write_bead("anchor-1", {})
        self.assert_failed_closed(
            self.run_script(bead_id="step-1"), "invalid gc.drain_index"
        )

    def test_it_rejects_a_step_without_a_root_bead(self) -> None:
        self.write_bead("step-1", {})
        self.assert_failed_closed(
            self.run_script(bead_id="step-1"), "missing gc.root_bead_id"
        )

    def test_it_waits_rather_than_guessing_when_the_root_has_no_work_dir(self) -> None:
        """gc.work_dir arrives on the item root from a later reconcile tick.

        Guessing a launcher root would create the drain's worktree in whatever
        repository the check happened to run from, so the gate fails and lets
        its retry budget cover the gap.
        """
        self.write_bead("step-1", {"gc.root_bead_id": "root-1"})
        self.write_bead(
            "root-1",
            {
                "gc.drain_control_id": "drain-1",
                "gc.drain_member_id": "anchor-1",
                "gc.drain_index": "0",
            },
        )
        self.write_bead("anchor-1", {})
        self.assert_failed_closed(
            self.run_script(bead_id="step-1"), "has no gc.work_dir yet"
        )
        self.assertEqual(self.worktree_dirs(), [])

    def test_it_rejects_an_unusable_drain_control_id(self) -> None:
        self.write_bead("anchor-1", {})
        self.assert_failed_closed(
            self.run_script(str(self.launcher), "../escape", "anchor-1"),
            "invalid drain control id",
        )


if __name__ == "__main__":
    unittest.main()
