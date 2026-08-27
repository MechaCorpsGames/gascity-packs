from __future__ import annotations

import pathlib
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"


class BrowserContractCiTests(unittest.TestCase):
    def test_browser_contract_is_bounded_and_preserves_failure_diagnostics(self) -> None:
        workflow = WORKFLOW.read_text(encoding="utf-8")
        job = workflow.split("\n  deepseek-harness-ui:\n", maxsplit=1)[1]

        self.assertIn("timeout-minutes: 25", job)
        self.assertIn("timeout-minutes: 12", job)
        self.assertIn("pnpm test:e2e:contract", job)
        self.assertIn("if: ${{ failure() && !cancelled() }}", job)
        self.assertIn(
            "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
            job,
        )
        self.assertIn("deepseek-harness-ui/assets/dsh-plugin/test-results/", job)


if __name__ == "__main__":
    unittest.main()
