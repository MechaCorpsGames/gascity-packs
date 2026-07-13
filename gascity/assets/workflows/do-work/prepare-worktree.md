
Resolve and publish the isolated worktree for this item. This is infrastructure
setup only. Do not edit source files in the launcher checkout.

1. Read current step bead metadata and get `gc.root_bead_id`; hard-fail if it is
   missing. Read that do-work root with `gc bd show <root-bead-id> --json`.
2. Resolve `<source-anchor-id>` from the do-work root:
   - read root metadata `gc.input_convoy_id`; hard-fail if it is missing
   - read that input convoy with `gc bd show <input-convoy-id> --json`
   - if input convoy metadata has `gc.synthetic_kind=drain-unit-convoy`, use
     input convoy metadata `gc.drain_member_id`
   - otherwise use `<input-convoy-id>` as the source anchor
   - if root metadata also has `gc.drain_member_id`, it must match the selected
     drain member
3. Validate context path {{context_path}}, files ownership, and verification
   policy for the resolved source anchor.
4. Create or reuse a deterministic git worktree at
   `$(pwd)/worktrees/<source-anchor-id>`. If the path is missing, run
   `git worktree add "$WORKTREE" --detach HEAD`. If the path exists but is not
   the worktree for this repository, fail closed.
5. Persist the absolute path on the source anchor with
   `gc bd update <source-anchor-id> --set-metadata work_dir=<absolute worktree path>`.
   Verify the source anchor now has `work_dir` before closing this step with
   `gc.outcome=pass`.
