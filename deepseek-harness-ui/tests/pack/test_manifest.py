from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main()
