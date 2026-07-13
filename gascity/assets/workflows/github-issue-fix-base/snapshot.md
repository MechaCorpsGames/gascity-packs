
Resolved GitHub issue URL: {{github_issue_url}}
Resolved artifact root override: {{artifact_root}} (empty means use the rig artifact root)
Resolved mode: {{mode}}
Resolved PR mode: {{pr_mode}}
Resolved drain policy: {{drain_policy}}

Artifact root semantics:
- Resolve the durable artifact root with
  `{{pack_root}}/assets/scripts/artifacts.py root --override "{{artifact_root}}"`.
- Paths shown with a leading slash, such as
  `/github/issues/<owner>/<repo>/<number>/source.json`, are
  artifact-root-relative, not filesystem-root absolute.
- Resolve concrete files with
  `{{pack_root}}/assets/scripts/artifacts.py path --override "{{artifact_root}}" --relative "/github/issues/<owner>/<repo>/<number>/source.json" --mkdir-parents`.
- Store absolute resolved artifact paths in bead metadata. Do not infer source
  identity, workflow identity, readiness, or routing from artifact paths.

Validate the issue URL with
`{{pack_root}}/assets/scripts/github_api.py parse-url "{{github_issue_url}}" --kind issue`,
reject shorthand inputs, and refresh the canonical GitHub source bead using
`{{pack_root}}/assets/scripts/github_api.py issue-snapshot "{{github_issue_url}}"`.

Write the returned snapshot JSON to
artifact-root-relative path `/github/issues/<owner>/<repo>/<number>/source.json`.
Then create or refresh the canonical GitHub source bead using this v0 contract:

- Source beads are non-runnable index/cache beads. Do not route the source bead,
  assign it, depend on it, or use it as a readiness gate.
- Lookup uses object identity only:
  `gc bd list --metadata-field gc.kind=github_source --metadata-field gc.github.kind=issue --metadata-field gc.github.repo=<owner>/<repo> --metadata-field gc.github.number=<number> --status open,in_progress,closed --limit 1 --json`.
- Write `source-metadata.json` with flat string metadata:
  `gc.kind=github_source`, `gc.github.kind=issue`,
  `gc.github.repo=<owner>/<repo>`, `gc.github.number=<number>`,
  `gc.github.url=<canonical_url>`, `gc.github.title=<title>`,
  `gc.github.state=<state>`, `gc.github.author=<author>`,
  `gc.github.labels=<comma-separated labels>`,
  `gc.github.body_hash=<body_hash>`,
  `gc.github.snapshot_path=<absolute source.json path>`,
  `gc.github.updated_at=<updated_at>`.
- If no bead exists, create it with
  `gc bd create "GitHub issue source: <owner>/<repo>#<number>" --type task --labels gc.github-source,gc.github-issue --external-ref <canonical_url> --metadata @source-metadata.json`.
- If a bead exists, refresh it with
  `gc bd update <source-bead-id> --external-ref <canonical_url> --metadata @source-metadata.json`.

Do not use title, label, assignee, or state changes to invalidate downstream
fix reuse; `gc.github.body_hash` is the issue content key.
