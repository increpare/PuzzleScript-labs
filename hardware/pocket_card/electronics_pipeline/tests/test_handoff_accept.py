import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import hardware.pocket_card.electronics_pipeline.handoff as handoff_module
from hardware.pocket_card.electronics_pipeline.handoff import (
    HandoffInvalid,
    accept_stage,
)
from hardware.pocket_card.electronics_pipeline.validation import (
    INVALID,
    MECHANICAL_REVIEW_REQUIRED,
    PASS,
)

PROJECT_NAME = "pocket_card_controller"
_GIT_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "handoff-test",
    "GIT_AUTHOR_EMAIL": "handoff-test@example.com",
    "GIT_COMMITTER_NAME": "handoff-test",
    "GIT_COMMITTER_EMAIL": "handoff-test@example.com",
}


def read_policy(repo: Path) -> dict[str, str]:
    project = repo / "hardware" / "pocket_card" / "electronics"
    return {
        name: (project / name).read_text(encoding="utf-8")
        for name in (
            "toolchain.json",
            "mechanical_contract.json",
            "validation_waivers.json",
        )
    }


def git_head(repo: Path) -> str:
    result = subprocess.run(
        ("git", "rev-parse", "HEAD"),
        cwd=repo,
        text=True,
        capture_output=True,
        check=True,
    )
    return result.stdout.strip()


def _init_git_repo(repo: Path) -> None:
    subprocess.run(("git", "init"), cwd=repo, check=True, capture_output=True)
    subprocess.run(("git", "add", "-A"), cwd=repo, check=True, capture_output=True)
    subprocess.run(
        ("git", "commit", "-m", "init"),
        cwd=repo,
        check=True,
        capture_output=True,
        env=_GIT_ENV,
    )


