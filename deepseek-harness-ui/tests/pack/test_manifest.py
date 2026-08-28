from __future__ import annotations

import json
import pathlib
import unittest


PACK_DIR = pathlib.Path(__file__).resolve().parents[2]


class PackManifestTests(unittest.TestCase):
    def test_schema_v2_pack_exposes_only_the_four_delivery_commands(self) -> None:
        manifest_path = PACK_DIR / "pack.toml"
        self.assertTrue(manifest_path.is_file(), f"missing {manifest_path}")

        self.assertEqual(
            manifest_path.read_text(encoding="utf-8"),
            """[pack]
name = "deepseek-harness-ui"
version = "0.1.0"
schema = 2
""",
        )

        commands = {path.parent.name for path in (PACK_DIR / "commands").glob("*/command.toml")}
        self.assertEqual(commands, {"install", "uninstall", "web", "status"})

    def test_dsh_runtime_compatibility_is_separate_from_the_exact_build_pin(self) -> None:
        compatibility = json.loads(
            (PACK_DIR / "assets" / "dsh-compatibility.json").read_text(encoding="utf-8")
        )
        versions = dict(
            line.split("=", maxsplit=1)
            for line in (PACK_DIR / "assets" / "versions.env").read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#")
        )

        self.assertEqual(compatibility["schema"], 1)
        self.assertEqual(compatibility["minimum_version"], "0.1.1-rc.2")
        self.assertEqual(
            [release["version"] for release in compatibility["certified"]],
            [versions["DSH_BUILD_VERSION"]],
        )
        self.assertEqual(versions["DSH_BUILD_VERSION"], "0.1.1-rc.2")
        self.assertNotIn("DSH_VERSION", versions)

    def test_plugin_does_not_turn_build_time_dsh_packages_into_runtime_upgrade_locks(self) -> None:
        package = json.loads(
            (PACK_DIR / "assets" / "dsh-plugin" / "package.json").read_text(encoding="utf-8")
        )

        self.assertEqual(package["devDependencies"]["@deepseek-ai/dsh"], "0.1.1-rc.2")
        self.assertFalse(
            any(name.startswith("@deepseek-ai/dsh") for name in package["peerDependencies"]),
            package["peerDependencies"],
        )

    def test_operator_contract_documents_ssh_forwarding_and_authority_fronted_read_auth(self) -> None:
        readme = (PACK_DIR / "README.md").read_text(encoding="utf-8")
        web_help = (PACK_DIR / "commands" / "web" / "help.md").read_text(encoding="utf-8")

        self.assertIn("ssh -L", readme)
        self.assertIn("SSH-forwarded remote use is supported", readme)
        self.assertIn("authority-fronted", readme)
        self.assertIn("direct read-grant", readme)
        self.assertIn("SSH", web_help)
        self.assertIn("loopback", web_help)


if __name__ == "__main__":
    unittest.main()
