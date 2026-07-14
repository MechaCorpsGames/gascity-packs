from __future__ import annotations

from dataclasses import replace
import hashlib
import json
import os
import re
import shutil
import shlex
import subprocess
from pathlib import Path

import pytest
import yaml

from scripts import gascity_pack_inference_gate


SUPPORTED_PACK_NIGHTLY_WORKFLOW = (
    gascity_pack_inference_gate.REPO_ROOT / ".github" / "workflows" / "supported-pack-nightly.yml"
)


def supported_pack_nightly_document() -> dict:
    document = yaml.safe_load(SUPPORTED_PACK_NIGHTLY_WORKFLOW.read_text(encoding="utf-8"))
    assert isinstance(document, dict)
    return document


def supported_pack_nightly_step_script(name: str) -> str:
    for job in supported_pack_nightly_document()["jobs"].values():
        for step in job.get("steps", []):
            if step.get("name") == name:
                script = step.get("run")
                assert isinstance(script, str), f"workflow step {name!r} does not have a run script"
                return script
    raise AssertionError(f"workflow step {name!r} was not found")


def run_workflow_script(script: str, tmp_path: Path, **env_overrides: str) -> tuple[subprocess.CompletedProcess[str], dict[str, str]]:
    github_output = tmp_path / "github-output"
    github_output.unlink(missing_ok=True)
    env = os.environ.copy()
    env.update(env_overrides)
    env["GITHUB_OUTPUT"] = str(github_output)
    result = subprocess.run(
        ["bash", "-e", "-u", "-o", "pipefail", "-c", script],
        cwd=tmp_path,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    outputs: dict[str, str] = {}
    if github_output.is_file():
        for line in github_output.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            assert separator, f"invalid GITHUB_OUTPUT line: {line!r}"
            outputs[key] = value
    return result, outputs


def run_git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        text=True,
        capture_output=True,
        check=True,
    ).stdout.strip()


def create_ref_resolution_remote(tmp_path: Path) -> tuple[Path, dict[str, str]]:
    source = tmp_path / "source"
    source.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main", str(source)], check=True)
    run_git(source, "config", "user.name", "Nightly Test")
    run_git(source, "config", "user.email", "nightly@example.invalid")

    fixture = source / "fixture.txt"
    fixture.write_text("one\n", encoding="utf-8")
    run_git(source, "add", "fixture.txt")
    run_git(source, "commit", "-q", "-m", "first")
    first = run_git(source, "rev-parse", "HEAD")
    run_git(source, "tag", "v1.2.0")
    run_git(source, "branch", "feature/ref-resolution", first)

    fixture.write_text("two\n", encoding="utf-8")
    run_git(source, "commit", "-q", "-am", "second")
    unadvertised = run_git(source, "rev-parse", "HEAD")

    fixture.write_text("three\n", encoding="utf-8")
    run_git(source, "commit", "-q", "-am", "stable")
    v2_stable = run_git(source, "rev-parse", "HEAD")
    run_git(source, "tag", "-a", "v2.0.0", "-m", "stable v2")

    fixture.write_text("four\n", encoding="utf-8")
    run_git(source, "commit", "-q", "-am", "stable without tag prefix")
    stable = run_git(source, "rev-parse", "HEAD")
    run_git(source, "tag", "2.1.0")

    fixture.write_text("release candidate\n", encoding="utf-8")
    run_git(source, "commit", "-q", "-am", "release candidate")
    main = run_git(source, "rev-parse", "HEAD")
    run_git(source, "tag", "v3.0.0-rc.1")

    remote = tmp_path / "remote.git"
    subprocess.run(["git", "clone", "-q", "--bare", str(source), str(remote)], check=True)
    return remote, {
        "first": first,
        "unadvertised": unadvertised,
        "v2_stable": v2_stable,
        "stable": stable,
        "main": main,
    }


def gate_workspace(root: Path) -> gascity_pack_inference_gate.GateWorkspace:
    workspace = gascity_pack_inference_gate.GateWorkspace(
        root=root,
        city_dir=root / "city",
        rig_dir=root / "fixture",
        gc_home=root / "gc-home",
        runtime_dir=root / "runtime",
        claude_config_dir=root / "gc-home" / ".claude",
        city_name="inference-city",
        rig_name="fixture",
    )
    workspace.city_dir.mkdir()
    workspace.rig_dir.mkdir()
    return workspace


def test_write_gate_workspace_uses_city_and_rig_scope_imports(tmp_path) -> None:
    pack_source = tmp_path / "repo" / "gascity"
    roles_source = pack_source / "roles"
    pack_source.mkdir(parents=True)
    roles_source.mkdir()

    workspace = gascity_pack_inference_gate.write_gate_workspace(
        tmp_path / "gate",
        pack_source=pack_source,
        roles_source=roles_source,
        city_name="inference-city",
        rig_name="fixture",
    )

    city_toml = (workspace.city_dir / "city.toml").read_text(encoding="utf-8")
    pack_toml = (workspace.city_dir / "pack.toml").read_text(encoding="utf-8")
    site_toml = (workspace.city_dir / ".gc" / "site.toml").read_text(encoding="utf-8")

    assert '[workspace]\nprovider = "claude"\n' in city_toml
    assert "includes =" not in city_toml
    assert "[workspace.env]" in city_toml
    assert f"HOME = \"{workspace.gc_home}\"" in city_toml
    assert '[providers.claude]\nbase = "builtin:claude"\n' in city_toml
    assert "args_append" not in city_toml
    assert "accept_startup_dialogs" not in city_toml
    assert "[beads]" not in city_toml
    assert 'provider = "file"' not in city_toml
    assert "[session]\n" in city_toml
    assert "provider = \"tmux\"" not in city_toml
    assert "socket =" not in city_toml
    assert 'startup_timeout = "3m"' in city_toml
    assert "[[rigs]]" in city_toml
    assert 'name = "fixture"' in city_toml
    assert "[rigs.imports.gc]" in city_toml
    assert f'source = "{roles_source}"' in city_toml
    assert 'workspace_name = "inference-city"' in site_toml
    assert "[[rig]]" in site_toml
    assert 'name = "fixture"' in site_toml
    assert f'path = "{workspace.rig_dir}"' in site_toml

    assert '[pack]\nname = "gascity-pack-inference-gate"\nschema = 2\n' in pack_toml
    assert "[imports.core]" in pack_toml
    assert "[imports.maintenance]" not in pack_toml
    assert "[imports.bd]" in pack_toml
    assert "[imports.gc]" in pack_toml
    assert f'source = "{pack_source}"' in pack_toml

    assert not (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_SUBJECT_PATH).exists()
    subject_path = gascity_pack_inference_gate.write_review_subject(workspace.rig_dir)
    subject = subject_path.read_text(encoding="utf-8")
    assert "shell=True" in subject
    assert "destination" in subject

    slugger = (workspace.rig_dir / "slugger.py").read_text(encoding="utf-8")
    slugger_test = (workspace.rig_dir / "tests" / "test_slugger.py").read_text(encoding="utf-8")
    assert "NotImplementedError" in slugger
    assert "slugify" in slugger_test
    assert "Hello, World!" in slugger_test


def test_write_gate_workspace_materializes_pack_check_scripts(tmp_path) -> None:
    pack_source = tmp_path / "repo" / "gascity"
    roles_source = pack_source / "roles"
    checks_source = pack_source / "assets" / "scripts" / "checks"
    schemas_source = pack_source / "schemas" / "build"
    checks_source.mkdir(parents=True)
    schemas_source.mkdir(parents=True)
    roles_source.mkdir()

    check_script = checks_source / "build-artifact-valid.sh"
    check_script.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
    check_script.chmod(0o755)
    validator = pack_source / "assets" / "scripts" / "validate_build_artifact.py"
    validator.write_text("print('ok')\n", encoding="utf-8")
    schema = schemas_source / "requirements.v1.yaml"
    schema.write_text("schema_id: gc.build.requirements.v1\n", encoding="utf-8")

    workspace = gascity_pack_inference_gate.write_gate_workspace(
        tmp_path / "gate",
        pack_source=pack_source,
        roles_source=roles_source,
        city_name="inference-city",
        rig_name="fixture",
    )

    materialized_check = workspace.rig_dir / ".gc" / "scripts" / "checks" / "build-artifact-valid.sh"
    materialized_validator = workspace.rig_dir / ".gc" / "scripts" / "validate_build_artifact.py"
    materialized_schema = workspace.rig_dir / "schemas" / "build" / "requirements.v1.yaml"

    assert materialized_check.read_text(encoding="utf-8") == "#!/usr/bin/env bash\nexit 0\n"
    assert os.access(materialized_check, os.X_OK)
    assert materialized_validator.read_text(encoding="utf-8") == "print('ok')\n"
    assert materialized_schema.read_text(encoding="utf-8") == "schema_id: gc.build.requirements.v1\n"


def test_write_gate_workspace_imports_selected_pack_and_shared_validator(tmp_path) -> None:
    pack_source = tmp_path / "repo" / "superpowers"
    roles_source = tmp_path / "repo" / "gascity" / "roles"
    validator_source = tmp_path / "repo" / "gascity"
    checks_source = validator_source / "assets" / "scripts" / "checks"
    checks_source.mkdir(parents=True)
    roles_source.mkdir(parents=True)
    pack_source.mkdir(parents=True)

    check_script = checks_source / "build-artifact-valid.sh"
    check_script.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
    validator = validator_source / "assets" / "scripts" / "validate_build_artifact.py"
    validator.write_text("print('shared-validator')\n", encoding="utf-8")

    workspace = gascity_pack_inference_gate.write_gate_workspace(
        tmp_path / "gate",
        pack_source=pack_source,
        roles_source=roles_source,
        validator_source=validator_source,
        pack_binding="superpowers",
        pack_name="superpowers",
        city_name="superpowers-inference-city",
        rig_name="fixture",
    )

    city_toml = (workspace.city_dir / "city.toml").read_text(encoding="utf-8")
    pack_toml = (workspace.city_dir / "pack.toml").read_text(encoding="utf-8")

    assert '[pack]\nname = "superpowers-pack-inference-gate"\nschema = 2\n' in pack_toml
    assert "[imports.superpowers]" in pack_toml
    assert f'source = "{pack_source}"' in pack_toml
    assert "[rigs.imports.gc]" in city_toml
    assert f'source = "{roles_source}"' in city_toml
    assert "[rigs.imports.superpowers]" in city_toml
    assert f'source = "{pack_source}"' in city_toml
    assert (
        workspace.rig_dir / ".gc" / "scripts" / "validate_build_artifact.py"
    ).read_text(encoding="utf-8") == "print('shared-validator')\n"


