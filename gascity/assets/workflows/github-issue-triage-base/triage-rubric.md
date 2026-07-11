# GitHub Issue Triage Rubric

Apply this default rubric before writing `triage-report.md`.

## Classification

Treat the issue as a bug when a documented behavior, released workflow, public
formula contract, script, adapter, validator, or generated report no longer
works as described.

Treat the issue as `needs_info` when the report lacks enough concrete data to
bound investigation, such as expected behavior, observed behavior, affected
version or commit, reproduction steps, logs, linked artifacts, or environment.

Treat the issue as `not_a_bug` when the behavior matches documented policy or
the request is better classified as docs, product work, a new feature, or
operational support.

Use `duplicate` only when there is a specific linked issue or PR that already
covers the same failure mode or request.

Use `security_sensitive` when the issue may expose secrets, credentials,
private data, access-control bypasses, destructive automation, or exploitable
behavior. Do not publish sensitive details in the public analysis body.

## Evidence

Prefer the smallest high-signal check that can validate or refute the report.
Use current code, tests, docs, release notes, linked refs, or runtime evidence
as appropriate. Record commands, files, artifacts, and skipped checks with the
reason they were skipped.

Do not overclaim `not_reproduced` when the current environment cannot exercise
the reported path. In that case, explain the mismatch and use `needs_info` or
`not_reproduced` only when the available evidence supports it.

## Priority

Use `p0` for security-sensitive reports, destructive source or GitHub mutation,
data loss, credential exposure, or automation that can incorrectly mutate
branches, PRs, comments, beads, or user work without a human gate.

Use `p1` for broken public workflow contracts, invalid generated reports,
adapter failures, validator failures, or regressions that block normal use of a
published workflow.

Use `p2` for important but bounded defects, confusing behavior with a viable
workaround, missing coverage for a plausible regression, or documentation gaps
that slow supported workflows.

Use `p3` for polish, wording, examples, non-blocking maintainability, or
requests whose impact is limited to local convenience.

## Recommendation

Recommend `fix` only when evidence supports a concrete bug on the current
supported path.

Recommend `test_hardening` when the issue is not reproduced but reveals a real
coverage gap or brittle behavior worth defending.

Recommend `ask_reporter` when the next useful step depends on missing reporter
facts.

Recommend `defer` when the issue is valid but low risk, not actionable in the
current environment, or already mitigated enough that immediate work is not the
right next action.

Recommend `close` for duplicates and non-bugs when the public explanation is
clear.

Recommend `security_process` for security-sensitive reports.

## Boundary

This rubric customizes investigation and the human-readable report body only.
It must not override workflow metadata handoff, artifact paths, report schema
`gc.github-issue-triage-report.v1`, validator rules, security or p0 human-gate
behavior, comment marker requirements, or the ban on implementation convoys,
commits, pushes, PRs, and source-branch mutation.
