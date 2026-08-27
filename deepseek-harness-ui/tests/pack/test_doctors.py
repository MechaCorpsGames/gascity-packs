from __future__ import annotations

import os
import http.server
import json
import pathlib
import subprocess
import tempfile
import threading
import unittest


PACK_DIR = pathlib.Path(__file__).resolve().parents[2]


def write_executable(directory: pathlib.Path, name: str, body: str) -> None:
    path = directory / name
    path.write_text(f"#!/bin/sh\n{body}\n", encoding="utf-8")
    path.chmod(0o755)


def run_doctor(
    name: str,
    fake_commands: dict[str, str],
    *,
    pack_dir: pathlib.Path = PACK_DIR,
    extra_env: dict[str, str] = None,
) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as raw_dir:
        bin_dir = pathlib.Path(raw_dir)
        for command, body in fake_commands.items():
            write_executable(bin_dir, command, body)
        env = os.environ.copy()
        env["GC_PACK_DIR"] = str(pack_dir)
        env["PATH"] = f"{bin_dir}:{os.environ['PATH']}"
        env.update(extra_env or {})
        return subprocess.run(
            [str(PACK_DIR / "doctor" / f"check-{name}.sh")],
            text=True,
            capture_output=True,
            env=env,
            check=False,
        )


class DoctorTests(unittest.TestCase):
    def test_node_doctor_accepts_the_lowest_supported_node_22_release(self) -> None:
        result = run_doctor("node", {"node": "printf 'v22.19.0\\n'"})

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "node v22.19.0 is supported\n")

    def test_dsh_doctor_requires_the_exact_audited_release(self) -> None:
        result = run_doctor("dsh", {"dsh": "printf '0.1.1-rc.1\\n'"})

        self.assertEqual(result.returncode, 2)
        self.assertIn("want 0.1.1-rc.2", result.stdout)

    def test_pnpm_doctor_requires_the_tool_used_by_dsh_plugin_management(self) -> None:
        result = run_doctor("pnpm", {"pnpm": "printf '11.7.0\\n'"})

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "pnpm 11.7.0 matches the audited toolchain\n")

    def test_artifact_doctor_rejects_a_tarball_that_does_not_match_its_pin(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            pack_dir = pathlib.Path(raw_dir)
            (pack_dir / "assets" / "dist").mkdir(parents=True)
            (pack_dir / "assets" / "dist" / "plugin.tgz").write_bytes(b"tampered")
            (pack_dir / "assets" / "versions.env").write_text(
                "PLUGIN_ARTIFACT=plugin.tgz\n"
                "PLUGIN_SHA256=" + "0" * 64 + "\n",
                encoding="utf-8",
            )

            result = run_doctor("artifact", {}, pack_dir=pack_dir)

        self.assertEqual(result.returncode, 2)
        self.assertIn("checksum mismatch", result.stdout)

    def test_profile_doctor_fails_when_the_dsh_web_profile_is_absent(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            home = pathlib.Path(raw_dir)
            result = run_doctor("profile", {}, extra_env={"DSH_HOME": str(home)})

        self.assertEqual(result.returncode, 2)
        self.assertIn("web profile is missing", result.stdout)

    def test_profile_doctor_requires_the_installed_bundle_once(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            home = pathlib.Path(raw_dir)
            profile_dir = home / "profiles" / "web"
            profile_dir.mkdir(parents=True)
            (profile_dir / "package.json").write_text(
                json.dumps(
                    {
                        "dependencies": {
                            "@gastownhall/deepseek-harness-ui": "file:gastownhall-deepseek-harness-ui-0.1.0.tgz"
                        },
                        "dsh": {
                            "profile": {
                                "bundles": [
                                    "@deepseek-ai/dsh-base",
                                    "@deepseek-ai/dsh-web-app",
                                ]
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = run_doctor("profile", {}, extra_env={"DSH_HOME": str(home)})

        self.assertEqual(result.returncode, 2)
        self.assertIn("installed and activated exactly once", result.stdout)

    def test_profile_doctor_requires_one_composed_pack_layer(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            home = pathlib.Path(raw_dir)
            profile_dir = home / "profiles" / "web"
            profile_dir.mkdir(parents=True)
            (profile_dir / "package.json").write_text(
                json.dumps(
                    {
                        "dependencies": {
                            "@gastownhall/deepseek-harness-ui": "file:gastownhall-deepseek-harness-ui-0.1.0.tgz"
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
            duplicate = (
                "printf '# == @gastownhall/deepseek-harness-ui\\n"
                "# == @gastownhall/deepseek-harness-ui\\n'"
            )

            result = run_doctor(
                "profile",
                {"dsh": duplicate},
                extra_env={"DSH_HOME": str(home)},
            )

        self.assertEqual(result.returncode, 2)
        self.assertIn("composition has 2 pack layers", result.stdout)

    def test_profile_doctor_requires_the_verified_pack_tarball_dependency(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            home = pathlib.Path(raw_dir)
            profile_dir = home / "profiles" / "web"
            profile_dir.mkdir(parents=True)
            (profile_dir / "package.json").write_text(
                json.dumps(
                    {
                        "dependencies": {
                            "@gastownhall/deepseek-harness-ui": "0.1.0"
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
            result = run_doctor(
                "profile",
                {"dsh": "printf '# == @gastownhall/deepseek-harness-ui\\n'"},
                extra_env={"DSH_HOME": str(home)},
            )

        self.assertEqual(result.returncode, 2)
        self.assertIn("verified pack tarball", result.stdout)

    def test_listener_doctor_actually_boots_and_probes_the_pack_route(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = pathlib.Path(raw_dir)
            log_path = root / "dsh.log"
            fake_dsh = (
                "printf '%s\\n' \"$*\" >> \"$DSH_TEST_LOG\"\n"
                "if [ \"${1:-}\" != web ]; then exit 97; fi\n"
                "exec python3 - <<'PY'\n"
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
                "PY"
            )
            result = run_doctor(
                "listener",
                {"dsh": fake_dsh},
                extra_env={"DSH_TEST_LOG": str(log_path)},
            )
            calls = log_path.read_text(encoding="utf-8")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("loopback boot and pack route probe succeeded", result.stdout)
        self.assertIn("web --host 127.0.0.1 --port 0 --no-open", calls)

    def test_gc_contexts_doctor_uses_gc_validation_without_invoking_helpers(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            gc_home = pathlib.Path(raw_dir)
            contexts = gc_home / "contexts.toml"
            contexts.write_text("not valid toml", encoding="utf-8")
            contexts.chmod(0o600)
            fake_gc = (
                "if [ \"$*\" = 'context list --json' ]; then\n"
                "  printf 'malformed contexts\\n' >&2\n"
                "  exit 1\n"
                "fi\n"
                "exit 97"
            )
            result = run_doctor(
                "gc-contexts",
                {"gc": fake_gc},
                extra_env={"GC_HOME": str(gc_home)},
            )

        self.assertEqual(result.returncode, 2)
        self.assertIn("GC contexts could not be parsed or validated", result.stdout)

    def test_supervisor_doctor_requires_the_pack_api_capability_matrix(self) -> None:
        required = {
            "/v0/cities": {"get": {}},
            "/v0/events/stream": {"get": {}},
            "/v0/city/{cityName}/events/stream": {"get": {}},
            "/v0/city/{cityName}/rigs": {"get": {}},
            "/v0/city/{cityName}/agents": {"get": {}},
            "/v0/city/{cityName}/providers/public": {"get": {}},
            "/v0/city/{cityName}/sessions": {"get": {}, "post": {}},
            "/v0/city/{cityName}/session/{id}": {"get": {}, "patch": {}},
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
                    body = b'{"status":"ok"}'
                elif self.path == "/openapi.json":
                    body = json.dumps({"openapi": "3.1.0", "paths": required}).encode()
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args: object) -> None:
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result = run_doctor(
                "supervisor",
                {},
                extra_env={
                    "GC_SUPERVISOR_URL": f"http://127.0.0.1:{server.server_port}"
                },
            )
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Supervisor health and required OpenAPI capabilities are present", result.stdout)

    def test_read_grant_doctor_reports_the_unsupported_direct_gate(self) -> None:
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if self.path == "/v0/cities":
                    body = b'{"items":[{"name":"alpha","running":true}]}'
                    self.send_response(200)
                elif self.path == "/v0/city/alpha/rigs":
                    body = b'{"status":401,"title":"Unauthorized","detail":"missing X-GC-City-Read grant"}'
                    self.send_response(401)
                else:
                    body = b"{}"
                    self.send_response(404)
                self.send_header("Content-Type", "application/problem+json")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args: object) -> None:
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result = run_doctor(
                "read-grant",
                {},
                extra_env={
                    "GC_SUPERVISOR_URL": f"http://127.0.0.1:{server.server_port}"
                },
            )
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

        self.assertEqual(result.returncode, 2)
        self.assertIn("direct read-grant hardening is unsupported in v1", result.stdout)


if __name__ == "__main__":
    unittest.main()