def test_write_gate_workspace_wires_gastown_city_and_rig_imports(tmp_path) -> None:
    pack_source = tmp_path / "repo" / "gastown"
    roles_source = tmp_path / "repo" / "gascity" / "roles"
    pack_source.mkdir(parents=True)
    roles_source.mkdir(parents=True)

    workspace = gascity_pack_inference_gate.write_gate_workspace(
        tmp_path / "gate",
        pack_source=pack_source,
        roles_source=roles_source,
        pack_binding="gastown",
        pack_name="gastown",
        gastown=True,
        city_name="gastown-inference-city",
        rig_name="fixture",
    )

    city_toml = (workspace.city_dir / "city.toml").read_text(encoding="utf-8")
    pack_toml = (workspace.city_dir / "pack.toml").read_text(encoding="utf-8")

    assert 'global_fragments = ["command-glossary", "operational-awareness"]' in city_toml
    assert "[defaults.rig.imports.gastown]" not in city_toml
    assert "[rigs.imports.gastown]" in city_toml
    assert f'source = "{pack_source}"' in city_toml
    assert "[rigs.imports.gc]" not in city_toml
    assert "[imports.gastown]" in pack_toml
    assert f'source = "{pack_source}"' in pack_toml


def test_build_gate_env_uses_nightly_ollama_auth_shape(tmp_path) -> None:
    workspace = gascity_pack_inference_gate.GateWorkspace(
        root=tmp_path,
        city_dir=tmp_path / "city",
        rig_dir=tmp_path / "fixture",
        gc_home=tmp_path / "gc-home",
        runtime_dir=tmp_path / "runtime",
        claude_config_dir=tmp_path / "gc-home" / ".claude",
        city_name="inference-city",
        rig_name="fixture",
    )
    workspace.gc_home.mkdir(parents=True)

    env = gascity_pack_inference_gate.build_gate_env(
        "/usr/bin/gc",
        workspace,
        inherited={
            "PATH": "/usr/bin",
            "HOME": str(tmp_path / "home"),
            "OLLAMA_API_KEY": "ollama-secret",
        },
    )

    assert env["ANTHROPIC_BASE_URL"] == "https://ollama.com"
    assert env["ANTHROPIC_AUTH_TOKEN"] == "ollama-secret"
    assert env["HOME"] == str(tmp_path / "home")
    assert "ANTHROPIC_API_KEY" not in env
    assert "GC_SESSION" not in env
    assert "GC_BEADS" not in env
    assert "GC_DOLT" not in env
    assert env["DOLT_ROOT_PATH"] == str(workspace.gc_home)
    dolt_config = json.loads((workspace.gc_home / ".dolt" / "config_global.json").read_text(encoding="utf-8"))
    assert dolt_config["user.email"] == "gascity-pack-gate@example.invalid"


def test_supported_pack_nightly_workflow_uses_tier_c_ollama_shape_and_pack_matrix() -> None:
    workflow = SUPPORTED_PACK_NIGHTLY_WORKFLOW.read_text(encoding="utf-8")

    assert "name: Supported Pack Nightly" in workflow
    assert "\n  schedule:" in workflow
    assert "\n  pull_request:" not in workflow
    assert "\n  push:" not in workflow
    assert 'default: main' in workflow
    assert "description: \"Supported pack or group to exercise for manual subset checks.\"" in workflow
    assert "description: \"Inference gate to run for manual subset checks.\"" in workflow
    assert "name: Select gates and validate timeout" in workflow
    assert "id: subset" in workflow
    assert "SELECTED_GATES: ${{ needs.resolve-nightly-inputs.outputs.selected_gates }}" in workflow
    assert "MATRIX_PACK: ${{ matrix.pack }}" in workflow
    assert "MATRIX_GATE: ${{ matrix.gate }}" in workflow
    assert "github.event.inputs.pack == matrix.pack" not in workflow
    assert "github.event.inputs.gate == matrix.gate" not in workflow
    assert "run_gate=true" in workflow
    assert "if: steps.subset.outputs.run_gate == 'true'" in workflow
    assert "if: always() && steps.subset.outputs.run_gate == 'true'" in workflow
    assert "max-parallel: 1" in workflow
    assert "runs-on: blacksmith-32vcpu-ubuntu-2404" in workflow
    assert "GATE_TIMEOUT: ${{ needs.resolve-nightly-inputs.outputs.gate_timeout || matrix.gate_timeout }}" in workflow
    assert '--timeout "$GATE_TIMEOUT"' in workflow
    assert 'DOLT_VERSION: "2.1.7"' in workflow
    assert 'BD_VERSION: "v1.1.0"' in workflow
    assert 'go-version: "1.26.5"' in workflow
    assert "name: Verify Beads compatibility" in workflow
    assert "github.com/steveyegge/beads" in workflow
    assert "resolve-nightly-inputs:" in workflow
    assert "needs: [resolve-nightly-inputs, static-contracts]" in workflow
    assert "needs.resolve-nightly-inputs.outputs.runtime_ref" in workflow
    assert "needs.resolve-nightly-inputs.outputs.setup_ref" in workflow
    assert 'GASCITY_REMOTE: https://github.com/gastownhall/gascity.git' in workflow
    assert "ANTHROPIC_BASE_URL: https://ollama.com" in workflow
    assert "ANTHROPIC_API_KEY: ${{ secrets.OLLAMA_API_KEY }}" in workflow
    assert "ANTHROPIC_AUTH_TOKEN: ${{ secrets.OLLAMA_API_KEY }}" in workflow
    assert "OLLAMA_API_KEY: ${{ secrets.OLLAMA_API_KEY }}" in workflow
    expected_entries = (
        ("gascity", "review", "30m"),
        ("gascity", "build-basic", "90m"),
        ("superpowers", "review", "45m"),
        ("superpowers", "build", "100m"),
        ("compound-engineering", "review", "45m"),
        ("compound-engineering", "build", "100m"),
        ("gstack", "review", "60m"),
        ("gstack", "build", "130m"),
        ("bmad", "review", "45m"),
        ("bmad", "build", "100m"),
        ("gastown", "gastown-orchestration", "110m"),
    )
    for pack, gate, gate_timeout in expected_entries:
        assert f"- pack: {pack}" in workflow
        assert f"gate: {gate}" in workflow
        assert f"gate_timeout: {gate_timeout}" in workflow
    assert '--pack "${{ matrix.pack }}"' in workflow
    assert '--gate "${{ matrix.gate }}"' in workflow
    assert "name: supported-pack-nightly-${{ matrix.pack }}-${{ matrix.gate }}" in workflow
    assert "include-hidden-files: true" in workflow


@pytest.mark.parametrize(
    ("selected_pack", "selected_gate", "expected"),
    (
        ("gascity", "build", {"gascity:build-basic"}),
        (
            "all-supported",
            "build",
            {
                "gascity:build-basic",
                "superpowers:build",
                "compound-engineering:build",
                "gstack:build",
                "bmad:build",
            },
        ),
        (
            "methodology",
            "all",
            {
                "superpowers:review",
                "superpowers:build",
                "compound-engineering:review",
                "compound-engineering:build",
                "gstack:review",
                "gstack:build",
                "bmad:review",
                "bmad:build",
            },
        ),
        (
            "",
            "",
            {
                "gascity:review",
                "gascity:build-basic",
                "superpowers:review",
                "superpowers:build",
                "compound-engineering:review",
                "compound-engineering:build",
                "gstack:review",
                "gstack:build",
                "bmad:review",
                "bmad:build",
                "gastown:gastown-orchestration",
            },
        ),
    ),
)
def test_supported_pack_nightly_selects_manual_matrix_rows(
    tmp_path, selected_pack: str, selected_gate: str, expected: set[str]
) -> None:
    document = supported_pack_nightly_document()
    result, outputs = run_workflow_script(
        supported_pack_nightly_step_script("Select gates and validate timeout"),
        tmp_path,
        INPUT_PACK=selected_pack,
        INPUT_GATE=selected_gate,
        INPUT_TIMEOUT="",
        SUPPORTED_PACK_GATES=document["env"]["SUPPORTED_PACK_GATES"],
    )

    assert result.returncode == 0, result.stderr
    assert set(outputs["selected_gates"].split(",")) == expected
    assert outputs["gate_timeout"] == ""
    assert outputs["job_timeout_minutes"] == ""

    selected_rows: set[str] = set()
    subset_script = supported_pack_nightly_step_script("Decide manual subset")
    for entry in document["jobs"]["inference"]["strategy"]["matrix"]["include"]:
        result, subset_outputs = run_workflow_script(
            subset_script,
            tmp_path,
            SELECTED_GATES=outputs["selected_gates"],
            MATRIX_PACK=entry["pack"],
            MATRIX_GATE=entry["gate"],
        )
        assert result.returncode == 0, result.stderr
        if subset_outputs["run_gate"] == "true":
            selected_rows.add(f"{entry['pack']}:{entry['gate']}")
    assert selected_rows == expected


