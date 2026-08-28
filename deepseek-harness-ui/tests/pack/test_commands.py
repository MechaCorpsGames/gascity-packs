from __future__ import annotations

import os
import pathlib
import shlex
import shutil
import subprocess
import tempfile
import unittest


PACK_DIR = pathlib.Path(__file__).resolve().parents[2]


def write_executable(directory: pathlib.Path, name: str, body: str) -> None:
    path = directory / name
    path.write_text(f"#!/bin/sh\n{body}\n", encoding="utf-8")
    path.chmod(0o755)


class CommandTests(unittest.TestCase):
    def test_web_execs_the_profile_on_loopback_and_preserves_the_ssh_launch_environment(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = pathlib.Path(raw_dir)
            pack_dir = root / "pack"
            bin_dir = root / "bin"
            log_path = root / "dsh.log"
            (pack_dir / "assets").mkdir(parents=True)
            (pack_dir / "doctor").mkdir()
            bin_dir.mkdir()
            log_path.write_text("", encoding="utf-8")
            (pack_dir / "assets" / "versions.env").write_text(
                "DSH_BUILD_VERSION=0.1.1-rc.2\n"
                "NODE_22_MIN=22.19.0\n"
                "NODE_NEXT_MIN=24.0.0\n",
                encoding="utf-8",
            )
            shutil.copy2(
                PACK_DIR / "assets" / "dsh-compatibility.json",
                pack_dir / "assets" / "dsh-compatibility.json",
            )
            for name in ("node", "dsh"):
                shutil.copy2(
                    PACK_DIR / "doctor" / f"check-{name}.sh",
                    pack_dir / "doctor" / f"check-{name}.sh",
                )
            real_node = shutil.which("node")
            self.assertIsNotNone(real_node)
            write_executable(
                bin_dir,
                "node",
                "if [ \"${1:-}\" = --version ]; then printf 'v24.0.0\\n'; exit 0; fi\n"
                f"exec {shlex.quote(real_node)} \"$@\"",
            )
            write_executable(
                bin_dir,
                "dsh",
                "printf 'ssh=%s args=%s\\n' \"${SSH_CONNECTION:-}\" \"$*\" >> \"$DSH_TEST_LOG\"\n"
                "if [ \"${1:-}\" = --version ]; then printf '0.1.1-rc.2\\n'; fi",
            )
            env = os.environ.copy()
            env.update(
                {
                    "GC_PACK_DIR": str(pack_dir),
                    "DSH_TEST_LOG": str(log_path),
                    "SSH_CONNECTION": "192.0.2.10 54000 192.0.2.20 22",
                    "PATH": f"{bin_dir}:{env['PATH']}",
                }
            )
            result = subprocess.run(
                [str(PACK_DIR / "commands" / "web.sh"), "--port", "4100", "--no-open"],
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )
            calls = log_path.read_text(encoding="utf-8").splitlines()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            calls[-1],
            "ssh=192.0.2.10 54000 192.0.2.20 22 args=web --host 127.0.0.1 --port 4100 --no-open",
        )

    def test_web_rejects_a_non_loopback_host_before_starting_dsh(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = pathlib.Path(raw_dir)
            pack_dir = root / "pack"
            bin_dir = root / "bin"
            log_path = root / "dsh.log"
            (pack_dir / "assets").mkdir(parents=True)
            (pack_dir / "doctor").mkdir()
            bin_dir.mkdir()
            log_path.write_text("", encoding="utf-8")
            (pack_dir / "assets" / "versions.env").write_text(
                "DSH_BUILD_VERSION=0.1.1-rc.2\n"
                "NODE_22_MIN=22.19.0\n"
                "NODE_NEXT_MIN=24.0.0\n",
                encoding="utf-8",
            )
            shutil.copy2(
                PACK_DIR / "assets" / "dsh-compatibility.json",
                pack_dir / "assets" / "dsh-compatibility.json",
            )
            for name in ("node", "dsh"):
                shutil.copy2(
                    PACK_DIR / "doctor" / f"check-{name}.sh",
                    pack_dir / "doctor" / f"check-{name}.sh",
                )
            real_node = shutil.which("node")
            self.assertIsNotNone(real_node)
            write_executable(
                bin_dir,
                "node",
                "if [ \"${1:-}\" = --version ]; then printf 'v24.0.0\\n'; exit 0; fi\n"
                f"exec {shlex.quote(real_node)} \"$@\"",
            )
            write_executable(
                bin_dir,
                "dsh",
                "printf '%s\\n' \"$*\" >> \"$DSH_TEST_LOG\"\n"
                "if [ \"${1:-}\" = --version ]; then printf '0.1.1-rc.2\\n'; fi",
            )
            env = os.environ.copy()
            env.update(
                {
                    "GC_PACK_DIR": str(pack_dir),
                    "DSH_TEST_LOG": str(log_path),
                    "PATH": f"{bin_dir}:{env['PATH']}",
                }
            )
            result = subprocess.run(
                [str(PACK_DIR / "commands" / "web.sh"), "--host", "0.0.0.0"],
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )
            calls = log_path.read_text(encoding="utf-8").splitlines()

        self.assertEqual(result.returncode, 2)
        self.assertIn("loopback-only", result.stdout)
        self.assertNotIn("web --host", "\n".join(calls))


if __name__ == "__main__":
    unittest.main()
