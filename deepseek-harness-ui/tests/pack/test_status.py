from __future__ import annotations

import hashlib
import http.server
import json
import os
import pathlib
import shlex
import shutil
import subprocess
import tempfile
import threading
import unittest


PACK_DIR = pathlib.Path(__file__).resolve().parents[2]


def write_executable(directory: pathlib.Path, name: str, body: str) -> None:
    path = directory / name
    path.write_text(f"#!/bin/sh\n{body}\n", encoding="utf-8")
    path.chmod(0o755)


class StatusTests(unittest.TestCase):
    def test_default_status_reports_local_facts_without_invoking_helpers(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = pathlib.Path(raw_dir)
            pack_dir = root / "pack"
            bin_dir = root / "bin"
            dsh_home = root / "dsh-home"
            gc_home = root / "gc-home"
            helper_log = root / "helper.log"
            artifact = pack_dir / "assets" / "dist" / "plugin.tgz"
            artifact.parent.mkdir(parents=True)
            (pack_dir / "doctor").mkdir()
            (dsh_home / "profiles" / "web").mkdir(parents=True)
            gc_home.mkdir()
            bin_dir.mkdir()
            artifact.write_bytes(b"verified plugin artifact")
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            (pack_dir / "assets" / "versions.env").write_text(
                "PACK_VERSION=0.1.0\n"
                "PLUGIN_PACKAGE=@gastownhall/deepseek-harness-ui\n"
                "PLUGIN_ARTIFACT=plugin.tgz\n"
                f"PLUGIN_SHA256={digest}\n"
                "DSH_VERSION=0.1.1-rc.2\n"
                "PNPM_VERSION=11.7.0\n"
                "NODE_22_MIN=22.19.0\n"
                "NODE_NEXT_MIN=24.0.0\n",
                encoding="utf-8",
            )
            for name in ("node", "dsh", "pnpm", "artifact", "profile"):
                shutil.copy2(
                    PACK_DIR / "doctor" / f"check-{name}.sh",
                    pack_dir / "doctor" / f"check-{name}.sh",
                )
            (dsh_home / "profiles" / "web" / "package.json").write_text(
                json.dumps(
                    {
                        "dependencies": {
                            "@gastownhall/deepseek-harness-ui": "file:plugin.tgz"
                        },
                        "dsh": {
                            "profile": {
                                "bundles": [
                                    "@deepseek-ai/dsh-base",
                                    "@deepseek-ai/dsh-web-app",
                                    "@gastownhall/deepseek-harness-ui",
                                ]
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            (gc_home / "contexts.toml").write_text(
                "[[context]]\n"
                "name = 'remote'\n"
                "url = 'https://gc.example'\n"
                "credential_command = 'credential-helper'\n"
                "grant_command = 'grant-helper'\n",
                encoding="utf-8",
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
                "case \"$*\" in\n"
                "  --version) printf '0.1.1-rc.2\\n' ;;\n"
                "  '--profile web --dump-config') printf '# == @gastownhall/deepseek-harness-ui\\n' ;;\n"
                "  *) exit 97 ;;\n"
                "esac",
            )
            write_executable(
                bin_dir,
                "credential-helper",
                "printf 'credential\\n' >> \"$HELPER_TEST_LOG\"",
            )
            write_executable(
                bin_dir,
                "grant-helper",
                "printf 'grant\\n' >> \"$HELPER_TEST_LOG\"",
            )
            env = os.environ.copy()
            env.update(
                {
                    "DSH_HOME": str(dsh_home),
                    "GC_HOME": str(gc_home),
                    "GC_PACK_DIR": str(pack_dir),
                    "HELPER_TEST_LOG": str(helper_log),
                    "PATH": f"{bin_dir}:{env['PATH']}",
                }
            )
            result = subprocess.run(
                [str(PACK_DIR / "commands" / "status.sh")],
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(helper_log.exists(), "default status invoked a credential/grant helper")
        self.assertIn("pack version: 0.1.0", result.stdout)
        self.assertIn("live Supervisor checks: skipped", result.stdout)

    def test_check_status_runs_gc_and_live_supervisor_diagnostics(self) -> None:
        required_literals = json.loads(
            (PACK_DIR / "assets" / "supervisor-contract.json").read_text(encoding="utf-8")
        )["required_schema_literals"]
        required_paths = {
            "/v0/cities": {"get": {}},
            "/v0/city/{cityName}/events/stream": {"get": {}},
            "/v0/city/{cityName}/config": {"get": {}},
            "/v0/city/{cityName}/rigs": {"get": {}},
            "/v0/city/{cityName}/agents": {"get": {}},
            "/v0/city/{cityName}/providers/public": {"get": {}},
            "/v0/city/{cityName}/sessions": {"get": {}, "post": {}},
            "/v0/city/{cityName}/session/{id}": {"get": {}},
            "/v0/city/{cityName}/session/{id}/transcript": {"get": {}},
            "/v0/city/{cityName}/session/{id}/pending": {"get": {}},
            "/v0/city/{cityName}/session/{id}/stream": {"get": {}},
            "/v0/city/{cityName}/session/{id}/submit": {"post": {}},
            "/v0/city/{cityName}/session/{id}/respond": {"post": {}},
            "/v0/city/{cityName}/session/{id}/permission-mode": {"post": {}},
            "/v0/city/{cityName}/session/{id}/rename": {"post": {}},
            "/v0/city/{cityName}/session/{id}/stop": {"post": {}},
            "/v0/city/{cityName}/session/{id}/kill": {"post": {}},
            "/v0/city/{cityName}/session/{id}/suspend": {"post": {}},
            "/v0/city/{cityName}/session/{id}/close": {"post": {}},
            "/v0/city/{cityName}/session/{id}/wake": {"post": {}},
        }

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if self.path == "/health":
                    body = {"status": "ok"}
                elif self.path == "/openapi.json":
                    body = {
                        "openapi": "3.1.0",
                        "paths": required_paths,
                        "components": {"schemas": {"PackContract": {"enum": required_literals}}},
                    }
                elif self.path == "/v0/cities":
                    body = {"items": [{"name": "alpha", "running": True}]}
                elif self.path == "/v0/city/alpha/rigs":
                    body = {"items": []}
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                encoded = json.dumps(body).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, *_args: object) -> None:
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as raw_dir:
                root = pathlib.Path(raw_dir)
                pack_dir = root / "pack"
                bin_dir = root / "bin"
                dsh_home = root / "dsh-home"
                gc_home = root / "gc-home"
                artifact = pack_dir / "assets" / "dist" / "plugin.tgz"
                artifact.parent.mkdir(parents=True)
                (pack_dir / "doctor").mkdir()
                (dsh_home / "profiles" / "web").mkdir(parents=True)
                gc_home.mkdir()
                bin_dir.mkdir()
                artifact.write_bytes(b"verified plugin artifact")
                digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
                (pack_dir / "assets" / "versions.env").write_text(
                    "PACK_VERSION=0.1.0\n"
                    "PLUGIN_PACKAGE=@gastownhall/deepseek-harness-ui\n"
                    "PLUGIN_ARTIFACT=plugin.tgz\n"
                    f"PLUGIN_SHA256={digest}\n"
                    "DSH_VERSION=0.1.1-rc.2\n"
                    "PNPM_VERSION=11.7.0\n"
                    "NODE_22_MIN=22.19.0\n"
                    "NODE_NEXT_MIN=24.0.0\n",
                    encoding="utf-8",
                )
                shutil.copy2(
                    PACK_DIR / "assets" / "supervisor-contract.json",
                    pack_dir / "assets" / "supervisor-contract.json",
                )
                for name in (
                    "node", "dsh", "pnpm", "artifact", "profile",
                    "gc-contexts", "listener", "supervisor", "read-grant",
                ):
                    shutil.copy2(
                        PACK_DIR / "doctor" / f"check-{name}.sh",
                        pack_dir / "doctor" / f"check-{name}.sh",
                    )
                (dsh_home / "profiles" / "web" / "package.json").write_text(
                    json.dumps(
                        {
                            "dependencies": {
                                "@gastownhall/deepseek-harness-ui": "file:plugin.tgz"
                            },
                            "dsh": {
                                "profile": {
                                    "bundles": [
                                        "@deepseek-ai/dsh-base",
                                        "@deepseek-ai/dsh-web-app",
                                        "@gastownhall/deepseek-harness-ui",
                                    ]
                                }
                            },
                        }
                    ),
                    encoding="utf-8",
                )
                contexts = gc_home / "contexts.toml"
                contexts.write_text("", encoding="utf-8")
                contexts.chmod(0o600)
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
                    "dsh-web-fixture",
                    "exec python3 - <<'PY'\n"
                    "import http.server, json, socketserver\n"
                    "class Handler(http.server.BaseHTTPRequestHandler):\n"
                    "    def do_GET(self):\n"
                    "        body = json.dumps({'connections': []}).encode()\n"
                    "        self.send_response(200)\n"
                    "        self.send_header('Content-Type', 'application/json')\n"
                    "        self.end_headers()\n"
                    "        self.wfile.write(body)\n"
                    "    def log_message(self, *args):\n"
                    "        pass\n"
                    "with socketserver.TCPServer(('127.0.0.1', 0), Handler) as server:\n"
                    "    print(f'http://127.0.0.1:{server.server_address[1]}', flush=True)\n"
                    "    server.serve_forever()\n"
                    "PY",
                )
                write_executable(
                    bin_dir,
                    "dsh",
                    "case \"$*\" in\n"
                    "  --version) printf '0.1.1-rc.2\\n' ;;\n"
                    "  '--profile web --dump-config') printf '# == @gastownhall/deepseek-harness-ui\\n' ;;\n"
                    "  web*) exec dsh-web-fixture ;;\n"
                    "  *) exit 97 ;;\n"
                    "esac",
                )
                write_executable(
                    bin_dir,
                    "gc",
                    "if [ \"$*\" = 'context list --json' ]; then exit 0; fi\nexit 97",
                )
                env = os.environ.copy()
                env.update(
                    {
                        "DSH_HOME": str(dsh_home),
                        "GC_HOME": str(gc_home),
                        "GC_PACK_DIR": str(pack_dir),
                        "GC_SUPERVISOR_URL": f"http://127.0.0.1:{server.server_port}",
                        "PATH": f"{bin_dir}:{env['PATH']}",
                    }
                )
                result = subprocess.run(
                    [str(PACK_DIR / "commands" / "status.sh"), "--check"],
                    text=True,
                    capture_output=True,
                    env=env,
                    check=False,
                )
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("loopback boot and pack route probe succeeded", result.stdout)
        self.assertIn("required OpenAPI capabilities are present", result.stdout)
        self.assertIn("do not require an unsupported direct read grant", result.stdout)


if __name__ == "__main__":
    unittest.main()