@pytest.mark.parametrize(
    ("selected_pack", "selected_gate"),
    (
        ("gascity", "gastown-orchestration"),
        ("methodology", "build-basic"),
        ("superpowers", "build-basic"),
        ("gastown", "review"),
    ),
)
def test_supported_pack_nightly_rejects_empty_manual_selections(
    tmp_path, selected_pack: str, selected_gate: str
) -> None:
    document = supported_pack_nightly_document()
    result, _ = run_workflow_script(
        supported_pack_nightly_step_script("Select gates and validate timeout"),
        tmp_path,
        INPUT_PACK=selected_pack,
        INPUT_GATE=selected_gate,
        INPUT_TIMEOUT="",
        SUPPORTED_PACK_GATES=document["env"]["SUPPORTED_PACK_GATES"],
    )

    assert result.returncode != 0
    assert "selects no supported pack gates" in result.stderr


@pytest.mark.parametrize(
    ("timeout_override", "expected_outer_minutes"),
    (
        ("90m", "120"),
        ("1.5h", "120"),
        ("30", "31"),
        ("330m", "360"),
    ),
)
def test_supported_pack_nightly_bounds_manual_timeout(
    tmp_path, timeout_override: str, expected_outer_minutes: str
) -> None:
    document = supported_pack_nightly_document()
    result, outputs = run_workflow_script(
        supported_pack_nightly_step_script("Select gates and validate timeout"),
        tmp_path,
        INPUT_PACK="gascity",
        INPUT_GATE="review",
        INPUT_TIMEOUT=timeout_override,
        SUPPORTED_PACK_GATES=document["env"]["SUPPORTED_PACK_GATES"],
    )

    assert result.returncode == 0, result.stderr
    assert outputs["gate_timeout"] == timeout_override
    assert outputs["job_timeout_minutes"] == expected_outer_minutes


@pytest.mark.parametrize("timeout_override", ("-1m", "0s", "331m", "5.6h", "soon"))
def test_supported_pack_nightly_rejects_invalid_manual_timeout(tmp_path, timeout_override: str) -> None:
    document = supported_pack_nightly_document()
    result, _ = run_workflow_script(
        supported_pack_nightly_step_script("Select gates and validate timeout"),
        tmp_path,
        INPUT_PACK="gascity",
        INPUT_GATE="review",
        INPUT_TIMEOUT=timeout_override,
        SUPPORTED_PACK_GATES=document["env"]["SUPPORTED_PACK_GATES"],
    )

    assert result.returncode != 0
    assert "Invalid timeout override" in result.stderr


def test_supported_pack_nightly_resolves_remote_refs_to_commit_shas(tmp_path) -> None:
    resolver = supported_pack_nightly_step_script("Resolve immutable refs")
    remote, refs = create_ref_resolution_remote(tmp_path)
    common_env = {
        "GASCITY_REMOTE": str(remote),
        "PACK_REMOTE": str(remote),
        "DEFAULT_PACK_SHA": refs["main"],
    }

    result, outputs = run_workflow_script(
        resolver,
        tmp_path,
        REQUESTED_RUNTIME_REF="latest",
        REQUESTED_SETUP_REF="feature/ref-resolution",
        REQUESTED_PACK_REF="v1.2.0",
        **common_env,
    )
    assert result.returncode == 0, result.stderr
    assert outputs["runtime_ref"] == refs["stable"]
    assert outputs["setup_ref"] == refs["first"]
    assert outputs["pack_ref"] == refs["first"]

    result, outputs = run_workflow_script(
        resolver,
        tmp_path,
        REQUESTED_RUNTIME_REF=refs["unadvertised"],
        REQUESTED_SETUP_REF="v2.0.0",
        REQUESTED_PACK_REF="",
        **common_env,
    )
    assert result.returncode == 0, result.stderr
    assert outputs["runtime_ref"] == refs["unadvertised"]
    assert outputs["setup_ref"] == refs["v2_stable"]
    assert outputs["pack_ref"] == refs["main"]

    result, outputs = run_workflow_script(
        resolver,
        tmp_path,
        REQUESTED_RUNTIME_REF="main",
        REQUESTED_SETUP_REF="main",
        REQUESTED_PACK_REF="main",
        **common_env,
    )
    assert result.returncode == 0, result.stderr
    assert outputs == {
        "runtime_ref": refs["main"],
        "setup_ref": refs["main"],
        "pack_ref": refs["main"],
    }

    result, outputs = run_workflow_script(
        resolver,
        tmp_path,
        REQUESTED_RUNTIME_REF="main",
        REQUESTED_SETUP_REF="missing/ref",
        REQUESTED_PACK_REF="main",
        **common_env,
    )
    assert result.returncode != 0
    assert outputs == {}
    assert "Could not resolve Gas City setup ref" in result.stderr

    result, outputs = run_workflow_script(
        resolver,
        tmp_path,
        REQUESTED_RUNTIME_REF="f" * 40,
        REQUESTED_SETUP_REF="main",
        REQUESTED_PACK_REF="main",
        **common_env,
    )
    assert result.returncode != 0
    assert outputs == {}
    assert "Could not resolve Gas City runtime ref" in result.stderr

    result, outputs = run_workflow_script(
        resolver,
        tmp_path,
        REQUESTED_RUNTIME_REF="main",
        REQUESTED_SETUP_REF="latest",
        REQUESTED_PACK_REF="v9.9.9",
        **common_env,
    )
    assert result.returncode != 0
    assert outputs == {}
    assert "Could not resolve Gas City setup ref" in result.stderr


def test_supported_pack_nightly_consumes_only_resolved_refs_and_timeout() -> None:
    document = supported_pack_nightly_document()
    workflow = SUPPORTED_PACK_NIGHTLY_WORKFLOW.read_text(encoding="utf-8")
    jobs = document["jobs"]
    resolver = jobs["resolve-nightly-inputs"]
    matrix_entries = jobs["inference"]["strategy"]["matrix"]["include"]
    expected_matrix = {f"{entry['pack']}:{entry['gate']}" for entry in matrix_entries}

    assert set(document["env"]["SUPPORTED_PACK_GATES"].split()) == expected_matrix
    assert jobs["static-contracts"]["needs"] == "resolve-nightly-inputs"
    assert jobs["inference"]["needs"] == ["resolve-nightly-inputs", "static-contracts"]
    assert resolver["outputs"]["pack_ref"] == "${{ steps.refs.outputs.pack_ref }}"
    assert resolver["outputs"]["runtime_ref"] == "${{ steps.refs.outputs.runtime_ref }}"
    assert resolver["outputs"]["setup_ref"] == "${{ steps.refs.outputs.setup_ref }}"
    assert jobs["inference"]["timeout-minutes"] == (
        "${{ fromJSON(needs.resolve-nightly-inputs.outputs.job_timeout_minutes || '0') || matrix.timeout_minutes }}"
    )
    assert workflow.count("ref: ${{ needs.resolve-nightly-inputs.outputs.pack_ref }}") == 2
    assert "ref: ${{ needs.resolve-nightly-inputs.outputs.setup_ref }}" in workflow
    assert "GASCITY_REF: ${{ needs.resolve-nightly-inputs.outputs.runtime_ref }}" in workflow
    assert "GATE_TIMEOUT: ${{ needs.resolve-nightly-inputs.outputs.gate_timeout || matrix.gate_timeout }}" in workflow
    assert "ref: ${{ github.event.inputs.pack_ref || github.ref }}" not in workflow
    assert "printf '%s\\n' \"$requested\"" not in supported_pack_nightly_step_script("Resolve immutable refs")


def test_dispatch_inference_workflow_is_manual_or_external_only() -> None:
    workflow = (gascity_pack_inference_gate.REPO_ROOT / ".github" / "workflows" / "gascity-pack-inference.yml").read_text(
        encoding="utf-8"
    )

    assert "repository_dispatch:" in workflow
    assert "workflow_dispatch:" in workflow
    assert "\n  schedule:" not in workflow
    assert "\n  pull_request:" not in workflow
    assert "\n  push:" not in workflow
    assert "runs-on: blacksmith-32vcpu-ubuntu-2404" in workflow
    assert 'DOLT_VERSION: "2.1.0"' in workflow
    assert "ANTHROPIC_API_KEY: ${{ secrets.OLLAMA_API_KEY }}" in workflow
    assert "include-hidden-files: true" in workflow


def test_ci_workflows_use_blacksmith_runner_labels() -> None:
    expected = {
        ".github/workflows/ci.yml": "runs-on: blacksmith-32vcpu-ubuntu-2404",
        ".github/workflows/codeql.yml": "runs-on: blacksmith-32vcpu-ubuntu-2404",
        ".github/workflows/pack-release-compatibility.yml": "runs-on: blacksmith-32vcpu-ubuntu-2404",
    }

    for relative_path, marker in expected.items():
        workflow = (gascity_pack_inference_gate.REPO_ROOT / relative_path).read_text(encoding="utf-8")
        assert marker in workflow


def test_readme_includes_blacksmith_sponsor_badge() -> None:
    readme = (gascity_pack_inference_gate.REPO_ROOT / "README.md").read_text(encoding="utf-8")
    readme_lines = {line.strip() for line in readme.splitlines()}

    assert "## Sponsors" in readme
    assert '<a href="https://blacksmith.sh/">' in readme_lines
    assert "docs/images/blacksmith-powered.png" in readme
    assert (gascity_pack_inference_gate.REPO_ROOT / "docs" / "images" / "blacksmith-powered.png").is_file()


