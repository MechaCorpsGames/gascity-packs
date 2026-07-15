Finalize the build-basic starter factory review.

Verify one exact current-attempt lane/synthesis/apply group approved the live
implementation and review inputs. Read `code_review.reviewed_attempt` and
`code_review.review_input_snapshot` from its apply bead; every row must carry
the same values. Recompute the combined snapshot from the implementation
snapshot plus canonical summary/context paths and raw-byte digests. Any mismatch
requires iteration, never a replacement input.

Write the approved report under the build artifact root and record its absolute
path with:
`gc bd update "<workflow-root-id>" --set-metadata "gc.build.review_report_path=<absolute path>"`.
Do not use `gc bd update --metadata 'key=value'`; `--metadata` only accepts a JSON
object.

Review the source anchor/worktree recorded in the immutable context and summary,
not an unchanged launcher checkout. Root propagation belongs to publish.

The report is a Markdown artifact with YAML front matter, not JSON. Write a
normalized `gc.build.review.v1` artifact with `status: approved` from the latest synthesis if needed, but
never mutate or repoint the summary or context. Include one coverage table whose
ID/status pairs exactly match `trace.coverage`. The validator only recognizes a
Markdown coverage table with the same status when it has `ID` and `Status` columns:

| ID | Status |
| --- | --- |
| REQ-001 | covered |

Use mapping objects for front matter; do not use scalar shortcuts such as
`workflow: build-basic`:

- `schema: gc.build.review.v1`
- `workflow: {id: <workflow-root-id>, formula: build-basic}`
- `methodology: {pack: gascity, name: build-basic}`
- `producer: {formula: build-basic-review, stage: review, attempt: <positive integer>}`
- `status: approved`; any other status fails this stage
- `implementation_snapshot: <exact current snapshot>`
- `review_input_snapshot: <exact current review-input snapshot>`
- `reviewed_attempt: <exact positive loop attempt>`
- `trace: {upstream: [...], coverage: [...]}`

Trace the exact canonical implementation summary once at the absolute `gc.build.implementation_summary_path` with its freshly computed `sha256:<digest>`.
Trace the exact `gc.build.code_review_context_path` once with
its current digest. The `implementation_snapshot: <exact current snapshot>` and
review-input snapshot must equal the root, every lane, synthesis, and apply;
repeat both in Verification.

Trace front matter must use the validator shape exactly:

- `trace.upstream[]` entries must include `path` and `hash`; do not use
  `id`/`title`/`type` entries as the upstream shape.
- Use scheme-qualified hashes. If an entry lists `ids`, every ID must appear
  exactly once in `trace.coverage` and in the Markdown coverage table with the same status.
- Coverage statuses are not artifact statuses. Use `covered`; do not use `approved` in `trace.coverage[].status`.
- Do not create any additional Markdown table with both an `ID` column and a
  `Status` column unless it repeats the exact matrix.

Required body sections:

- Verdict
- Findings
- Verification

Before closing this expansion target, set the claimed step outcome with
`gc bd update "<claimed-step-id>" --set-metadata "gc.outcome=pass"`, then close
with `gc bd close "<claimed-step-id>" --reason "<concise reason>"`. Do not pass
`--metadata` or `--set-metadata` to `gc bd close`.

Do not invoke provider-native subagents or provider-specific task tools.
