from __future__ import annotations

import os
import http.server
import json
import pathlib
import signal
import subprocess
import tempfile
import threading
import time
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

    def test_dsh_doctor_accepts_a_certified_release(self) -> None:
        result = run_doctor("dsh", {"dsh": "printf '0.1.1-rc.2\\n'"})

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("certified", result.stdout)

    def test_dsh_doctor_allows_a_newer_release_without_claiming_browser_certification(self) -> None:
        result = run_doctor("dsh", {"dsh": "printf '0.1.2-rc.1\\n'"})

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("not yet certified", result.stdout)
        self.assertIn("browser compatibility is unverified", result.stdout)
        self.assertNotIn("browser capability gates", result.stdout)

    def test_dsh_doctor_rejects_a_release_older_than_the_extension_contract(self) -> None:
        result = run_doctor("dsh", {"dsh": "printf '0.1.1-rc.1\\n'"})

        self.assertEqual(result.returncode, 2)
        self.assertIn("older than minimum", result.stdout)

    def test_dsh_doctor_rejects_a_release_recorded_as_known_incompatible(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            pack_dir = pathlib.Path(raw_dir)
            (pack_dir / "assets").mkdir()
            (pack_dir / "assets" / "dsh-compatibility.json").write_text(
                json.dumps(
                    {
                        "schema": 1,
                        "minimum_version": "0.1.1-rc.2",
                        "certified": [],
                        "known_incompatible": [
                            {"version": "0.1.2-rc.1", "reason": "client loader contract changed"}
                        ],
                    }
                ),
                encoding="utf-8",
            )
            result = run_doctor(
                "dsh",
                {"dsh": "printf 'dsh 0.1.2-rc.1\\n'"},
                pack_dir=pack_dir,
            )

        self.assertEqual(result.returncode, 2)
        self.assertIn("known incompatible", result.stdout)
        self.assertIn("client loader contract changed", result.stdout)

    def test_pnpm_doctor_accepts_a_different_runtime_tool_version(self) -> None:
        result = run_doctor("pnpm", {"pnpm": "printf '12.1.0\\n'"})

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "pnpm 12.1.0 is available for DSH plugin management\n")

    def test_pnpm_doctor_rejects_an_invalid_version_response(self) -> None:
        result = run_doctor("pnpm", {"pnpm": "printf 'not-a-version\\n'"})

        self.assertEqual(result.returncode, 2)
        self.assertIn("did not report a semantic version", result.stdout)

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

    def test_listener_doctor_live_mode_rejects_unavailable_configured_connections(self) -> None:
        fake_dsh = (
            "exec python3 - <<'PY'\n"
            "import http.server, json, socketserver\n"
            "class Handler(http.server.BaseHTTPRequestHandler):\n"
            "    def do_GET(self):\n"
            "        body = json.dumps({'connections': [{\n"
            "            'id': 'remote', 'label': 'Remote', 'cities': ['alpha'],\n"
            "            'available': False, 'diagnostic': 'credential helper failed'\n"
            "        }]}).encode()\n"
            "        self.send_response(200)\n"
            "        self.send_header('Content-Type', 'application/json')\n"
            "        self.end_headers()\n"
            "        self.wfile.write(body)\n"
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
            extra_env={"GC_REQUIRE_AVAILABLE_CONNECTIONS": "1"},
        )

        self.assertEqual(result.returncode, 2)
        self.assertIn("Remote: credential helper failed", result.stdout)

    def test_listener_doctor_kills_the_owned_process_group_with_a_bounded_reap(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = pathlib.Path(raw_dir)
            descendant_pid_path = root / "descendant.pid"
            fake_dsh = (
                "exec python3 - <<'PY'\n"
                "import http.server, os, signal, socketserver, subprocess, sys\n"
                "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
                "child = subprocess.Popen([sys.executable, '-c', "
                "'import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)'])\n"
                "open(os.environ['DSH_DESCENDANT_PID'], 'w').write(str(child.pid))\n"
                "class Handler(http.server.BaseHTTPRequestHandler):\n"
                "    def do_GET(self):\n"
                "        self.send_response(200)\n"
                "        self.send_header('Content-Type', 'application/json')\n"
                "        self.end_headers()\n"
                "        self.wfile.write(b'{\\\"connections\\\":[]}')\n"
                "    def log_message(self, *_args):\n"
                "        pass\n"
                "with socketserver.TCPServer(('127.0.0.1', 0), Handler) as server:\n"
                "    print(f'http://127.0.0.1:{server.server_address[1]}', flush=True)\n"
                "    server.serve_forever()\n"
                "PY"
            )
            descendant_pid = None
            descendant_gone = False
            try:
                result = run_doctor(
                    "listener",
                    {"dsh": fake_dsh},
                    extra_env={"DSH_DESCENDANT_PID": str(descendant_pid_path)},
                )
                descendant_pid = int(descendant_pid_path.read_text(encoding="utf-8"))
                for _ in range(20):
                    try:
                        os.kill(descendant_pid, 0)
                    except ProcessLookupError:
                        descendant_gone = True
                        break
                    time.sleep(0.05)
            finally:
                if descendant_pid is not None and not descendant_gone:
                    try:
                        os.kill(descendant_pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("loopback boot and pack route probe succeeded", result.stdout)
        self.assertTrue(descendant_gone, "listener doctor leaked its hostile descendant")

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
                    body = b'{"status":"ok"}'
                elif self.path == "/openapi.json":
                    body = json.dumps({
                        "openapi": "3.1.0",
                        "paths": required,
                        "components": {"schemas": {"PackContract": {"enum": [
                            "session.structured.v1", "snapshot", "upsert", "reset",
                            "resume_invalid", "stream_changed", "cursor_invalidated", "history_rewritten",
                            "unknown", "partial", "final", "superseded",
                            "default", "follow_up", "interrupt_now",
                            "structured", "activity", "pending", "pending_cleared",
                        ]}}},
                    }).encode()
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

    def test_supervisor_doctor_rejects_routes_without_the_structured_contract(self) -> None:
        required = {
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
                extra_env={"GC_SUPERVISOR_URL": f"http://127.0.0.1:{server.server_port}"},
            )
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

        self.assertEqual(result.returncode, 2)
        self.assertIn("required OpenAPI capability probe failed", result.stdout)

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
        self.assertIn("direct read-grant hardening requires an authority/minter integration", result.stdout)
        self.assertIn("authority-fronted bearer mode remains supported", result.stdout)

    def test_read_grant_doctor_observes_when_a_bearer_changes_rejection_to_success(self) -> None:
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if self.headers.get("Authorization") != "Bearer edge-token":
                    body = b'{"status":401,"title":"Unauthorized"}'
                    self.send_response(401)
                elif self.path == "/v0/cities":
                    body = b'{"items":[{"name":"alpha","running":true}]}'
                    self.send_response(200)
                elif self.path == "/v0/city/alpha/rigs":
                    body = b'{"items":[]}'
                    self.send_response(200)
                else:
                    body = b"{}"
                    self.send_response(404)
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
                "read-grant",
                {},
                extra_env={
                    "GC_SUPERVISOR_URL": f"http://127.0.0.1:{server.server_port}",
                    "GC_SUPERVISOR_BEARER": "edge-token",
                    "GC_SUPERVISOR_CITY": "alpha",
                },
            )
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("bearer-authenticated city read succeeded", result.stdout)
        self.assertIn("front-door behavior observed", result.stdout)

    def test_read_grant_doctor_does_not_claim_authority_when_the_target_ignores_the_bearer(self) -> None:
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                body = b'{"items":[]}'
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
                "read-grant",
                {},
                extra_env={
                    "GC_SUPERVISOR_URL": f"http://127.0.0.1:{server.server_port}",
                    "GC_SUPERVISOR_BEARER": "ignored-token",
                    "GC_SUPERVISOR_CITY": "alpha",
                },
            )
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("target did not require it", result.stdout)
        self.assertIn("authority fronting was not proven", result.stdout)

    def test_read_grant_doctor_does_not_attribute_a_transient_failure_to_bearer_auth(self) -> None:
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                if self.headers.get("Authorization") == "Bearer edge-token":
                    body = b'{"items":[]}'
                    self.send_response(200)
                else:
                    body = b'{"status":500,"title":"Unavailable"}'
                    self.send_response(500)
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
                "read-grant",
                {},
                extra_env={
                    "GC_SUPERVISOR_URL": f"http://127.0.0.1:{server.server_port}",
                    "GC_SUPERVISOR_BEARER": "edge-token",
                    "GC_SUPERVISOR_CITY": "alpha",
                },
            )
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("authority fronting was not proven", result.stdout)
        self.assertNotIn("front-door behavior observed", result.stdout)


if __name__ == "__main__":
    unittest.main()