def test_build_gate_env_exposes_host_pytest_to_isolated_runtime(tmp_path) -> None:
    workspace = gascity_pack_inference_gate.GateWorkspace(
        root=tmp_path,
        city_dir=tmp_path / "city",
        rig_dir=tmp_path / "fixture",
        gc_home=tmp_path / "gc-home",
        runtime_dir=tmp_path / "runtime",
        claude_config_dir=tmp_path / "gc-home" / ".claude",
        city_name="inference-city",
        rig_name="fixture",
    )
    workspace.gc_home.mkdir(parents=True)
    existing_pythonpath = str(tmp_path / "existing-pythonpath")

    env = gascity_pack_inference_gate.build_gate_env(
        "/usr/bin/gc",
        workspace,
        inherited={
            "PATH": "/usr/bin",
            "HOME": str(tmp_path / "home"),
            "OLLAMA_API_KEY": "ollama-secret",
            "PYTHONPATH": existing_pythonpath,
        },
    )

    pytest_root = Path(pytest.__file__).resolve().parent.parent
    pythonpath_parts = env["PYTHONPATH"].split(os.pathsep)
    assert pythonpath_parts[0] == existing_pythonpath
    assert str(pytest_root) in pythonpath_parts


def test_seed_claude_project_state_writes_home_and_config_state(tmp_path) -> None:
    home = tmp_path / "home"
    config_dir = tmp_path / "claude-config"
    city_dir = tmp_path / "city"
    rig_dir = tmp_path / "rig"
    city_dir.mkdir()
    rig_dir.mkdir()

    gascity_pack_inference_gate.seed_claude_project_state(
        home=home,
        config_dir=config_dir,
        project_paths=[city_dir, rig_dir],
    )

    for state_path in (home / ".claude.json", config_dir / ".claude.json"):
        data = json.loads(state_path.read_text(encoding="utf-8"))
        assert data["hasCompletedOnboarding"] is True
        assert data["theme"] == "light"
        for project in (city_dir.resolve(), rig_dir.resolve()):
            entry = data["projects"][str(project)]
            assert entry["hasCompletedProjectOnboarding"] is True
            assert entry["hasTrustDialogAccepted"] is True
            assert entry["projectOnboardingSeenCount"] == 1


def test_find_unique_bead_by_title_rejects_missing_or_ambiguous() -> None:
    beads = [
        {"id": "bd-1", "title": "other", "status": "open"},
        {"id": "bd-2", "title": "gate title", "status": "open"},
    ]

    assert gascity_pack_inference_gate.find_unique_bead_by_title(beads, "gate title")["id"] == "bd-2"
    assert gascity_pack_inference_gate.find_unique_bead_by_title(beads, "missing") is None
    assert gascity_pack_inference_gate.find_unique_bead_by_title(beads + [beads[1]], "gate title") is None


def test_extract_sling_root_id_searches_nested_json() -> None:
    output = """
    warning: ignored line
    {"dispatch": {"root_bead_id": "rv-123", "nested": [{"id": "other"}]}}
    """

    assert gascity_pack_inference_gate.extract_sling_root_id(output) == "rv-123"
    assert gascity_pack_inference_gate.extract_sling_root_id("not json") is None


def test_launch_review_formula_uses_absolute_rig_artifact_paths(tmp_path) -> None:
    root = tmp_path / "gate with spaces"
    root.mkdir()
    workspace = gate_workspace(root)
    fake_gc = tmp_path / "gc"
    args_path = tmp_path / "gc-args.txt"
    fake_gc.write_text(
        f"""#!/bin/sh
printf '%s\\n' "$@" > {shlex.quote(str(args_path))}
printf '{{"root_bead_id":"fi-root"}}\\n'
""",
        encoding="utf-8",
    )
    fake_gc.chmod(0o755)

    root_id = gascity_pack_inference_gate.launch_review_formula(
        str(fake_gc),
        workspace,
        env={},
        pack_spec=gascity_pack_inference_gate.PACK_SPECS["gascity"],
    )

    assert root_id == "fi-root"
    args = args_path.read_text(encoding="utf-8").splitlines()
    subject_path = (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_SUBJECT_PATH).resolve()
    report_path = (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_REPORT_PATH).resolve()
    assert f"subject_path={subject_path}" in args
    assert f"report_path={report_path}" in args
    assert f"subject_path={gascity_pack_inference_gate.REVIEW_SUBJECT_PATH}" not in args
    assert f"report_path={gascity_pack_inference_gate.REVIEW_REPORT_PATH}" not in args


def test_list_beads_uses_gc_bd_list_when_file_store_absent(tmp_path) -> None:
    workspace = gascity_pack_inference_gate.GateWorkspace(
        root=tmp_path,
        city_dir=tmp_path / "city",
        rig_dir=tmp_path / "fixture",
        gc_home=tmp_path / "gc-home",
        runtime_dir=tmp_path / "runtime",
        claude_config_dir=tmp_path / "gc-home" / ".claude",
        city_name="inference-city",
        rig_name="fixture",
    )
    workspace.city_dir.mkdir()
    workspace.rig_dir.mkdir()
    fake_gc = tmp_path / "gc"
    args_path = tmp_path / "gc-args.txt"
    fake_gc.write_text(
        f"""#!/bin/sh
printf '%s\\n' "$@" > {shlex.quote(str(args_path))}
printf 'warning: noisy config refresh\\n' >&2
printf '[{{"id":"fi-1","title":"root","status":"open"}}]\\n'
""",
        encoding="utf-8",
    )
    fake_gc.chmod(0o755)

    beads = gascity_pack_inference_gate.list_beads(str(fake_gc), workspace, env={})

    assert beads == [{"id": "fi-1", "title": "root", "status": "open"}]
    assert args_path.read_text(encoding="utf-8").splitlines()[-4:] == ["--all", "--json", "--limit", "1000"]


def test_list_beads_falls_back_to_city_event_log_when_live_list_is_empty(tmp_path) -> None:
    workspace = gascity_pack_inference_gate.GateWorkspace(
        root=tmp_path,
        city_dir=tmp_path / "city",
        rig_dir=tmp_path / "fixture",
        gc_home=tmp_path / "gc-home",
        runtime_dir=tmp_path / "runtime",
        claude_config_dir=tmp_path / "gc-home" / ".claude",
        city_name="inference-city",
        rig_name="fixture",
    )
    (workspace.city_dir / ".gc").mkdir(parents=True)
    workspace.rig_dir.mkdir()
    fake_gc = tmp_path / "gc"
    fake_gc.write_text("#!/bin/sh\nprintf '[]\\n'\n", encoding="utf-8")
    fake_gc.chmod(0o755)

    event = {
        "type": "bead.updated",
        "payload": {
            "bead": {
                "id": "fi-dk42",
                "title": "Write review report",
                "status": "closed",
                "metadata": {
                    "gc.run_target": "gc.implementation-reviewer",
                    "gc.routed_to": "fixture/gc.implementation-reviewer",
                },
            }
        },
    }
    (workspace.city_dir / ".gc" / "events.jsonl").write_text(json.dumps(event) + "\n", encoding="utf-8")

    beads = gascity_pack_inference_gate.list_beads(str(fake_gc), workspace, env={})

    assert beads == [event["payload"]["bead"]]
    gascity_pack_inference_gate.validate_required_routes(
        beads,
        ["gc.implementation-reviewer"],
        context="replayed review gate",
    )


def test_list_beads_falls_back_to_current_city_event_log_shape(tmp_path) -> None:
    workspace = gascity_pack_inference_gate.GateWorkspace(
        root=tmp_path,
        city_dir=tmp_path / "city",
        rig_dir=tmp_path / "fixture",
        gc_home=tmp_path / "gc-home",
        runtime_dir=tmp_path / "runtime",
        claude_config_dir=tmp_path / "gc-home" / ".claude",
        city_name="inference-city",
        rig_name="fixture",
    )
    (workspace.city_dir / ".gc").mkdir(parents=True)
    workspace.rig_dir.mkdir()
    fake_gc = tmp_path / "gc"
    fake_gc.write_text("#!/bin/sh\nprintf '[]\\n'\n", encoding="utf-8")
    fake_gc.chmod(0o755)

    event = {
        "type": "bead.closed",
        "payload": {
            "id": "fi-dk42",
            "title": "Write review report",
            "status": "closed",
            "metadata": {
                "gc.run_target": "gc.implementation-reviewer",
                "gc.routed_to": "fixture/gc.implementation-reviewer",
            },
        },
    }
    (workspace.city_dir / ".gc" / "events.jsonl").write_text(json.dumps(event) + "\n", encoding="utf-8")

    beads = gascity_pack_inference_gate.list_beads(str(fake_gc), workspace, env={})

    assert beads == [event["payload"]]
    gascity_pack_inference_gate.validate_required_routes(
        beads,
        ["gc.implementation-reviewer"],
        context="replayed current event gate",
    )


def test_list_beads_merges_event_route_history_when_live_list_is_incomplete(tmp_path) -> None:
    workspace = gascity_pack_inference_gate.GateWorkspace(
        root=tmp_path,
        city_dir=tmp_path / "city",
        rig_dir=tmp_path / "fixture",
        gc_home=tmp_path / "gc-home",
        runtime_dir=tmp_path / "runtime",
        claude_config_dir=tmp_path / "gc-home" / ".claude",
        city_name="inference-city",
        rig_name="fixture",
    )
    (workspace.city_dir / ".gc").mkdir(parents=True)
    workspace.rig_dir.mkdir()
    fake_gc = tmp_path / "gc"
    fake_gc.write_text(
        """#!/bin/sh
printf '[{"id":"fi-hm7i","title":"Write review report","assignee":"fixture--control-dispatcher"}]\n'
""",
        encoding="utf-8",
    )
    fake_gc.chmod(0o755)

    event = {
        "type": "bead.updated",
        "payload": {
            "bead": {
                "id": "fi-glhz",
                "title": "Write review report",
                "status": "closed",
                "metadata": {
                    "gc.run_target": "gc.implementation-reviewer",
                    "gc.routed_to": "fixture/gc.implementation-reviewer",
                },
            }
        },
    }
    (workspace.city_dir / ".gc" / "events.jsonl").write_text(json.dumps(event) + "\n", encoding="utf-8")

    beads = gascity_pack_inference_gate.list_beads(str(fake_gc), workspace, env={})

    assert beads[0]["id"] == "fi-hm7i"
    assert beads[1]["id"] == "__gc_event_route_history__"
    assert gascity_pack_inference_gate.find_unique_bead_by_title(beads, "Write review report")["id"] == "fi-hm7i"
    gascity_pack_inference_gate.validate_required_routes(
        beads,
        ["gc.implementation-reviewer"],
        context="review gate with live list",
    )


