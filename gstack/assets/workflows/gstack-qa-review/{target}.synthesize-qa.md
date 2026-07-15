Synthesize the gstack QA result.

Read the browser QA, regression evidence, and QA fix artifacts. Set
`code_review.verdict=done` only when QA behavior and regression evidence are
approved. Set `code_review.verdict=iterate` when defects or missing evidence
remain.

Before choosing `done`, read `gc.build.implementation_member_ids` from the
workflow root and require evidence for every exact member from its
authoritative implementation worktree. The evidence must name the member,
canonical worktree path, current full commit SHA, proof command, and observed
passing result. Reject evidence or fixes from the launcher checkout, any
unrecorded worktree, or only a subset of members. Do not turn an upstream
`iterate` into `done` merely because a fix report claims success.

Write one QA summary under the artifact root.

Close with `gc.outcome=pass`,
`code_review.verdict=done|iterate`,
`code_review.report_path=<QA summary path>`, and
`gstack.qa.summary_path=<QA summary path>`.

Do not invoke provider-native subagents. Synthesis happens in this Gas City
fan-in lane.
