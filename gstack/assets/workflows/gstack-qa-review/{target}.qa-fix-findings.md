Apply gstack QA findings.

Use implementation target {{implementation_target}} for fixes. Fix behavior
defects first, then add or update regression tests. If the QA lane found only
missing evidence, run and record the missing proof instead of changing code.

Read `gc.build.implementation_member_ids` and the exact member-to-worktree map
from the QA context. Apply each fix only inside the affected member's
authoritative implementation worktree after verifying `pwd -P`; never edit or
test product source in the launcher checkout. Commit the fix in that worktree,
rerun the proof there, update the source member's
`gc.implementation.worktree_path`, `gc.implementation.commit`, and
`gc.implementation.summary_path`, and update the summary with the new full
commit SHA and observed passing result. Missing member ownership is a blocking
finding, not permission to patch the launcher.

After all member updates, regenerate the canonical root summary at the exact
workflow-root path in `gc.build.implementation_summary_path`. Its body must
name every exact member, authoritative worktree, current full commit, and
per-item summary. Its `trace.upstream` must contain each current absolute
per-item summary path exactly once with the `sha256` digest of its current
bytes. A pre-QA commit or digest is stale evidence and requires another
iteration.

Write a QA fix artifact under the artifact root.

Close with `gc.outcome=pass` and
`gstack.qa.fix_output_path=<QA fix artifact path>`.

Do not invoke provider-native subagents. This Gas City graph lane is the QA fix
delegation mechanism.