def test_wait_for_workflow_pass_uses_bd_show_for_closed_root(tmp_path) -> None:
    workspace = gascity_pack_inference_gate.GateWorkspace(
        root=tmp_path,
        city_dir=tmp_path / "city",
        rig_dir=tmp_path / "fixture",
        gc_home=tmp_path / "gc-home",
        runtime_dir=tmp_path / "runtime",
        claude_config_dir=tmp_path / "gc-home" / ".claude",
        city_name="inference-city",
        rig_name="fixture",
    )
    workspace.city_dir.mkdir()
    workspace.rig_dir.mkdir()
    fake_gc = tmp_path / "gc"
    args_path = tmp_path / "gc-args.txt"
    fake_gc.write_text(
        f"""#!/bin/sh
printf '%s\\n' "$*" >> {shlex.quote(str(args_path))}
case "$*" in
  *"bd show fi-root --json"*) # gc-bd-argv-tail: fake gc receives the wrapper's argv tail
    printf '[{{"id":"fi-root","title":"root","status":"closed","metadata":{{"gc.outcome":"pass"}}}}]\\n'
    ;;
  *"bd list --all --json --limit 1000"*) # gc-bd-argv-tail: fake gc receives the wrapper's argv tail
    printf '[{{"id":"fi-finalize","title":"Finalize workflow","status":"closed","metadata":{{"gc.root_bead_id":"fi-root","gc.kind":"workflow-finalize","gc.outcome":"pass"}}}}]\\n'
    ;;
  *)
    printf '{{}}\\n'
    ;;
esac
""",
        encoding="utf-8",
    )
    fake_gc.chmod(0o755)

    bead = gascity_pack_inference_gate.wait_for_workflow_pass(
        str(fake_gc),
        workspace,
        "fi-root",
        env={},
        timeout=5,
        poll_interval=0,
    )

    assert bead["id"] == "fi-root"
    assert "bd show fi-root --json" in args_path.read_text(encoding="utf-8")  # gc-bd-argv-tail


def test_wait_for_workflow_pass_rejects_failed_logical_control(tmp_path) -> None:
    workspace = gate_workspace(tmp_path)
    fake_gc = tmp_path / "gc"
    fake_gc.write_text(
        """#!/bin/sh
case "$*" in
  *"bd show fi-root --json"*) # gc-bd-argv-tail: fake gc receives the wrapper's argv tail
    printf '[{"id":"fi-root","title":"root","status":"closed","metadata":{"gc.outcome":"pass"}}]\n'
    ;;
  *"bd list --all --json --limit 1000"*) # gc-bd-argv-tail: fake gc receives the wrapper's argv tail
    printf '[{"id":"fi-review","title":"Review implementation","status":"closed","metadata":{"gc.root_bead_id":"fi-root","gc.kind":"ralph","gc.outcome":"fail","gc.step_ref":"build.review"}}]\n'
    ;;
  *)
    printf '{}\n'
    ;;
esac
""",
        encoding="utf-8",
    )
    fake_gc.chmod(0o755)

    with pytest.raises(
        gascity_pack_inference_gate.GateError,
        match="logical workflow control failed.*fi-review.*build.review",
    ):
        gascity_pack_inference_gate.wait_for_workflow_pass(
            str(fake_gc),
            workspace,
            "fi-root",
            env={},
            timeout=5,
            poll_interval=0,
        )


def test_wait_for_workflow_pass_waits_for_non_attempt_finalizer(tmp_path, monkeypatch) -> None:
    workspace = gate_workspace(tmp_path)
    root = {"id": "fi-root", "status": "closed", "metadata": {"gc.outcome": "pass"}}
    snapshots = [
        [
            {
                "id": "fi-finalize-attempt",
                "status": "closed",
                "metadata": {
                    "gc.root_bead_id": "fi-root",
                    "gc.kind": "workflow-finalize",
                    "gc.attempt": "1",
                    "gc.outcome": "pass",
                },
            }
        ],
        [
            {
                "id": "fi-finalize",
                "status": "open",
                "metadata": {
                    "gc.root_bead_id": "fi-root",
                    "gc.kind": "workflow-finalize",
                },
            }
        ],
        [
            {
                "id": "fi-finalize",
                "status": "closed",
                "metadata": {
                    "gc.root_bead_id": "fi-root",
                    "gc.kind": "workflow-finalize",
                    "gc.outcome": "pass",
                },
            }
        ],
    ]
    observed: list[list[dict]] = []

    monkeypatch.setattr(gascity_pack_inference_gate, "show_bead", lambda *args, **kwargs: root)

    def list_beads(*args, **kwargs):
        snapshot = snapshots[min(len(observed), len(snapshots) - 1)]
        observed.append(snapshot)
        return snapshot

    monkeypatch.setattr(gascity_pack_inference_gate, "list_beads", list_beads)

    bead = gascity_pack_inference_gate.wait_for_workflow_pass(
        "gc",
        workspace,
        "fi-root",
        env={},
        timeout=5,
        poll_interval=0,
    )

    assert bead == root
    assert len(observed) == 3


def test_wait_for_workflow_pass_rejects_failed_finalizer(tmp_path, monkeypatch) -> None:
    workspace = gate_workspace(tmp_path)
    root = {"id": "fi-root", "status": "closed", "metadata": {"gc.outcome": "pass"}}
    finalizer = {
        "id": "fi-finalize",
        "title": "Finalize workflow",
        "status": "closed",
        "metadata": {
            "gc.root_bead_id": "fi-root",
            "gc.kind": "workflow-finalize",
            "gc.outcome": "fail",
        },
    }
    monkeypatch.setattr(gascity_pack_inference_gate, "show_bead", lambda *args, **kwargs: root)
    monkeypatch.setattr(gascity_pack_inference_gate, "list_beads", lambda *args, **kwargs: [finalizer])
    monkeypatch.setattr(gascity_pack_inference_gate, "collect_diagnostics", lambda *args, **kwargs: "diagnostics")

    with pytest.raises(gascity_pack_inference_gate.GateError, match="logical workflow control failed.*fi-finalize"):
        gascity_pack_inference_gate.wait_for_workflow_pass(
            "gc",
            workspace,
            "fi-root",
            env={},
            timeout=5,
            poll_interval=0,
        )


@pytest.mark.parametrize("marker", ("gc.blocked_reason", "gc.failure_class"))
def test_wait_for_workflow_pass_rejects_stale_root_failure_marker(tmp_path, monkeypatch, marker: str) -> None:
    workspace = gate_workspace(tmp_path)
    root = {
        "id": "fi-root",
        "status": "closed",
        "metadata": {"gc.outcome": "pass", marker: "stale failure state"},
    }
    finalizer = {
        "id": "fi-finalize",
        "status": "closed",
        "metadata": {
            "gc.root_bead_id": "fi-root",
            "gc.kind": "workflow-finalize",
            "gc.outcome": "pass",
        },
    }
    monkeypatch.setattr(gascity_pack_inference_gate, "show_bead", lambda *args, **kwargs: root)
    monkeypatch.setattr(gascity_pack_inference_gate, "list_beads", lambda *args, **kwargs: [finalizer])
    monkeypatch.setattr(gascity_pack_inference_gate, "collect_diagnostics", lambda *args, **kwargs: "diagnostics")

    with pytest.raises(gascity_pack_inference_gate.GateError, match=marker):
        gascity_pack_inference_gate.wait_for_workflow_pass(
            "gc",
            workspace,
            "fi-root",
            env={},
            timeout=5,
            poll_interval=0,
        )


def test_failed_logical_controls_ignore_attempt_beads() -> None:
    beads = [
        {
            "id": "fi-attempt",
            "title": "Review implementation",
            "status": "closed",
            "metadata": {
                "gc.root_bead_id": "fi-root",
                "gc.kind": "ralph",
                "gc.attempt": "1",
                "gc.logical_bead_id": "fi-review",
                "gc.outcome": "fail",
            },
        }
    ]

    assert gascity_pack_inference_gate.failed_logical_controls(beads, "fi-root") == []


def test_validate_review_report_requires_blocking_base_gascity_report(tmp_path) -> None:
    workspace = gate_workspace(tmp_path)
    subject_path = gascity_pack_inference_gate.write_review_subject(workspace.rig_dir).resolve()
    report_path = (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_REPORT_PATH).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        review_artifact_traced_to_subject(subject_path, status="changes_required"),
        encoding="utf-8",
    )

    gascity_pack_inference_gate.validate_review_report(
        {"metadata": {"gc.var.report_path": str(report_path)}},
        workspace,
        env={},
        pack_spec=gascity_pack_inference_gate.PACK_SPECS["gascity"],
    )


def test_validate_review_report_accepts_exact_methodology_adapter_report(tmp_path) -> None:
    workspace = gate_workspace(tmp_path)
    subject_path = gascity_pack_inference_gate.write_review_subject(workspace.rig_dir).resolve()
    report_path = (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_REPORT_PATH).resolve()
    internal_path = (workspace.rig_dir / ".gc" / "internal" / "review-report.md").resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    internal_path.parent.mkdir(parents=True)
    report = review_artifact_traced_to_subject(subject_path, status="approved")
    report_path.write_text(report, encoding="utf-8")
    internal_path.write_text(report, encoding="utf-8")
    pack_spec = replace(
        gascity_pack_inference_gate.PACK_SPECS["superpowers"],
        validator_source=gascity_pack_inference_gate.REPO_ROOT / "gascity",
    )

    gascity_pack_inference_gate.validate_review_report(
        {
            "metadata": {
                "gc.var.report_path": str(report_path),
                "gc.build.code_review_report_path": str(internal_path),
                "gc.build.review_subject_path": str(subject_path),
            }
        },
        workspace,
        env={},
        pack_spec=pack_spec,
    )


