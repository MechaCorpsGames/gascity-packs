Prepare the build-basic starter factory review.

Gather the requirements artifact, implementation plan, decomposition artifact,
implementation summary, changed-file summaries, task evidence, and verification
commands into one review context file under the build artifact root. Record that
path on the workflow root as `gc.build.code_review_context_path`.

The implementation source of truth is the closed source anchor/worktree recorded
by the implementation summary and task evidence. Include the source anchor id,
its `work_dir`, changed files, commit id, and proof commands in the context. The
launcher rig root may remain unchanged until an explicit publish step; do not
present an unchanged root checkout as a review failure when the source
anchor/worktree contains the verified implementation.

Resolve every exact implementation-convoy member and its current full recorded
commit before writing the context. Compute the implementation snapshot as the
`sha256` digest of compact JSON containing each member id and commit, sorted by
member id with object keys sorted and no trailing newline. Record the result on
the workflow root as
`gc.build.implementation_snapshot=sha256:<64-lowercase-hex-digits>` and include
the exact tuple list and snapshot in the review context. Fail closed if a member
commit does not resolve in its authoritative worktree. This value binds every
review lane to the same implementation bytes.

This starter factory intentionally uses only three review lanes so new users can
see fanout/fanin without a large reviewer roster.

Do not invoke provider-native subagents. Gas City graph lanes are the
delegation mechanism.

Close this setup bead with `gc.outcome=pass` only after the review context path
and `gc.build.implementation_snapshot` are recorded.
