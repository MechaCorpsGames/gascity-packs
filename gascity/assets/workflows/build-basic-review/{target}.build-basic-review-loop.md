Run the build-basic starter factory review loop.

The child beads are three review lanes plus synthesis and fix application:
acceptance/correctness, test evidence, and simplicity/maintainability. These are
starter factory lanes: broad enough to demonstrate Gas City fanout/fanin, but
small enough for first-time factory users to understand.

The apply-review-findings lane owns `code_review.verdict=done|iterate` and
`code_review.report_path=<starter review summary path>`. The implementation
review check repeats this loop until all three current-attempt lanes approve the
same current `code_review.implementation_snapshot` and the latest apply verdict
is `done`. Any implementation commit change invalidates earlier approvals and
requires another iteration.

Do not invoke provider-native subagents. Continue only through this Gas City
graph loop.
