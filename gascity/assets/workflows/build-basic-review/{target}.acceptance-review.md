Run the starter factory acceptance review lane.

Review the implementation against the requirements, acceptance criteria,
implementation plan, decomposition, and task summaries. Focus on correctness:
did the factory build the requested behavior, and did it avoid out-of-scope
changes?

Before inspecting files or running tests, read `gc.build.code_review_context_path`
from the workflow root bead and use its `## Implementation Worktrees` section as
the authority for code under review. `gc.work_dir` is the launcher rig root, not
the implementation worktree. Do not inspect or edit the launcher checkout when
deciding whether the implementation passes. Resolve every relative source path
and proof command from the review context against the listed implementation
worktree, run `cd "$WORKTREE"`, and verify `pwd -P` equals that worktree before
executing commands. If the context is missing a usable implementation worktree,
write an iterate finding against review setup instead of reviewing the launcher
checkout.

Contract: `gc.work_dir` is the launcher rig root, not the implementation worktree.

Write findings under the build artifact root. Required findings must include
the relevant requirement or task reference plus the file, command, or artifact
that proves the issue.

Close with `gc.outcome=pass`,
`code_review.acceptance_verdict=approve|iterate`, and
`code_review.output_path=<acceptance review report path>`.

Do not set `code_review.verdict` or `code_review.report_path`; synthesis and
fix application own the final review verdict.

Do not invoke provider-native subagents. You are the starter factory acceptance
review lane.