def test_validate_review_report_rejects_internal_alias_to_adapter(tmp_path) -> None:
    workspace = gate_workspace(tmp_path)
    subject_path = gascity_pack_inference_gate.write_review_subject(workspace.rig_dir).resolve()
    report_path = (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_REPORT_PATH).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        review_artifact_traced_to_subject(subject_path, status="changes_required"),
        encoding="utf-8",
    )
    pack_spec = replace(
        gascity_pack_inference_gate.PACK_SPECS["compound-engineering"],
        validator_source=gascity_pack_inference_gate.REPO_ROOT / "gascity",
    )

    with pytest.raises(gascity_pack_inference_gate.GateError, match="must be distinct"):
        gascity_pack_inference_gate.validate_review_report(
            {
                "metadata": {
                    "gc.var.report_path": str(report_path),
                    "gc.build.code_review_report_path": str(report_path),
                    "gc.build.review_subject_path": str(subject_path),
                }
            },
            workspace,
            env={},
            pack_spec=pack_spec,
        )


def test_validate_review_report_rejects_internal_hardlink_to_adapter(tmp_path) -> None:
    workspace = gate_workspace(tmp_path)
    subject_path = gascity_pack_inference_gate.write_review_subject(workspace.rig_dir).resolve()
    report_path = (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_REPORT_PATH).resolve()
    internal_path = (workspace.rig_dir / ".gc" / "internal" / "review-report.md").resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    internal_path.parent.mkdir(parents=True)
    report_path.write_text(
        review_artifact_traced_to_subject(subject_path, status="changes_required"),
        encoding="utf-8",
    )
    os.link(report_path, internal_path)
    pack_spec = replace(
        gascity_pack_inference_gate.PACK_SPECS["compound-engineering"],
        validator_source=gascity_pack_inference_gate.REPO_ROOT / "gascity",
    )

    with pytest.raises(gascity_pack_inference_gate.GateError, match="must be distinct"):
        gascity_pack_inference_gate.validate_review_report(
            {
                "metadata": {
                    "gc.var.report_path": str(report_path),
                    "gc.build.code_review_report_path": str(internal_path),
                    "gc.build.review_subject_path": str(subject_path),
                }
            },
            workspace,
            env={},
            pack_spec=pack_spec,
        )


def test_validate_review_report_rejects_internal_path_outside_rig(tmp_path) -> None:
    gate_root = tmp_path / "gate"
    gate_root.mkdir()
    workspace = gate_workspace(gate_root)
    subject_path = gascity_pack_inference_gate.write_review_subject(workspace.rig_dir).resolve()
    report_path = (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_REPORT_PATH).resolve()
    internal_path = (tmp_path / "outside" / "review-report.md").resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    internal_path.parent.mkdir(parents=True)
    report = review_artifact_traced_to_subject(subject_path, status="changes_required")
    report_path.write_text(report, encoding="utf-8")
    internal_path.write_text(report, encoding="utf-8")
    pack_spec = replace(
        gascity_pack_inference_gate.PACK_SPECS["gstack"],
        validator_source=gascity_pack_inference_gate.REPO_ROOT / "gascity",
    )

    with pytest.raises(gascity_pack_inference_gate.GateError, match="inside the nightly rig"):
        gascity_pack_inference_gate.validate_review_report(
            {
                "metadata": {
                    "gc.var.report_path": str(report_path),
                    "gc.build.code_review_report_path": str(internal_path),
                    "gc.build.review_subject_path": str(subject_path),
                }
            },
            workspace,
            env={},
            pack_spec=pack_spec,
        )


def test_require_canonical_review_subject_trace_rejects_relative_path(tmp_path) -> None:
    subject_path = tmp_path / "review-subject.diff"
    subject_path.write_text("diff --git a/a.py b/a.py\n", encoding="utf-8")
    report_path = tmp_path / "review-report.md"
    report = review_artifact_traced_to_subject(
        subject_path.resolve(), status="changes_required"
    ).replace(
        f"    - path: {subject_path.resolve()}\n",
        f"    - path: {subject_path.name}\n",
        1,
    )
    report_path.write_text(report, encoding="utf-8")

    with pytest.raises(
        gascity_pack_inference_gate.GateError,
        match="canonical review subject digest",
    ):
        gascity_pack_inference_gate.require_canonical_review_subject_trace(
            report_path, subject_path.resolve()
        )


def test_validate_review_report_rejects_invalid_internal_methodology_report(tmp_path) -> None:
    workspace = gate_workspace(tmp_path)
    subject_path = gascity_pack_inference_gate.write_review_subject(workspace.rig_dir).resolve()
    report_path = (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_REPORT_PATH).resolve()
    internal_path = (workspace.rig_dir / ".gc" / "internal" / "review-report.md").resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    internal_path.parent.mkdir(parents=True)
    report_path.write_text(
        review_artifact_traced_to_subject(subject_path, status="changes_required"),
        encoding="utf-8",
    )
    internal_path.write_text("# Freeform internal review\n", encoding="utf-8")
    pack_spec = replace(
        gascity_pack_inference_gate.PACK_SPECS["compound-engineering"],
        validator_source=gascity_pack_inference_gate.REPO_ROOT / "gascity",
    )

    with pytest.raises(gascity_pack_inference_gate.GateError, match="internal review report"):
        gascity_pack_inference_gate.validate_review_report(
            {
                "metadata": {
                    "gc.var.report_path": str(report_path),
                    "gc.build.code_review_report_path": str(internal_path),
                    "gc.build.review_subject_path": str(subject_path),
                }
            },
            workspace,
            env={},
            pack_spec=pack_spec,
        )


def test_validate_review_report_rejects_adapter_that_differs_from_internal_report(tmp_path) -> None:
    workspace = gate_workspace(tmp_path)
    subject_path = gascity_pack_inference_gate.write_review_subject(workspace.rig_dir).resolve()
    report_path = (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_REPORT_PATH).resolve()
    internal_path = (workspace.rig_dir / ".gc" / "internal" / "review-report.md").resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    internal_path.parent.mkdir(parents=True)
    report = review_artifact_traced_to_subject(subject_path, status="changes_required")
    internal_path.write_text(report, encoding="utf-8")
    report_path.write_text(report + "\nAdapter-only rewrite.\n", encoding="utf-8")
    pack_spec = replace(
        gascity_pack_inference_gate.PACK_SPECS["gstack"],
        validator_source=gascity_pack_inference_gate.REPO_ROOT / "gascity",
    )

    with pytest.raises(gascity_pack_inference_gate.GateError, match="byte-identical"):
        gascity_pack_inference_gate.validate_review_report(
            {
                "metadata": {
                    "gc.var.report_path": str(report_path),
                    "gc.build.code_review_report_path": str(internal_path),
                    "gc.build.review_subject_path": str(subject_path),
                }
            },
            workspace,
            env={},
            pack_spec=pack_spec,
        )


def test_validate_review_report_rejects_fake_canonical_subject_hash(tmp_path) -> None:
    workspace = gate_workspace(tmp_path)
    subject_path = gascity_pack_inference_gate.write_review_subject(workspace.rig_dir).resolve()
    report_path = (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_REPORT_PATH).resolve()
    internal_path = (workspace.rig_dir / ".gc" / "internal" / "review-report.md").resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    internal_path.parent.mkdir(parents=True)
    report = review_artifact_traced_to_subject(
        subject_path,
        status="changes_required",
        hash_value="literal:not-the-subject-digest",
    )
    report_path.write_text(report, encoding="utf-8")
    internal_path.write_text(report, encoding="utf-8")
    pack_spec = replace(
        gascity_pack_inference_gate.PACK_SPECS["bmad"],
        validator_source=gascity_pack_inference_gate.REPO_ROOT / "gascity",
    )

    with pytest.raises(gascity_pack_inference_gate.GateError, match="canonical review subject digest"):
        gascity_pack_inference_gate.validate_review_report(
            {
                "metadata": {
                    "gc.var.report_path": str(report_path),
                    "gc.build.code_review_report_path": str(internal_path),
                    "gc.build.review_subject_path": str(subject_path),
                }
            },
            workspace,
            env={},
            pack_spec=pack_spec,
        )


def test_validate_review_report_rejects_relative_root_report_path(tmp_path) -> None:
    workspace = gate_workspace(tmp_path)
    work_dir = workspace.rig_dir / "fi-3ph-write-review-report"
    report_path = work_dir / gascity_pack_inference_gate.REVIEW_REPORT_PATH
    report_path.parent.mkdir(parents=True)
    report_path.write_text(valid_review_artifact(status="changes_required"), encoding="utf-8")

    with pytest.raises(gascity_pack_inference_gate.GateError, match="gc.var.report_path.*absolute"):
        gascity_pack_inference_gate.validate_review_report(
            {
                "metadata": {
                    "gc.work_dir": str(work_dir),
                    "gc.var.report_path": str(gascity_pack_inference_gate.REVIEW_REPORT_PATH),
                }
            },
            workspace,
            env={},
            pack_spec=gascity_pack_inference_gate.PACK_SPECS["gascity"],
        )


