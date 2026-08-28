from __future__ import annotations

import pathlib
import json
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
PACKAGE_JSON = REPO_ROOT / "deepseek-harness-ui" / "assets" / "dsh-plugin" / "package.json"
PLAYWRIGHT_CONFIG = REPO_ROOT / "deepseek-harness-ui" / "assets" / "dsh-plugin" / "playwright.config.mjs"
ISOLATED_CERTIFICATE = (
    REPO_ROOT
    / "deepseek-harness-ui"
    / "assets"
    / "dsh-plugin"
    / "tests"
    / "e2e"
    / "isolated-live-certificate.mjs"
)
LIVE_AGENT_FIXTURE = (
    REPO_ROOT
    / "deepseek-harness-ui"
    / "assets"
    / "dsh-plugin"
    / "tests"
    / "e2e"
    / "fixtures"
    / "live-agent-matrix"
)
SUPERVISOR_DOCTOR = REPO_ROOT / "deepseek-harness-ui" / "doctor" / "check-supervisor.sh"


class BrowserContractCiTests(unittest.TestCase):
    def test_supervisor_doctor_gates_the_config_route_used_for_cold_agents(self) -> None:
        script = SUPERVISOR_DOCTOR.read_text(encoding="utf-8")

        self.assertIn("'/v0/city/{cityName}/config': ['get']", script)

    def test_plugin_exposes_a_dedicated_stock_dsh_soak_command(self) -> None:
        package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))

        self.assertEqual(
            package["scripts"]["test:e2e:soak"],
            "playwright test --config playwright.soak.config.mjs",
        )

    def test_stock_dsh_contract_includes_the_ssh_forwarded_browser_surface(self) -> None:
        config = PLAYWRIGHT_CONFIG.read_text(encoding="utf-8")

        self.assertIn("stock-dsh.ssh.spec.mjs", config)

    def test_plugin_exposes_an_isolated_live_certificate_command(self) -> None:
        package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))

        self.assertEqual(
            package["scripts"]["test:e2e:live:isolated"],
            "node tests/e2e/isolated-live-certificate.mjs",
        )

    def test_isolated_certificate_creates_and_starts_a_disposable_city_through_gc_init(self) -> None:
        script = ISOLATED_CERTIFICATE.read_text(encoding="utf-8")

        self.assertIn("runOwnedCommand(gcBin, ['init'", script)
        self.assertIn("'--template', 'minimal'", script)
        self.assertIn("'--providers', 'claude,codex'", script)
        self.assertIn("'--default-provider', 'codex'", script)
        self.assertNotIn("'--no-start'", script)
        self.assertNotIn("writeFile(join(gcHome, 'cities.toml')", script)
        self.assertNotIn("spawnOwnedCommand(gcBin, ['supervisor', 'run']", script)
        self.assertIn("GC_BEADS: 'file'", script)
        self.assertIn("GC_SUPERVISOR_ENV", script)
        self.assertIn("runOwnedCommand(gcBin, ['supervisor', 'uninstall']", script)
        self.assertIn("runOwnedCommand(gcBin, ['stop', '--force', '--timeout', '30s', cityDir]", script)
        self.assertIn("runOwnedCommand('tmux', ['-L', cityName, 'kill-server']", script)
        self.assertIn("owned tmux server remained after cleanup", script)
        self.assertIn("city => city.name === cityName && city.running === true", script)
        self.assertIn("runOwnedCommand(gcBin, ['import', 'add'", script)
        self.assertIn("runOwnedCommand(gcBin, ['reload', cityDir]", script)
        self.assertIn("live-agent-matrix", script)
        self.assertNotIn("void resources.close()", script)
        self.assertIn("new AbortController()", script)

        process_cleanup_position = script.index("resources.defer('disposable city processes'")
        supervisor_cleanup_position = script.index("resources.defer('isolated Supervisor service'")
        self.assertLess(process_cleanup_position, supervisor_cleanup_position)

        init_position = script.index("runOwnedCommand(gcBin, ['init'")
        health_position = script.index("`${supervisorUrl}/health`")
        dsh_position = script.index("tests/e2e/live-certificate.mjs")
        self.assertLess(init_position, health_position)
        self.assertLess(health_position, dsh_position)

    def test_live_agent_matrix_is_a_two_provider_schema_v2_pack(self) -> None:
        manifest = (LIVE_AGENT_FIXTURE / "pack.toml").read_text(encoding="utf-8")
        claude = (LIVE_AGENT_FIXTURE / "agents" / "release-claude" / "agent.toml").read_text(encoding="utf-8")
        codex = (LIVE_AGENT_FIXTURE / "agents" / "release-codex" / "agent.toml").read_text(encoding="utf-8")

        self.assertIn('schema = 2', manifest)
        self.assertIn('provider = "claude"', claude)
        self.assertIn('provider = "codex"', codex)
        self.assertIn('max_active_sessions = 1', claude)
        self.assertIn('max_active_sessions = 1', codex)
        self.assertTrue((LIVE_AGENT_FIXTURE / "agents" / "release-claude" / "prompt.template.md").is_file())
        self.assertTrue((LIVE_AGENT_FIXTURE / "agents" / "release-codex" / "prompt.template.md").is_file())

    def test_browser_contract_is_bounded_and_preserves_failure_diagnostics(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        job = workflow.split("\n  deepseek-harness-ui:\n", maxsplit=1)[1]

        self.assertIn("timeout-minutes: 25", job)
        self.assertIn("timeout-minutes: 12", job)
        self.assertIn("pnpm test:e2e:contract", job)
        self.assertIn("pnpm test:e2e:soak", job)
        self.assertIn("if: ${{ failure() && !cancelled() }}", job)
        self.assertIn(
            "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
            job,
        )
        self.assertIn("deepseek-harness-ui/assets/dsh-plugin/test-results/", job)


if __name__ == "__main__":
    unittest.main()