def checked_stage(
    *,
    canonical_project: Path,
    stage_root: Path,
    status: str = PASS,
    add_pullup: bool = False,
    altered_policy: bool = False,
) -> Path:
    base_digest = handoff_module._handoff_project_digest(canonical_project)
    scratch = stage_root / "staged" / ".building"
    if scratch.exists():
        shutil.rmtree(scratch)
    project = scratch / "project"
    project.mkdir(parents=True)

    for name in (
        f"{PROJECT_NAME}.kicad_pro",
        f"{PROJECT_NAME}.kicad_sch",
        f"{PROJECT_NAME}.kicad_pcb",
        "fp-lib-table",
        "sym-lib-table",
        "toolchain.json",
        "mechanical_contract.json",
        "validation_waivers.json",
    ):
        shutil.copy2(canonical_project / name, project / name)

    if add_pullup:
        sch = project / f"{PROJECT_NAME}.kicad_sch"
        sch.write_text(sch.read_text(encoding="utf-8") + "(pullup R99)\n", encoding="utf-8")
        pcb = project / f"{PROJECT_NAME}.kicad_pcb"
        pcb.write_text(
            pcb.read_text(encoding="utf-8") + " pullup\n",
            encoding="utf-8",
        )

    returned_digest = handoff_module._handoff_project_digest(project.resolve(strict=True))
    stage_dir = stage_root / "staged" / returned_digest
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    scratch.rename(stage_dir)
    project = (stage_dir / "project").resolve(strict=True)

    source_hashes = handoff_module._source_file_hashes(project)

    if altered_policy:
        (project / "validation_waivers.json").write_text(
            '{"schemaVersion":1,"groups":[{"scope":"ERC","type":"evil"}]}\n',
            encoding="utf-8",
        )
        (project / "toolchain.json").write_text(
            '{"schemaVersion":1,"project":"evil"}\n',
            encoding="utf-8",
        )

    returned_digest = handoff_module._handoff_project_digest(project)

    payload = {
        "schemaVersion": 1,
        "status": status,
        "baseProjectDigest": base_digest,
        "currentProjectDigest": base_digest,
        "returnedBaseProjectDigest": base_digest,
        "returnedProjectDigest": returned_digest,
        "validationMessages": [],
        "sourceFileHashes": source_hashes,
        "semanticDiff": {},
        "validationReports": {},
    }
    (stage_dir / "report.json").write_text(
        json.dumps(payload, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (stage_dir / "report.md").write_text(f"# status {status}\n", encoding="utf-8")
    return stage_dir


class HandoffAcceptTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repo = self.root / "repo"
        self.project = self.repo / "hardware" / "pocket_card" / "electronics"
        self.project.mkdir(parents=True)
        dirty_artifact = (
            self.repo / "hardware" / "pocket_card" / "case" / "out" / "pcb" / "dirty.stl"
        )
        dirty_artifact.parent.mkdir(parents=True)
        dirty_artifact.write_text("dirty artifact\n", encoding="utf-8")
        for name, content in {
            f"{PROJECT_NAME}.kicad_pro": "{}\n",
            f"{PROJECT_NAME}.kicad_sch": "(kicad_sch)\n",
            f"{PROJECT_NAME}.kicad_pcb": "(kicad_pcb)\n",
            "fp-lib-table": "(fp_lib_table (version 7))\n",
            "sym-lib-table": "(sym_lib_table (version 7))\n",
            "toolchain.json": (
                '{"schemaVersion":1,"project":"pocket_card_controller",'
                '"kicad":{"major":10,"minimum":"10.0.4"}}\n'
            ),
            "mechanical_contract.json": '{"schemaVersion":1,"features":[]}\n',
            "validation_waivers.json": '{"schemaVersion":1,"groups":[]}\n',
        }.items():
            (self.project / name).write_text(content, encoding="utf-8")
        self.project = self.project.resolve(strict=True)
        _init_git_repo(self.repo)
        self.original_head = git_head(self.repo)
        self.original_policy = read_policy(self.repo)
        self.stage_root = self.repo / "build" / "pocket_card" / "handoff"

    def _accept(self, stage: Path, *, branch_name: str = "codex/review"):
        with mock.patch.object(handoff_module, "ELECTRONICS_DIR", self.project), mock.patch.object(
            handoff_module, "HANDOFF_BUILD_DIR", self.stage_root
        ):
            return accept_stage(stage, self.repo, branch_name=branch_name)

    def _stage(self, **kwargs):
        return checked_stage(
            canonical_project=self.project,
            stage_root=self.stage_root,
            **kwargs,
        )

    def test_refuses_master_failed_check_and_tampered_stage(self):
        for branch, status, tamper in (
            ("master", PASS, False),
            ("codex/review", INVALID, False),
            ("codex/review", PASS, True),
        ):
            stage = self._stage(status=status)
            if tamper:
                (stage / "project" / f"{PROJECT_NAME}.kicad_sch").write_text(
                    "tampered", encoding="utf-8"
                )
            with self.subTest(branch=branch, status=status, tamper=tamper), self.assertRaises(
                HandoffInvalid
            ):
                self._accept(stage, branch_name=branch)

    def test_accepts_only_editable_inputs_and_never_policy_or_git(self):
        stage = self._stage(status=PASS, add_pullup=True, altered_policy=True)
        accepted = self._accept(stage, branch_name="codex/review")
        self.assertIn(f"{PROJECT_NAME}.kicad_sch", accepted)
        self.assertEqual(read_policy(self.repo), self.original_policy)
        self.assertEqual(git_head(self.repo), self.original_head)

    def test_ignores_unrelated_dirty_paths(self):
        dirty_artifact = (
            self.repo / "hardware" / "pocket_card" / "case" / "out" / "pcb" / "dirty.stl"
        )
        dirty_artifact.write_text("changed outside editable scope\n", encoding="utf-8")
        stage = self._stage(status=PASS, add_pullup=True)
        accepted = self._accept(stage, branch_name="codex/review")
        self.assertIn(f"{PROJECT_NAME}.kicad_sch", accepted)

    def test_refuses_dirty_editable_paths(self):
        stage = self._stage(status=PASS, add_pullup=True)
        board = self.project / f"{PROJECT_NAME}.kicad_pcb"
        board.write_text(board.read_text(encoding="utf-8") + "local edit\n", encoding="utf-8")
        with self.assertRaises(HandoffInvalid):
            self._accept(stage, branch_name="codex/review")

    def test_accepts_mechanical_review_required_on_review_branch(self):
        stage = self._stage(status=MECHANICAL_REVIEW_REQUIRED, add_pullup=True)
        accepted = self._accept(stage, branch_name="codex/review")
        self.assertIn(f"{PROJECT_NAME}.kicad_sch", accepted)


if __name__ == "__main__":
    unittest.main()