def test_validate_review_report_rejects_root_path_different_from_adapter_request(tmp_path) -> None:
    workspace = gate_workspace(tmp_path)
    internal_path = (workspace.rig_dir / ".gc" / "internal" / "review-report.md").resolve()
    internal_path.parent.mkdir(parents=True)
    internal_path.write_text(valid_review_artifact(status="changes_required"), encoding="utf-8")

    with pytest.raises(gascity_pack_inference_gate.GateError, match="does not match requested adapter report"):
        gascity_pack_inference_gate.validate_review_report(
            {"metadata": {"gc.var.report_path": str(internal_path)}},
            workspace,
            env={},
            pack_spec=gascity_pack_inference_gate.PACK_SPECS["gascity"],
        )


def test_validate_review_report_rejects_internal_metadata_report(tmp_path) -> None:
    workspace = gate_workspace(tmp_path)
    requested_path = (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_REPORT_PATH).resolve()
    internal_path = workspace.rig_dir / ".gc" / "inference-gate" / "artifacts" / "implementation-review.md"
    internal_path.parent.mkdir(parents=True)
    internal_path.write_text(valid_review_artifact(status="approved"), encoding="utf-8")
    pack_spec = replace(
        gascity_pack_inference_gate.PACK_SPECS["superpowers"],
        validator_source=gascity_pack_inference_gate.REPO_ROOT / "gascity",
    )

    with pytest.raises(gascity_pack_inference_gate.GateError, match="requested review report.*missing"):
        gascity_pack_inference_gate.validate_review_report(
            {
                "metadata": {
                    "gc.var.report_path": str(requested_path),
                    "gc.build.code_review_report_path": str(internal_path),
                }
            },
            workspace,
            env={},
            pack_spec=pack_spec,
        )


def test_validate_review_report_rejects_methodology_fallback(tmp_path) -> None:
    workspace = gate_workspace(tmp_path)
    requested_path = (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_REPORT_PATH).resolve()
    fallback_path = workspace.rig_dir / ".gc" / "inference-gate" / "artifacts" / "review-fix-summary.md"
    fallback_path.parent.mkdir(parents=True)
    fallback_path.write_text(valid_review_artifact(status="approved"), encoding="utf-8")
    pack_spec = replace(
        gascity_pack_inference_gate.PACK_SPECS["superpowers"],
        validator_source=gascity_pack_inference_gate.REPO_ROOT / "gascity",
    )

    with pytest.raises(gascity_pack_inference_gate.GateError, match="requested review report.*missing"):
        gascity_pack_inference_gate.validate_review_report(
            {"metadata": {"gc.var.report_path": str(requested_path)}},
            workspace,
            env={},
            pack_spec=pack_spec,
        )


def test_validate_review_report_rejects_approved_base_gascity_report(tmp_path) -> None:
    workspace = gate_workspace(tmp_path)
    report_path = (workspace.rig_dir / gascity_pack_inference_gate.REVIEW_REPORT_PATH).resolve()
    report_path.parent.mkdir(parents=True)
    report_path.write_text(valid_review_artifact(status="approved"), encoding="utf-8")

    with pytest.raises(gascity_pack_inference_gate.GateError, match="valid expected review artifact"):
        gascity_pack_inference_gate.validate_review_report(
            {"metadata": {"gc.var.report_path": str(report_path)}},
            workspace,
            env={},
            pack_spec=gascity_pack_inference_gate.PACK_SPECS["gascity"],
        )


def test_expand_gate_selection_supports_build_basic_and_all() -> None:
    assert gascity_pack_inference_gate.expand_gate_selection("review") == ["review"]
    assert gascity_pack_inference_gate.expand_gate_selection("build") == ["build-basic"]
    assert gascity_pack_inference_gate.expand_gate_selection("build-basic") == ["build-basic"]
    assert gascity_pack_inference_gate.expand_gate_selection("all") == ["review", "build-basic"]


def test_expand_gate_selection_is_pack_specific() -> None:
    superpowers = gascity_pack_inference_gate.PACK_SPECS["superpowers"]
    gastown = gascity_pack_inference_gate.PACK_SPECS["gastown"]

    assert gascity_pack_inference_gate.expand_gate_selection("all", superpowers) == ["review", "build"]
    assert gascity_pack_inference_gate.expand_gate_selection("build", superpowers) == ["build"]
    with pytest.raises(ValueError, match="build-basic"):
        gascity_pack_inference_gate.expand_gate_selection("build-basic", superpowers)

    assert gascity_pack_inference_gate.expand_gate_selection("all", gastown) == ["gastown-orchestration"]
    with pytest.raises(ValueError, match="review"):
        gascity_pack_inference_gate.expand_gate_selection("review", gastown)


def test_expand_pack_selection_supports_supported_pack_groups() -> None:
    assert gascity_pack_inference_gate.expand_pack_selection("methodology") == list(
        gascity_pack_inference_gate.METHODOLOGY_PACKS
    )
    assert gascity_pack_inference_gate.expand_pack_selection("all-supported") == list(
        gascity_pack_inference_gate.PACK_SPECS.keys()
    )


def test_pack_specs_cover_supported_formula_entrypoints() -> None:
    for pack_name in gascity_pack_inference_gate.METHODOLOGY_PACKS:
        spec = gascity_pack_inference_gate.PACK_SPECS[pack_name]
        assert (spec.source / "pack.toml").is_file()
        assert spec.review_formula
        assert spec.build_formula
        assert (spec.source / "formulas" / f"{spec.review_formula}.formula.toml").is_file()
        assert (spec.source / "formulas" / f"{spec.build_formula}.formula.toml").is_file()

    gastown = gascity_pack_inference_gate.PACK_SPECS["gastown"]
    assert gastown.gastown is True
    for formula in gastown.setup_formulas:
        assert (gastown.source / "formulas" / f"{formula}.toml").is_file()


def test_supported_step_formulas_do_not_combine_expand_and_check() -> None:
    formula_roots = [
        gascity_pack_inference_gate.REPO_ROOT / pack_name / "formulas"
        for pack_name in (
            "gascity",
            *gascity_pack_inference_gate.METHODOLOGY_PACKS,
        )
    ]
    offenders: list[str] = []
    for formula_root in formula_roots:
        for path in sorted(formula_root.glob("*.toml")):
            text = path.read_text(encoding="utf-8")
            for block in re.split(r"(?m)^\[\[steps\]\]\s*$", text)[1:]:
                step_id_match = re.search(r'(?m)^id\s*=\s*"([^"]+)"', block)
                step_id = step_id_match.group(1) if step_id_match else "<unknown>"
                if re.search(r"(?m)^expand\s*=", block) and re.search(r"(?m)^\[steps\.check\]\s*$", block):
                    offenders.append(f"{path.relative_to(gascity_pack_inference_gate.REPO_ROOT)}:{step_id}")

    assert offenders == []


def test_validate_required_routes_accepts_metadata_and_prefixed_assignees() -> None:
    beads = [
        {"metadata": {"gc.run_target": "superpowers.brainstorming"}},
        {"assignee": "fixture/superpowers.implementer"},
        {"metadata": {"custom.run_target": ["gstack.qa-lead"]}},
        {"metadata": {"gc.execution_routed_to": "fixture/gc.implementation-reviewer"}},
    ]

    gascity_pack_inference_gate.validate_required_routes(
        beads,
        [
            "superpowers.brainstorming",
            "superpowers.implementer",
            "gstack.qa-lead",
            "gc.implementation-reviewer",
        ],
        context="route test",
    )


def test_validate_required_routes_rejects_missing_expected_agent() -> None:
    with pytest.raises(gascity_pack_inference_gate.GateError, match="missing.agent"):
        gascity_pack_inference_gate.validate_required_routes(
            [{"metadata": {"gc.run_target": "superpowers.brainstorming"}}],
            ["missing.agent"],
            context="route test",
        )


def test_gastown_session_matching_accepts_bound_and_unbound_identities() -> None:
    sessions = [
        {"name": "mayor"},
        {"agent_id": "gastown.deacon"},
        {"session": "boot"},
        {"agent": "fixture/gastown.witness"},
    ]

    assert gascity_pack_inference_gate.missing_session_agents(
        sessions,
        gascity_pack_inference_gate.GASTOWN_ALWAYS_ON_AGENTS,
    ) == []
    assert gascity_pack_inference_gate.missing_session_agents(sessions, ["refinery"]) == ["refinery"]


def test_gastown_review_assignment_is_review_only() -> None:
    description = gascity_pack_inference_gate.gastown_review_assignment_description()

    assert "Do not execute the" in description
    assert "the subject of the review" in description


def test_require_gastown_review_report_checks_structured_notes() -> None:
    gascity_pack_inference_gate.require_gastown_review_report(
        {
            "notes": """\
## Summary
The review leg completed.

## Findings
Refinery is on demand and should not be required as an active startup session.

## Recommendation
Check its configured formula and named-session surface instead.
"""
        }
    )


def test_validate_gastown_orchestration_contract_accepts_current_pack() -> None:
    gascity_pack_inference_gate.validate_gastown_orchestration_contract(
        gascity_pack_inference_gate.PACK_SPECS["gastown"].source
    )


def test_validate_gastown_orchestration_contract_rejects_missing_build_handoff(tmp_path) -> None:
    formulas = tmp_path / "gastown" / "formulas"
    formulas.mkdir(parents=True)
    for formula_name, fragments in gascity_pack_inference_gate.all_gastown_formula_contracts().items():
        text = "\n".join(fragments)
        if formula_name == "mol-polecat-work":
            text = text.replace("--assignee=\"$REFINERY_TARGET\"", "")
        (formulas / f"{formula_name}.toml").write_text(text, encoding="utf-8")

    with pytest.raises(gascity_pack_inference_gate.GateError, match="mol-polecat-work"):
        gascity_pack_inference_gate.validate_gastown_orchestration_contract(tmp_path / "gastown")


