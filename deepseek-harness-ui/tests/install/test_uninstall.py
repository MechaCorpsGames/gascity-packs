from __future__ import annotations

import os
import pathlib
import shutil
import shlex
import subprocess
import tempfile
import unittest


PACK_DIR = pathlib.Path(__file__).resolve().parents[2]


def write_executable(directory: pathlib.Path, name: str, body: str) -> None:
    path = directory / name
    path.write_text(f"#!/bin/sh\n{body}\n", encoding="utf-8")
    path.chmod(0o755)


class UninstallTests(unittest.TestCase):
    def test_uninstall_removes_only_the_pack_package_with_runtime_prerequisites(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = pathlib.Path(raw_dir)
            pack_dir = root / "pack"
            bin_dir = root / "bin"
            gc_home = root / "gc-home"
            log_path = root / "dsh.log"
            (pack_dir / "assets").mkdir(parents=True)
            (pack_dir / "doctor").mkdir()
            bin_dir.mkdir()
            gc_home.mkdir()
            supervisor = gc_home / "supervisor.toml"
            contexts = gc_home / "contexts.toml"
            supervisor.write_text("listen_port = 8372\n", encoding="utf-8")
            contexts.write_text("[contexts.remote]\nurl = 'https://gc.example'\n", encoding="utf-8")
            before = (supervisor.read_bytes(), contexts.read_bytes())

            (pack_dir / "assets" / "versions.env").write_text(
                "PLUGIN_PACKAGE=@gastownhall/deepseek-harness-ui\n"
                "DSH_BUILD_VERSION=0.1.1-rc.2\n"
                "PNPM_VERSION=11.7.0\n"
                "NODE_22_MIN=22.19.0\n"
                "NODE_NEXT_MIN=24.0.0\n",
                encoding="utf-8",
            )
            shutil.copy2(
                PACK_DIR / "assets" / "dsh-compatibility.json",
                pack_dir / "assets" / "dsh-compatibility.json",
            )
            for name in ("node", "dsh", "pnpm"):
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
            write_executable(bin_dir, "pnpm", "printf '11.7.0\\n'")
            write_executable(
                bin_dir,
                "dsh",
                "printf '%s\\n' \"$*\" >> \"$DSH_TEST_LOG\"\n"
                "if [ \"${1:-}\" = --version ]; then printf '0.1.1-rc.2\\n'; exit 0; fi\n"
                "if [ \"$*\" = 'plugin --profile web remove @gastownhall/deepseek-harness-ui' ]; then exit 0; fi\n"
                "exit 97",
            )
            env = os.environ.copy()
            env.update(
                {
                    "GC_HOME": str(gc_home),
                    "GC_PACK_DIR": str(pack_dir),
                    "DSH_TEST_LOG": str(log_path),
                    "PATH": f"{bin_dir}:{env['PATH']}",
                }
            )
            result = subprocess.run(
                [str(PACK_DIR / "commands" / "uninstall.sh")],
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )
            calls = log_path.read_text(encoding="utf-8").splitlines()
            after = (supervisor.read_bytes(), contexts.read_bytes())

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            "plugin --profile web remove @gastownhall/deepseek-harness-ui",
            calls,
        )
        self.assertEqual(after, before)


if __name__ == "__main__":
    unittest.main()
