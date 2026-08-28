from __future__ import annotations

import os
import hashlib
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


def copy_dsh_compatibility(pack_dir: pathlib.Path) -> None:
    shutil.copy2(
        PACK_DIR / "assets" / "dsh-compatibility.json",
        pack_dir / "assets" / "dsh-compatibility.json",
    )


class InstallTests(unittest.TestCase):
    def test_install_rejects_a_tampered_artifact_before_plugin_add(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = pathlib.Path(raw_dir)
            pack_dir = root / "pack"
            bin_dir = root / "bin"
            log_path = root / "dsh.log"
            (pack_dir / "assets" / "dist").mkdir(parents=True)
            (pack_dir / "doctor").mkdir()
            bin_dir.mkdir()

            (pack_dir / "assets" / "dist" / "plugin.tgz").write_bytes(b"tampered")
            (pack_dir / "assets" / "versions.env").write_text(
                "PLUGIN_PACKAGE=@gastownhall/deepseek-harness-ui\n"
                "PLUGIN_ARTIFACT=plugin.tgz\n"
                "PLUGIN_SHA256=" + "0" * 64 + "\n"
                "DSH_BUILD_VERSION=0.1.1-rc.2\n"
                "PNPM_VERSION=11.7.0\n"
                "NODE_22_MIN=22.19.0\n"
                "NODE_NEXT_MIN=24.0.0\n",
                encoding="utf-8",
            )
            copy_dsh_compatibility(pack_dir)
            for name in ("node", "dsh", "pnpm", "artifact"):
                shutil.copy2(
                    PACK_DIR / "doctor" / f"check-{name}.sh",
                    pack_dir / "doctor" / f"check-{name}.sh",
                )

            real_node = shutil.which("node")
            self.assertIsNotNone(real_node)
            write_executable(
                bin_dir,
                "node",
                "if [ \"${1:-}\" = --version ]; then printf 'v22.19.0\\n'; exit 0; fi\n"
                f"exec {shlex.quote(real_node)} \"$@\"",
            )
            write_executable(bin_dir, "pnpm", "printf '11.7.0\\n'")
            write_executable(
                bin_dir,
                "dsh",
                "printf '%s\\n' \"$*\" >> \"$DSH_TEST_LOG\"\n"
                "if [ \"${1:-}\" = --version ]; then printf '0.1.1-rc.2\\n'; exit 0; fi\n"
                "exit 99",
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
                [str(PACK_DIR / "commands" / "install.sh")],
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )

            calls = log_path.read_text(encoding="utf-8")

        self.assertEqual(result.returncode, 2)
        self.assertIn("checksum mismatch", result.stdout)
        self.assertNotIn("plugin --profile web add", calls)

    def test_install_allows_a_newer_dsh_with_an_explicit_unverified_browser_warning(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = pathlib.Path(raw_dir)
            pack_dir = root / "pack"
            bin_dir = root / "bin"
            dsh_home = root / "dsh-home"
            log_path = root / "dsh.log"
            artifact = pack_dir / "assets" / "dist" / "plugin.tgz"
            artifact.parent.mkdir(parents=True)
            (pack_dir / "doctor").mkdir()
            bin_dir.mkdir()
            artifact.write_bytes(b"verified plugin artifact")
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            (pack_dir / "assets" / "versions.env").write_text(
                "PLUGIN_PACKAGE=@gastownhall/deepseek-harness-ui\n"
                "PLUGIN_ARTIFACT=plugin.tgz\n"
                f"PLUGIN_SHA256={digest}\n"
                "DSH_BUILD_VERSION=0.1.1-rc.2\n"
                "PNPM_VERSION=11.7.0\n"
                "NODE_22_MIN=22.19.0\n"
                "NODE_NEXT_MIN=24.0.0\n",
                encoding="utf-8",
            )
            copy_dsh_compatibility(pack_dir)
            for name in ("node", "dsh", "pnpm", "artifact", "profile", "listener"):
                shutil.copy2(
                    PACK_DIR / "doctor" / f"check-{name}.sh",
                    pack_dir / "doctor" / f"check-{name}.sh",
                )

            real_node = shutil.which("node")
            self.assertIsNotNone(real_node)
            write_executable(
                bin_dir,
                "node",
                "if [ \"${1:-}\" = --version ]; then printf 'v22.19.0\\n'; exit 0; fi\n"
                f"exec {shlex.quote(real_node)} \"$@\"",
            )
            write_executable(bin_dir, "pnpm", "printf '11.7.0\\n'")
            write_executable(
                bin_dir,
                "dsh",
                "printf '%s\\n' \"$*\" >> \"$DSH_TEST_LOG\"\n"
                "case \"$*\" in\n"
                "  --version) printf '0.1.2-rc.1\\n' ;;\n"
                "  'plugin --profile web add --save-exact '*)\n"
                "    mkdir -p \"$DSH_HOME/profiles/web\"\n"
                "    printf '%s\\n' '{\"dependencies\":{\"@gastownhall/deepseek-harness-ui\":\"file:plugin.tgz\"},\"dsh\":{\"profile\":{\"bundles\":[\"@deepseek-ai/dsh-base\",\"@deepseek-ai/dsh-web-app\",\"@gastownhall/deepseek-harness-ui\"]}}}' > \"$DSH_HOME/profiles/web/package.json\" ;;\n"
                "  '--profile web --dump-config') printf '# == @gastownhall/deepseek-harness-ui\\n' ;;\n"
                "  web*)\n"
                "    exec python3 - <<'PY'\n"
                "import http.server\n"
                "import socketserver\n"
                "class Handler(http.server.BaseHTTPRequestHandler):\n"
                "    def do_GET(self):\n"
                "        if self.path == '/api/gas-city/v1/connections':\n"
                "            self.send_response(200)\n"
                "            self.send_header('Content-Type', 'application/json')\n"
                "            self.end_headers()\n"
                "            self.wfile.write(b'{\"connections\":[]}')\n"
                "        else:\n"
                "            self.send_response(404)\n"
                "            self.end_headers()\n"
                "    def log_message(self, *_args):\n"
                "        pass\n"
                "with socketserver.TCPServer(('127.0.0.1', 0), Handler) as server:\n"
                "    print(f'http://127.0.0.1:{server.server_address[1]}', flush=True)\n"
                "    server.serve_forever()\n"
                "PY\n"
                "    ;;\n"
                "  *) exit 97 ;;\n"
                "esac",
            )

            env = os.environ.copy()
            env.update(
                {
                    "GC_PACK_DIR": str(pack_dir),
                    "DSH_HOME": str(dsh_home),
                    "DSH_TEST_LOG": str(log_path),
                    "PATH": f"{bin_dir}:{env['PATH']}",
                }
            )
            result = subprocess.run(
                [str(PACK_DIR / "commands" / "install.sh")],
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )
            calls = log_path.read_text(encoding="utf-8").splitlines()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            f"plugin --profile web add --save-exact {artifact}",
            calls,
        )
        self.assertIn("--profile web --dump-config", calls)
        self.assertIn("web --host 127.0.0.1 --port 0 --no-open", calls)
        self.assertIn("not yet certified", result.stdout)
        self.assertIn("browser compatibility is unverified", result.stdout)
        self.assertIn("gc <binding> web", result.stdout)


if __name__ == "__main__":
    unittest.main()