def test_validate_gastown_orchestration_contract_rejects_missing_refinery_false_completion_guard(tmp_path) -> None:
    formulas = tmp_path / "gastown" / "formulas"
    formulas.mkdir(parents=True)
    for formula_name, fragments in gascity_pack_inference_gate.all_gastown_formula_contracts().items():
        text = "\n".join(fragments)
        if formula_name == "mol-refinery-patrol":
            text = text.replace("branch_has_real_change", "")
        (formulas / f"{formula_name}.toml").write_text(text, encoding="utf-8")

    with pytest.raises(gascity_pack_inference_gate.GateError, match="mol-refinery-patrol"):
        gascity_pack_inference_gate.validate_gastown_orchestration_contract(tmp_path / "gastown")


def test_validate_methodology_flow_contracts_accept_current_packs() -> None:
    for pack_name in gascity_pack_inference_gate.METHODOLOGY_PACKS:
        gascity_pack_inference_gate.validate_methodology_flow_contract(
            gascity_pack_inference_gate.PACK_SPECS[pack_name]
        )


def test_validate_methodology_flow_contract_rejects_missing_specialist_review_lane(tmp_path) -> None:
    spec = gascity_pack_inference_gate.PACK_SPECS["superpowers"]
    pack_source = tmp_path / "superpowers"
    shutil.copytree(spec.source / "formulas", pack_source / "formulas")
    review_expansion = pack_source / "formulas" / "superpowers-code-review.formula.toml"
    review_expansion.write_text(
        review_expansion.read_text(encoding="utf-8").replace(
            "superpowers.code-quality-reviewer",
            "superpowers.code-reviewer",
        ),
        encoding="utf-8",
    )

    with pytest.raises(gascity_pack_inference_gate.GateError, match="superpowers.code-quality-reviewer"):
        gascity_pack_inference_gate.validate_methodology_flow_contract(
            replace(spec, source=pack_source)
        )


def test_validate_methodology_flow_contract_rejects_missing_gstack_release_readiness(tmp_path) -> None:
    spec = gascity_pack_inference_gate.PACK_SPECS["gstack"]
    pack_source = tmp_path / "gstack"
    shutil.copytree(spec.source / "formulas", pack_source / "formulas")
    build_formula = pack_source / "formulas" / "gstack-build.formula.toml"
    build_formula.write_text(
        build_formula.read_text(encoding="utf-8").replace('id = "release-readiness"', 'id = "release-check"'),
        encoding="utf-8",
    )

    with pytest.raises(gascity_pack_inference_gate.GateError, match="release-readiness"):
        gascity_pack_inference_gate.validate_methodology_flow_contract(
            replace(spec, source=pack_source)
        )


def test_gastown_build_workflow_contract_covers_orchestration_roles() -> None:
    contracts = gascity_pack_inference_gate.GASTOWN_BUILD_WORKFLOW_CONTRACTS

    assert set(contracts) == {
        "mol-polecat-work",
        "mol-refinery-patrol",
        "mol-witness-patrol",
        "mol-deacon-patrol",
        "mol-idea-to-plan",
    }
    assert "gc session wake \"$REFINERY_TARGET\"" in contracts["mol-polecat-work"]
    assert 'git worktree add --detach "$MERGE_WT" "origin/$TARGET"' in contracts["mol-refinery-patrol"]
    assert 'gc bd close "$WORK" --reason "Merged to $TARGET at $MERGED_SHORT"' in contracts["mol-refinery-patrol"]
    assert "gc bd close $WORK --reason \"Pull request ready: $PR_URL\"" in contracts["mol-refinery-patrol"]
    assert "FAIL-SAFE: empty liveness map" in contracts["mol-witness-patrol"]
    assert "gc bd create --type=task --label=warrant" in contracts["mol-deacon-patrol"]
    assert "gc bd dep add" in contracts["mol-idea-to-plan"]


def test_build_basic_work_item_targets_code_and_pytest() -> None:
    text = gascity_pack_inference_gate.build_basic_work_item()

    assert text.splitlines()[0] == gascity_pack_inference_gate.BUILD_SOURCE_TITLE
    assert "slugger.py" in text
    assert "pytest -q" in text
    assert "Do not change tests" in text


def test_validate_build_basic_result_accepts_worktree_with_passing_tests(tmp_path) -> None:
    rig_dir = tmp_path / "fixture"
    worktree = rig_dir / "worktrees" / "fi-source"
    gascity_pack_inference_gate.write_build_basic_fixture(rig_dir)
    gascity_pack_inference_gate.write_build_basic_fixture(worktree)
    (worktree / "slugger.py").write_text(
        """\
import re


def slugify(value: str) -> str:
    parts = re.findall(r"[a-z0-9]+", value.lower())
    return "-".join(parts)
""",
        encoding="utf-8",
    )

    selected = gascity_pack_inference_gate.validate_build_basic_result(
        rig_dir,
        [{"metadata": {"work_dir": str(worktree), "gc.work_dir": str(rig_dir)}}],
        env={},
        timeout=30,
    )

    assert selected == worktree


def test_validate_build_basic_result_rejects_launcher_only_false_pass(tmp_path) -> None:
    rig_dir = tmp_path / "fixture"
    worktree = rig_dir / "worktrees" / "fi-source"
    gascity_pack_inference_gate.write_build_basic_fixture(rig_dir)
    gascity_pack_inference_gate.write_build_basic_fixture(worktree)
    (rig_dir / "slugger.py").write_text(
        """\
import re


def slugify(value: str) -> str:
    parts = re.findall(r"[a-z0-9]+", value.lower())
    return "-".join(parts)
""",
        encoding="utf-8",
    )

    with pytest.raises(gascity_pack_inference_gate.GateError, match="NotImplementedError"):
        gascity_pack_inference_gate.validate_build_basic_result(
            rig_dir,
            [{"metadata": {"work_dir": str(worktree), "gc.work_dir": str(rig_dir)}}],
            env={},
            timeout=30,
        )


def test_validate_build_basic_artifacts_accepts_declared_markdown_artifacts(tmp_path) -> None:
    rig_dir = tmp_path / "fixture"
    rig_dir.mkdir()
    metadata: dict[str, str] = {}

    for metadata_key, schema in gascity_pack_inference_gate.BUILD_BASIC_ARTIFACT_CONTRACTS:
        artifact_path = rig_dir / f"{metadata_key.rsplit('.', 1)[-1]}.md"
        artifact_path.write_text(valid_build_artifact(schema), encoding="utf-8")
        metadata[metadata_key] = str(artifact_path)

    gascity_pack_inference_gate.validate_build_basic_artifacts(
        {"metadata": metadata},
        rig_dir=rig_dir,
        env={},
        validator_source=gascity_pack_inference_gate.REPO_ROOT / "gascity",
    )


def test_validate_build_basic_artifacts_rejects_json_artifacts(tmp_path) -> None:
    rig_dir = tmp_path / "fixture"
    rig_dir.mkdir()
    bad_path = rig_dir / "requirements.json"
    bad_path.write_text('{"schema":"gc.build.requirements.v1"}\n', encoding="utf-8")

    with pytest.raises(gascity_pack_inference_gate.GateError, match="failed validation"):
        gascity_pack_inference_gate.validate_build_basic_artifacts(
            {"metadata": {"gc.build.requirements_path": str(bad_path)}},
            rig_dir=rig_dir,
            env={},
            validator_source=gascity_pack_inference_gate.REPO_ROOT / "gascity",
        )


def valid_review_artifact(status: str) -> str:
    artifact = valid_build_artifact("gc.build.review.v1").replace("status: approved", f"status: {status}", 1)
    return (
        artifact
        + """
## Security Finding

The reviewed diff uses `subprocess.run(..., shell=True)` with user-controlled
paths, which creates a shell injection risk.

## Remediation

The terminal report verifies the fix: use an argument vector / argument list
with `shell=False`, and mark SEC-001 covered after tests pass.
"""
    )


def review_artifact_traced_to_subject(
    subject_path: Path,
    *,
    status: str,
    hash_value: str = "",
) -> str:
    digest = hash_value or f"sha256:{hashlib.sha256(subject_path.read_bytes()).hexdigest()}"
    return valid_review_artifact(status=status).replace(
        "    - path: fixture\n      hash: literal:test",
        f"    - path: {subject_path}\n      hash: {digest}",
        1,
    )


def valid_build_artifact(schema: str) -> str:
    sections_by_schema = {
        "gc.build.requirements.v1": [
            "Problem Statement",
            "W6H",
            "User Stories",
            "Technical Stories",
            "Behavior Requirements",
            "Example Mapping",
            "Acceptance Criteria",
            "Out Of Scope",
            "Open Questions",
        ],
        "gc.build.plan.v1": [
            "Summary",
            "Current System",
            "Proposed Implementation",
            "Non-Goals",
            "Verification",
        ],
        "gc.build.decomposition.v1": [
            "Summary",
            "Selected Downstream Formulas",
            "Implementation Convoy",
            "Work Items",
        ],
        "gc.build.implementation-summary.v1": [
            "Summary",
            "Intended Behavior",
            "Changed Files",
            "Verification",
            "Remaining Risks",
        ],
        "gc.build.review.v1": [
            "Verdict",
            "Findings",
            "Verification",
        ],
        "gc.build.final-report.v1": [
            "Summary",
            "Outcome",
            "Artifacts",
            "Remaining Risks",
        ],
    }
    sections = sections_by_schema[schema]
    body = "\n".join(f"## {section}\n\nCovered.\n" for section in sections)
    return f"""\
---
schema: {schema}
workflow:
  id: fi-root
  formula: build-basic
methodology:
  pack: gascity
  name: build-basic
producer:
  formula: build-basic
  stage: test
  attempt: 1
status: approved
trace:
  upstream:
    - path: fixture
      hash: literal:test
      ids:
        - AC1
  coverage:
    - id: AC1
      status: covered
---
| ID | Status |
| --- | --- |
| AC1 | covered |

{body}
"""
