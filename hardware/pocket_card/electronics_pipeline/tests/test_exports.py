import hashlib
import json
import os
import shutil
import stat
import subprocess
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import hardware.pocket_card.electronics_pipeline.exports as exports_module
from hardware.pocket_card.electronics_pipeline.exports import (
    ExportResult,
    _publish_export_directory,
    export_outputs,
    exports_are_current,
    require_current_exports,
)
from hardware.pocket_card.electronics_pipeline.inventory import project_digest
from hardware.pocket_card.electronics_pipeline.paths import BOARD
from hardware.pocket_card.electronics_pipeline.validation import (
    INVALID,
    PASS,
    ValidationResult,
)


PROJECT_NAME = "pocket_card_controller"
EXPORT_STAGES = ("pdf", "bom", "gerbers", "drill", "pos", "step", "stl")
CURATED_REFS = (
    "J_BAT_IN1",
    "J_BAT_OUT1",
    "J_EXP1",
    "J_I2C1",
    "SW_ACTION1",
    "SW_DOWN1",
    "SW_LEFT1",
    "SW_MENU1",
    "SW_MUTE1",
    "SW_PWR1",
    "SW_RESET1",
    "SW_RIGHT1",
    "SW_UNDO1",
    "SW_UP1",
    "U1",
)
REQUIRED_CURRENT_ERROR = (
    "PCB export is missing or stale; run make pocket_card_pcb_exports"
)


def _snapshot(directory):
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def _tree_snapshot(directory):
    entries = {}
    for path in sorted(directory.rglob("*")):
        relative = path.relative_to(directory).as_posix()
        if path.is_symlink():
            entries[relative] = ("symlink", os.readlink(path))
        elif path.is_dir():
            entries[relative] = ("directory", None)
        elif path.is_file():
            entries[relative] = ("file", path.read_bytes())
        else:
            entries[relative] = ("other", None)
    return entries


class FakeValidator:
    def __init__(self, status=PASS):
        self.status = status
        self.calls = []

    def __call__(self, project_dir, output_dir=None, runner=None):
        self.calls.append((Path(project_dir), Path(output_dir), runner))
        if output_dir is not None:
            output = Path(output_dir)
            output.mkdir(parents=True)
            (output / "erc.json").write_text(
                '{"violations":[]}\n', encoding="utf-8"
            )
            (output / "drc.json").write_text(
                '{"violations":[]}\n', encoding="utf-8"
            )
            (output / "validation.json").write_text(
                json.dumps({"status": self.status}, sort_keys=True) + "\n",
                encoding="utf-8",
            )
        return ValidationResult(self.status, ("fake validation",), {}, None)


class FakeRunner:
    def __init__(
        self,
        canonical,
        fail_on=None,
        mutate_on=None,
        omit_on=None,
        empty_on=None,
    ):
        self.canonical = Path(canonical).resolve()
        self.fail_on = fail_on
        self.mutate_on = mutate_on
        self.omit_on = omit_on
        self.empty_on = empty_on
        self.calls = []

    def __call__(self, command, **kwargs):
        command = tuple(str(item) for item in command)
        self.calls.append((command, kwargs))
        if command[1:] == ("--version",):
            return subprocess.CompletedProcess(command, 0, "10.0.4\n", "")

        stage = next(name for name in EXPORT_STAGES if name in command)
        self._assert_command_contract(command, kwargs)
        if self.mutate_on == stage:
            board = self.canonical / f"{PROJECT_NAME}.kicad_pcb"
            board.write_text(board.read_text(encoding="utf-8") + "\n", encoding="utf-8")
        if self.fail_on == stage:
            return subprocess.CompletedProcess(command, 9, "", f"{stage} failed")
        if self.omit_on == stage:
            return subprocess.CompletedProcess(command, 0, "", "")

        output_flag = "--output" if "--output" in command else "-o"
        output = Path(command[command.index(output_flag) + 1])
        if stage == "gerbers":
            output.mkdir(parents=True, exist_ok=True)
            (output / "z-bottom.gbr").write_bytes(b"bottom gerber\n")
            (output / "a-top.gbr").write_bytes(b"top gerber\n")
        elif stage == "drill":
            output.mkdir(parents=True, exist_ok=True)
            (output / f"{PROJECT_NAME}.drl").write_bytes(b"drill\n")
        else:
            output.parent.mkdir(parents=True, exist_ok=True)
            position_rows = "".join(
                f'"{ref}","value","package","10","20","90","top"\n'
                for ref in CURATED_REFS
            ).encode("utf-8")
            payloads = {
                "pdf": b"%PDF-fake\n",
                "bom": b'"Refs","Value","Footprint","Qty","DNP"\n',
                "pos": (
                    b'"Ref","Val","Package","PosX","PosY","Rot","Side"\n'
                    + position_rows
                ),
                "step": b"ISO-10303-21; fake STEP\n",
                "stl": b"solid fake\nendsolid fake\n",
            }
            output.write_bytes(b"" if self.empty_on == stage else payloads[stage])
        return subprocess.CompletedProcess(command, 0, "", "")

    def _assert_command_contract(self, command, kwargs):
        for item in command:
            self.assertNotIn(str(self.canonical), item)
        self.assertNotIn("--save-board", command)
        self.assertEqual(kwargs["env"]["LANG"], "C")
        self.assertEqual(kwargs["env"]["LC_ALL"], "C")
        self.assertGreater(kwargs["timeout"], 0)
        self.assertTrue(kwargs["capture_output"])
        self.assertFalse(kwargs["check"])
        for item in command:
            if item.endswith((".kicad_sch", ".kicad_pcb")):
                source = Path(item)
                for suffix in (".kicad_pro", ".kicad_sch", ".kicad_pcb"):
                    self.assertTrue((source.parent / f"{PROJECT_NAME}{suffix}").is_file())

    # unittest assertions retain useful diagnostics inside the runner.
    def assertNotIn(self, *args, **kwargs):
        return unittest.TestCase().assertNotIn(*args, **kwargs)

    def assertEqual(self, *args, **kwargs):
        return unittest.TestCase().assertEqual(*args, **kwargs)

    def assertGreater(self, *args, **kwargs):
        return unittest.TestCase().assertGreater(*args, **kwargs)

    def assertFalse(self, *args, **kwargs):
        return unittest.TestCase().assertFalse(*args, **kwargs)

    def assertTrue(self, *args, **kwargs):
        return unittest.TestCase().assertTrue(*args, **kwargs)


class ExportOutputsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.project = self.root / "electronics"
        self.project.mkdir()
        (self.project / "toolchain.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "project": PROJECT_NAME,
                    "kicad": {"major": 10, "minimum": "10.0.4"},
                }
            ),
            encoding="utf-8",
        )
        (self.project / "mechanical_contract.json").write_text("{}\n", encoding="utf-8")
        (self.project / "validation_waivers.json").write_text(
            '{"schemaVersion":1,"groups":[]}\n', encoding="utf-8"
        )
        (self.project / "fp-lib-table").write_text(
            "(fp_lib_table (version 7))\n", encoding="utf-8"
        )
        (self.project / f"{PROJECT_NAME}.kicad_pro").write_text(
            "{}\n", encoding="utf-8"
        )
        (self.project / f"{PROJECT_NAME}.kicad_sch").write_text(
            "(kicad_sch)\n", encoding="utf-8"
        )
        (self.project / f"{PROJECT_NAME}.kicad_pcb").write_text(
            "(kicad_pcb (general (thickness 1.6)))\n", encoding="utf-8"
        )
        self.output = self.root / "pcb"

    def run_export(self, *, runner=None, validator=None, output=None):
        return export_outputs(
            self.project,
            output or self.output,
            runner=runner or FakeRunner(self.project),
            validator=validator or FakeValidator(),
        )

    def test_nonpassing_validation_runs_no_exports_and_publishes_nothing(self):
        runner = FakeRunner(self.project)
        validator = FakeValidator(INVALID)
        before = project_digest(self.project)
        with self.assertRaisesRegex(RuntimeError, "validation.*INVALID") as raised:
            self.run_export(runner=runner, validator=validator)
        self.assertIn("fake validation", str(raised.exception))
        self.assertEqual(runner.calls, [])
        self.assertFalse(self.output.exists())
        self.assertEqual(project_digest(self.project), before)

    def test_validation_failure_diagnostics_are_bounded(self):
        class LargeDiagnosticValidator(FakeValidator):
            def __call__(self, project_dir, output_dir=None, runner=None):
                super().__call__(project_dir, output_dir=output_dir, runner=runner)
                return ValidationResult(INVALID, ("x" * (1024 * 1024),), {}, None)

        with self.assertRaises(RuntimeError) as raised:
            self.run_export(validator=LargeDiagnosticValidator(INVALID))
        message = str(raised.exception)
        self.assertLess(len(message), 20_000)
        self.assertIn("[truncated ", message)

    def test_every_export_stage_failure_publishes_nothing_and_preserves_sources(self):
        for stage in EXPORT_STAGES:
            with self.subTest(stage=stage):
                output = self.root / f"failed-{stage}"
                before = project_digest(self.project)
                with self.assertRaisesRegex(RuntimeError, stage):
                    self.run_export(
                        runner=FakeRunner(self.project, fail_on=stage), output=output
                    )
                self.assertFalse(output.exists())
                self.assertEqual(project_digest(self.project), before)

    def test_every_export_stage_failure_preserves_complete_old_output_exactly(self):
        self.run_export()
        original = _snapshot(self.output)
        for stage in EXPORT_STAGES:
            with self.subTest(stage=stage):
                before = project_digest(self.project)
                with self.assertRaisesRegex(RuntimeError, stage):
                    self.run_export(runner=FakeRunner(self.project, fail_on=stage))
                self.assertEqual(_snapshot(self.output), original)
                self.assertEqual(project_digest(self.project), before)

    def test_successful_commands_cannot_publish_missing_drill_or_empty_outputs(self):
        cases = {
            "missing gerbers": FakeRunner(self.project, omit_on="gerbers"),
            "missing drill": FakeRunner(self.project, omit_on="drill"),
            "empty pdf": FakeRunner(self.project, empty_on="pdf"),
        }
        for label, runner in cases.items():
            with self.subTest(label=label):
                output = self.root / label.replace(" ", "-")
                with self.assertRaisesRegex(
                    RuntimeError, "Gerber|gerber|drill|empty|nonempty|PDF|pdf"
                ):
                    self.run_export(runner=runner, output=output)
                self.assertFalse(output.exists())

    def test_success_has_immutable_result_complete_manifest_and_current_state(self):
        before = project_digest(self.project)
        result = self.run_export()
        self.assertIsInstance(result, ExportResult)
        self.assertEqual(result.project_digest, before)
        self.assertEqual(project_digest(self.project), before)
        with self.assertRaises((AttributeError, TypeError)):
            result.project_digest = "changed"

        manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["schemaVersion"], 1)
        self.assertEqual(manifest["projectName"], PROJECT_NAME)
        self.assertEqual(manifest["projectDigest"], before)
        self.assertEqual(manifest["kicadVersion"], "10.0.4")
        self.assertRegex(manifest["policyDigest"], r"^[0-9a-f]{64}$")
        self.assertRegex(manifest["exportRecipeDigest"], r"^[0-9a-f]{64}$")
        self.assertNotIn(str(self.root), result.manifest_path.read_text(encoding="utf-8"))
        regular = {
            path.relative_to(self.output).as_posix()
            for path in self.output.rglob("*")
            if path.is_file()
        }
        self.assertEqual(set(manifest["artifacts"]), regular - {"source_manifest.json"})
        for relative, metadata in manifest["artifacts"].items():
            content = (self.output / relative).read_bytes()
            self.assertEqual(
                metadata,
                {"sha256": hashlib.sha256(content).hexdigest(), "size": len(content)},
            )
        self.assertEqual(
            (self.output / "exported.step").read_bytes(), result.step_path.read_bytes()
        )
        self.assertEqual(
            (self.output / "exported.stl").read_bytes(), result.stl_path.read_bytes()
        )
        self.assertTrue(exports_are_current(self.project, self.output))
        self.assertIsNone(require_current_exports(self.project, self.output))

    def test_policy_and_export_recipe_changes_make_outputs_stale(self):
        recipe_a = self.root / "recipe-export.py"
        recipe_b = self.root / "recipe-params.py"
        recipe_a.write_text("recipe a\n", encoding="utf-8")
        recipe_b.write_text("recipe b\n", encoding="utf-8")
        inputs = (
            ("hardware/pocket_card/case/export_smt.py", recipe_a),
            ("hardware/pocket_card/case/params.py", recipe_b),
        )
        with mock.patch.object(exports_module, "_EXPORT_RECIPE_INPUTS", inputs):
            self.run_export()
            self.assertTrue(exports_are_current(self.project, self.output))
            recipe_b.write_text("changed params\n", encoding="utf-8")
            self.assertFalse(exports_are_current(self.project, self.output))

        for policy_name in (
            "toolchain.json",
            "mechanical_contract.json",
            "validation_waivers.json",
        ):
            with self.subTest(policy=policy_name), mock.patch.object(
                exports_module, "_EXPORT_RECIPE_INPUTS", inputs
            ):
                recipe_b.write_text("recipe b\n", encoding="utf-8")
                self.run_export()
                policy = self.project / policy_name
                policy.write_text(
                    policy.read_text(encoding="utf-8") + " ", encoding="utf-8"
                )
                self.assertFalse(exports_are_current(self.project, self.output))

    def test_current_check_rejects_source_and_manifest_and_artifact_tampering(self):
        self.run_export()
        baseline = _snapshot(self.output)
        cases = {
            "missing manifest": lambda: (self.output / "source_manifest.json").unlink(),
            "corrupt manifest": lambda: (self.output / "source_manifest.json").write_text("{", encoding="utf-8"),
            "hash mismatch": lambda: (self.output / "BOM.csv").write_bytes(b"changed"),
            "missing artifact": lambda: (self.output / "BOM.csv").unlink(),
            "extra artifact": lambda: (self.output / "extra.txt").write_bytes(b"extra"),
            "symlink artifact": lambda: (self.output / "link").symlink_to("BOM.csv"),
        }
        for label, mutate in cases.items():
            with self.subTest(label=label):
                shutil.rmtree(self.output)
                self.output.mkdir()
                for relative, content in baseline.items():
                    path = self.output / relative
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(content)
                mutate()
                self.assertFalse(exports_are_current(self.project, self.output))
                with self.assertRaisesRegex(RuntimeError, f"^{REQUIRED_CURRENT_ERROR}$"):
                    require_current_exports(self.project, self.output)

        shutil.rmtree(self.output)
        self.run_export()
        board = self.project / f"{PROJECT_NAME}.kicad_pcb"
        board.write_text(board.read_text(encoding="utf-8") + "\n", encoding="utf-8")
        self.assertFalse(exports_are_current(self.project, self.output))

    def test_current_check_rejects_incomplete_fabrication_set_or_archive(self):
        self.run_export()
        manifest_path = self.output / "source_manifest.json"

        for gerber in (self.output / "gerber").glob("*.gbr"):
            gerber.unlink()
        (self.output / "gerber" / "metadata.gbrjob").write_bytes(b"job metadata\n")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["artifacts"] = exports_module._manifest_artifacts(self.output)
        manifest_path.write_text(
            json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        self.assertFalse(exports_are_current(self.project, self.output))

        self.run_export()
        zip_path = self.output / f"{PROJECT_NAME}_gerbers.zip"
        with zipfile.ZipFile(zip_path, "w") as archive:
            archive.writestr("gerber/a-top.gbr", b"top gerber\n")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["artifacts"] = exports_module._manifest_artifacts(self.output)
        manifest_path.write_text(
            json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        self.assertFalse(exports_are_current(self.project, self.output))

    def test_manifest_rejects_path_traversal_and_bad_types(self):
        self.run_export()
        manifest_path = self.output / "source_manifest.json"
        baseline = json.loads(manifest_path.read_text(encoding="utf-8"))
        variants = (
            {**baseline, "schemaVersion": True},
            {**baseline, "projectDigest": "not-a-digest"},
            {**baseline, "artifacts": {"../escape": {"sha256": "0" * 64, "size": 0}}},
            {**baseline, "artifacts": {"/absolute": {"sha256": "0" * 64, "size": 0}}},
            {**baseline, "artifacts": {"source_manifest.json": {"sha256": "0" * 64, "size": 0}}},
        )
        for index, variant in enumerate(variants):
            with self.subTest(index=index):
                manifest_path.write_text(json.dumps(variant), encoding="utf-8")
                self.assertFalse(exports_are_current(self.project, self.output))

    def test_canonical_mutation_during_each_failure_is_detected_before_publish(self):
        for stage in EXPORT_STAGES:
            with self.subTest(stage=stage):
                project_copy = self.root / f"project-{stage}"
                shutil.copytree(self.project, project_copy)
                output = self.root / f"mutated-{stage}"
                before = project_digest(project_copy)
                with self.assertRaisesRegex(RuntimeError, "mutation"):
                    export_outputs(
                        project_copy,
                        output,
                        runner=FakeRunner(project_copy, mutate_on=stage),
                        validator=FakeValidator(),
                    )
                self.assertNotEqual(project_digest(project_copy), before)
                self.assertFalse(output.exists())

    def test_policy_mutation_during_validation_failure_is_detected(self):
        project = self.project

        class MutatingValidator(FakeValidator):
            def __call__(self, project_dir, output_dir=None, runner=None):
                result = super().__call__(
                    project_dir, output_dir=output_dir, runner=runner
                )
                policy = project / "validation_waivers.json"
                policy.write_text(
                    policy.read_text(encoding="utf-8") + " ", encoding="utf-8"
                )
                return result

        with self.assertRaisesRegex(RuntimeError, "policy mutation"):
            self.run_export(validator=MutatingValidator(INVALID))
        self.assertFalse(self.output.exists())

    def test_gerber_zip_is_sorted_safe_deterministic_and_fixed_metadata(self):
        first = self.root / "first"
        second = self.root / "second"
        self.run_export(output=first)
        self.run_export(output=second)
        first_zip = first / f"{PROJECT_NAME}_gerbers.zip"
        second_zip = second / f"{PROJECT_NAME}_gerbers.zip"
        self.assertEqual(first_zip.read_bytes(), second_zip.read_bytes())
        with zipfile.ZipFile(first_zip) as archive:
            infos = archive.infolist()
            self.assertEqual([item.filename for item in infos], sorted(item.filename for item in infos))
            self.assertTrue(all(item.date_time == (1980, 1, 1, 0, 0, 0) for item in infos))
            self.assertTrue(all((item.external_attr >> 16) & 0o777 == 0o644 for item in infos))
            self.assertTrue(all(not name.startswith("/") and ".." not in Path(name).parts for name in archive.namelist()))


class ExportPublicationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.parent = Path(self.temporary.name)
        self.output = self.parent / "pcb"

    def make_stage(self, label):
        stage = self.parent / f"build-{label}"
        stage.mkdir()
        artifact = stage / "artifact.txt"
        artifact.write_text(label + "\n", encoding="utf-8")
        digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
        manifest = {
            "schemaVersion": 1,
            "projectName": PROJECT_NAME,
            "projectDigest": "1" * 64,
            "policyDigest": "2" * 64,
            "exportRecipeDigest": "3" * 64,
            "kicadVersion": "10.0.4",
            "artifacts": {"artifact.txt": {"sha256": digest, "size": artifact.stat().st_size}},
        }
        (stage / "source_manifest.json").write_text(
            json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        return stage

    def temporary_siblings(self):
        return tuple(
            child.name
            for child in self.parent.iterdir()
            if child != self.output
            and not child.name.startswith("build-")
            and child.name != f".{self.output.name}.exports.lock"
        )

    def test_precommit_crash_recovers_old_set_before_next_publish(self):
        _publish_export_directory(self.output, self.make_stage("old"))
        old = _snapshot(self.output)

        class SimulatedCrash(BaseException):
            pass

        with self.assertRaises(SimulatedCrash):
            _publish_export_directory(
                self.output,
                self.make_stage("crash"),
                after_backup=lambda: (_ for _ in ()).throw(SimulatedCrash()),
            )
        self.assertFalse(self.output.exists())
        observed = []
        _publish_export_directory(
            self.output,
            self.make_stage("new"),
            after_recovery=lambda: observed.append(_snapshot(self.output)),
        )
        self.assertEqual(observed, [old])
        self.assertEqual((self.output / "artifact.txt").read_text(), "new\n")
        self.assertEqual(self.temporary_siblings(), ())

    def test_postcommit_cleanup_failure_never_restores_old_output(self):
        _publish_export_directory(self.output, self.make_stage("old"))
        with self.assertRaisesRegex(OSError, "cleanup pending"):
            _publish_export_directory(
                self.output,
                self.make_stage("new"),
                after_publish=lambda: (_ for _ in ()).throw(OSError("stop cleanup")),
            )
        self.assertEqual((self.output / "artifact.txt").read_text(), "new\n")
        _publish_export_directory(self.output, self.make_stage("latest"))
        self.assertEqual((self.output / "artifact.txt").read_text(), "latest\n")
        self.assertEqual(self.temporary_siblings(), ())

    def test_postcommit_refuses_tampered_output_and_preserves_backup(self):
        _publish_export_directory(self.output, self.make_stage("old"))

        def tamper_output():
            (self.output / "artifact.txt").write_text(
                "unknown owner\n", encoding="utf-8"
            )

        with self.assertRaisesRegex(OSError, "cleanup pending.*content mismatch"):
            _publish_export_directory(
                self.output,
                self.make_stage("new"),
                after_publish=tamper_output,
            )
        self.assertEqual(
            (self.output / "artifact.txt").read_text(encoding="utf-8"),
            "unknown owner\n",
        )
        backups = tuple(self.parent.glob(".pcb.exports-backup-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(
            (backups[0] / "artifact.txt").read_text(encoding="utf-8"), "old\n"
        )

    def test_postcommit_refuses_tampered_backup_and_preserves_both_trees(self):
        _publish_export_directory(self.output, self.make_stage("old"))

        def tamper_backup():
            backup = next(self.parent.glob(".pcb.exports-backup-*"))
            (backup / "artifact.txt").write_text(
                "unknown owner\n", encoding="utf-8"
            )

        with self.assertRaisesRegex(OSError, "cleanup pending.*content mismatch"):
            _publish_export_directory(
                self.output,
                self.make_stage("new"),
                after_publish=tamper_backup,
            )
        self.assertEqual(
            (self.output / "artifact.txt").read_text(encoding="utf-8"), "new\n"
        )
        backups = tuple(self.parent.glob(".pcb.exports-backup-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(
            (backups[0] / "artifact.txt").read_text(encoding="utf-8"),
            "unknown owner\n",
        )

    def test_postcommit_refuses_unknown_empty_directory_in_backup(self):
        _publish_export_directory(self.output, self.make_stage("old"))

        def tamper_backup():
            backup = next(self.parent.glob(".pcb.exports-backup-*"))
            (backup / "unknown-empty-directory").mkdir()

        with self.assertRaisesRegex(OSError, "cleanup pending.*content mismatch"):
            _publish_export_directory(
                self.output,
                self.make_stage("new"),
                after_publish=tamper_backup,
            )
        backups = tuple(self.parent.glob(".pcb.exports-backup-*"))
        self.assertEqual(len(backups), 1)
        self.assertTrue((backups[0] / "unknown-empty-directory").is_dir())

    def test_journal_temp_collision_is_refused_without_deleting_unknown_file(self):
        transaction = "a" * 32
        journal_path = self.parent / ".pcb.exports.transaction.json"
        temporary = self.parent / f"{journal_path.name}.{transaction}.tmp"
        temporary.write_bytes(b"unknown owner\n")
        value = {
            "transaction": transaction,
        }
        with self.assertRaisesRegex(OSError, "temporary already exists"):
            exports_module._write_transaction_journal(journal_path, value)
        self.assertEqual(temporary.read_bytes(), b"unknown owner\n")

    def test_same_inode_journal_temp_substitution_is_preserved(self):
        transaction = "b" * 32
        journal_path = self.parent / ".pcb.exports.transaction.json"
        journal_path.write_bytes(b"owned journal\n")
        expected = exports_module._journal_token(journal_path)
        temporary = self.parent / f"{journal_path.name}.{transaction}.tmp"

        def substitute_temp(*args):
            temporary.write_bytes(b"unknown owner\n")
            raise OSError("journal ownership mismatch")

        with mock.patch.object(
            exports_module, "_require_journal_token", side_effect=substitute_temp
        ):
            with self.assertRaisesRegex(OSError, "journal ownership"):
                exports_module._write_transaction_journal(
                    journal_path, {"transaction": transaction}, expected
                )
        self.assertEqual(temporary.read_bytes(), b"unknown owner\n")

    def test_postrename_journal_substitution_is_not_adopted(self):
        transaction = "c" * 32
        journal_path = self.parent / ".pcb.exports.transaction.json"
        real_replace = os.replace

        def replace_then_substitute(source, destination):
            real_replace(source, destination)
            Path(destination).write_bytes(b"unknown owner\n")

        with mock.patch.object(
            exports_module.os, "replace", side_effect=replace_then_substitute
        ):
            with self.assertRaisesRegex(OSError, "journal ownership"):
                exports_module._write_transaction_journal(
                    journal_path, {"transaction": transaction}
                )
        self.assertEqual(journal_path.read_bytes(), b"unknown owner\n")

    def test_journal_substitution_is_refused_without_deleting_unknown_file(self):
        journal_path = self.parent / ".pcb.exports.transaction.json"

        def substitute_journal():
            journal_path.unlink()
            journal_path.write_bytes(b"unknown owner\n")

        with self.assertRaisesRegex(OSError, "journal.*ownership"):
            _publish_export_directory(
                self.output,
                self.make_stage("new"),
                after_stage=substitute_journal,
            )
        self.assertEqual(journal_path.read_bytes(), b"unknown owner\n")

    def test_stage_symlink_substitution_is_refused_before_copying(self):
        unknown = self.parent / "unknown-owner"
        unknown.mkdir()
        (unknown / "marker.txt").write_bytes(b"preserve me\n")

        def substitute_stage():
            stage = next(self.parent.glob(".pcb.exports-stage-*"))
            shutil.rmtree(stage)
            stage.symlink_to(unknown, target_is_directory=True)

        with self.assertRaisesRegex(OSError, "stage.*ownership"):
            _publish_export_directory(
                self.output,
                self.make_stage("new"),
                after_stage=substitute_stage,
            )
        self.assertEqual(_snapshot(unknown), {"marker.txt": b"preserve me\n"})

    def test_manifestless_legacy_output_is_replaced_on_success(self):
        self.output.mkdir()
        nested = self.output / "legacy" / "nested"
        nested.mkdir(parents=True)
        (nested / "old.bin").write_bytes(b"legacy bytes\x00\n")
        (self.output / "old.txt").write_bytes(b"legacy root\n")
        _publish_export_directory(self.output, self.make_stage("new"))
        self.assertEqual((self.output / "artifact.txt").read_text(), "new\n")
        self.assertFalse((self.output / "legacy").exists())
        self.assertFalse((self.output / "old.txt").exists())
        self.assertEqual(self.temporary_siblings(), ())

    def test_legacy_tree_identity_is_journaled_before_any_rename(self):
        self.output.mkdir()
        (self.output / "empty").mkdir()
        (self.output / "old.txt").write_bytes(b"legacy root\n")
        expected_identity = list(
            exports_module._directory_identity(self.output, "legacy output")
        )
        expected_manifest = exports_module._tree_digest_manifest(
            self.output, "legacy output"
        )
        journal_path = self.parent / ".pcb.exports.transaction.json"
        observed = []
        real_replace = os.replace

        def observe_allocated():
            observed.append(
                json.loads(journal_path.read_text(encoding="utf-8"))
            )

        def observe_prepared_then_rename(source, destination):
            if Path(source) == self.output:
                observed.append(
                    json.loads(journal_path.read_text(encoding="utf-8"))
                )
            return real_replace(source, destination)

        _publish_export_directory(
            self.output,
            self.make_stage("new"),
            after_stage=observe_allocated,
            rename=observe_prepared_then_rename,
        )
        self.assertEqual([item["state"] for item in observed], ["allocated", "prepared"])
        for item in observed:
            self.assertEqual(item["backupIdentity"], expected_identity)
            self.assertEqual(item["backupManifest"], expected_manifest)

    def test_manifestless_legacy_output_is_restored_exactly_on_failure(self):
        self.output.mkdir()
        (self.output / "empty").mkdir()
        nested = self.output / "legacy" / "nested"
        nested.mkdir(parents=True)
        (nested / "old.bin").write_bytes(b"legacy bytes\x00\n")
        before = _tree_snapshot(self.output)

        with self.assertRaisesRegex(OSError, "injected legacy failure"):
            _publish_export_directory(
                self.output,
                self.make_stage("new"),
                after_backup=lambda: (_ for _ in ()).throw(
                    OSError("injected legacy failure")
                ),
            )
        self.assertEqual(_tree_snapshot(self.output), before)
        self.assertEqual(self.temporary_siblings(), ())

    def test_manifestless_legacy_output_is_recovered_after_backup_crash(self):
        self.output.mkdir()
        (self.output / "empty").mkdir()
        (self.output / "old.txt").write_bytes(b"legacy root\n")
        before = _tree_snapshot(self.output)

        class SimulatedCrash(BaseException):
            pass

        with self.assertRaises(SimulatedCrash):
            _publish_export_directory(
                self.output,
                self.make_stage("crash"),
                after_backup=lambda: (_ for _ in ()).throw(SimulatedCrash()),
            )
        self.assertFalse(self.output.exists())
        observed = []
        _publish_export_directory(
            self.output,
            self.make_stage("new"),
            after_recovery=lambda: observed.append(_tree_snapshot(self.output)),
        )
        self.assertEqual(observed, [before])
        self.assertEqual((self.output / "artifact.txt").read_text(), "new\n")

    def test_manifestless_legacy_output_with_symlink_is_refused_and_preserved(self):
        outside = self.parent / "outside.txt"
        outside.write_bytes(b"outside owner\n")
        self.output.mkdir()
        legacy_link = self.output / "legacy-link"
        legacy_link.symlink_to(outside)
        with self.assertRaisesRegex(OSError, "symlink"):
            _publish_export_directory(self.output, self.make_stage("new"))
        self.assertTrue(legacy_link.is_symlink())
        self.assertEqual(os.readlink(legacy_link), str(outside))
        self.assertEqual(outside.read_bytes(), b"outside owner\n")

    def test_manifestless_legacy_output_with_nonregular_entry_is_refused(self):
        self.output.mkdir()
        fifo = self.output / "legacy.pipe"
        os.mkfifo(fifo)
        with self.assertRaisesRegex(OSError, "non-regular"):
            _publish_export_directory(self.output, self.make_stage("new"))
        self.assertTrue(stat.S_ISFIFO(fifo.stat(follow_symlinks=False).st_mode))

    def test_recovery_accepts_committed_output_after_owned_backup_was_removed(self):
        _publish_export_directory(self.output, self.make_stage("old"))

        class SimulatedCrash(BaseException):
            pass

        def remove_then_crash(path):
            shutil.rmtree(path)
            raise SimulatedCrash()

        with self.assertRaises(SimulatedCrash):
            _publish_export_directory(
                self.output,
                self.make_stage("new"),
                remove_tree=remove_then_crash,
            )
        self.assertEqual(
            (self.output / "artifact.txt").read_text(encoding="utf-8"), "new\n"
        )
        _publish_export_directory(self.output, self.make_stage("latest"))
        self.assertEqual(
            (self.output / "artifact.txt").read_text(encoding="utf-8"), "latest\n"
        )

    def test_writer_serialization_and_failed_writer_cannot_partially_publish(self):
        _publish_export_directory(self.output, self.make_stage("old"))
        original = _snapshot(self.output)
        entered = threading.Event()
        release = threading.Event()
        failures = []

        def pause_then_fail():
            entered.set()
            release.wait(5)
            raise OSError("older failed")

        def older():
            try:
                _publish_export_directory(
                    self.output,
                    self.make_stage("older"),
                    after_backup=pause_then_fail,
                )
            except OSError as error:
                failures.append(str(error))

        thread = threading.Thread(target=older)
        thread.start()
        self.assertTrue(entered.wait(5))
        with self.assertRaisesRegex(OSError, "writer is busy"):
            _publish_export_directory(self.output, self.make_stage("racing"))
        release.set()
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertTrue(any("older failed" in item for item in failures))
        self.assertEqual(_snapshot(self.output), original)
        self.assertEqual(self.temporary_siblings(), ())

    def test_recovery_refuses_unrelated_output_instead_of_destroying_backup(self):
        _publish_export_directory(self.output, self.make_stage("old"))
        old = _snapshot(self.output)

        class SimulatedCrash(BaseException):
            pass

        with self.assertRaises(SimulatedCrash):
            _publish_export_directory(
                self.output,
                self.make_stage("crash"),
                after_backup=lambda: (_ for _ in ()).throw(SimulatedCrash()),
            )
        self.output.mkdir()
        (self.output / "unrelated.txt").write_text("new owner\n", encoding="utf-8")
        with self.assertRaisesRegex(OSError, "ownership|authoritative"):
            _publish_export_directory(self.output, self.make_stage("next"))
        self.assertEqual(_snapshot(self.output), {"unrelated.txt": b"new owner\n"})
        backups = tuple(self.parent.glob(".pcb.exports-backup-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(_snapshot(backups[0]), old)

    def test_allocated_recovery_refuses_substituted_unowned_stage(self):
        class SimulatedCrash(BaseException):
            pass

        with self.assertRaises(SimulatedCrash):
            _publish_export_directory(
                self.output,
                self.make_stage("crash"),
                after_stage=lambda: (_ for _ in ()).throw(SimulatedCrash()),
            )
        transaction_stage = next(self.parent.glob(".pcb.exports-stage-*"))
        shutil.rmtree(transaction_stage)
        transaction_stage.mkdir()
        (transaction_stage / "unrelated.txt").write_text(
            "new owner\n", encoding="utf-8"
        )
        with self.assertRaisesRegex(OSError, "ownership"):
            _publish_export_directory(self.output, self.make_stage("next"))
        self.assertEqual(
            _snapshot(transaction_stage), {"unrelated.txt": b"new owner\n"}
        )

    def test_export_transaction_names_do_not_collide_with_validation_protocol(self):
        _publish_export_directory(self.output, self.make_stage("new"))
        self.assertTrue((self.parent / ".pcb.exports.lock").is_file())
        self.assertFalse((self.parent / ".pcb.lock").exists())
        self.assertFalse((self.parent / ".pcb.transaction.json").exists())


class CaseHelperIntegrationTest(unittest.TestCase):
    def test_checked_in_default_legacy_export_has_no_manifest_and_is_stale(self):
        repository = Path(__file__).resolve().parents[4]
        manifest_relative = (
            "hardware/pocket_card/case/out/pcb/source_manifest.json"
        )
        tracked_manifest = subprocess.run(
            ["git", "ls-files", "--error-unmatch", manifest_relative],
            cwd=repository,
            capture_output=True,
            check=False,
        )
        self.assertEqual(tracked_manifest.returncode, 1)

        board_relative = (
            "hardware/pocket_card/case/out/pcb/"
            "pocket_card_controller.kicad_pcb"
        )
        checked_in_board = subprocess.run(
            ["git", "show", f"HEAD:{board_relative}"],
            cwd=repository,
            capture_output=True,
            check=False,
        )
        self.assertEqual(checked_in_board.returncode, 0)
        with tempfile.TemporaryDirectory() as directory:
            legacy = Path(directory) / "pcb"
            legacy.mkdir()
            (legacy / "pocket_card_controller.kicad_pcb").write_bytes(
                checked_in_board.stdout
            )
            self.assertFalse(exports_are_current(BOARD.parent, legacy))

    def test_export_runtime_protocol_artifacts_are_exactly_ignored(self):
        repository = Path(__file__).resolve().parents[4]
        ignored = (
            "hardware/pocket_card/case/out/.pcb.exports.lock",
            "hardware/pocket_card/case/out/.pcb.exports.transaction.json",
            "hardware/pocket_card/case/out/.pcb.exports.transaction.json.a.tmp",
            "hardware/pocket_card/case/out/.pcb.exports-stage-a",
            "hardware/pocket_card/case/out/.pcb.exports-backup-a",
        )
        for relative in ignored:
            with self.subTest(relative=relative):
                result = subprocess.run(
                    ["git", "check-ignore", "--quiet", relative],
                    cwd=repository,
                    check=False,
                )
                self.assertEqual(result.returncode, 0)
        unrelated = subprocess.run(
            [
                "git",
                "check-ignore",
                "--quiet",
                "hardware/pocket_card/case/out/.unrelated-hidden-file",
            ],
            cwd=repository,
            check=False,
        )
        self.assertEqual(unrelated.returncode, 1)

    def test_smt_helper_defaults_to_canonical_board_and_has_separate_jlc_bom(self):
        import hardware.pocket_card.case.export_smt as export_smt

        self.assertEqual(Path(export_smt.BRD).resolve(), BOARD.resolve())
        self.assertEqual(export_smt.JLC_BOM_NAME, "BOM_JLCPCB.csv")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            pos = output / f"{PROJECT_NAME}-all-pos.csv"
            pos.write_text(
                '"Ref","Val","Package","PosX","PosY","Rot","Side"\n'
                '"U1","MCP23017","SOIC","1","2","0","top"\n',
                encoding="utf-8",
            )
            bom = Path(export_smt.write_bom(output))
            with self.assertRaisesRegex(ValueError, "missing.*placement"):
                export_smt.write_cpl(pos, output)
            position_rows = "".join(
                f'"{ref}","value","package","1","2","0","top"\n'
                for ref in CURATED_REFS
            )
            pos.write_text(
                '"Ref","Val","Package","PosX","PosY","Rot","Side"\n'
                + position_rows,
                encoding="utf-8",
            )
            cpl = Path(export_smt.write_cpl(pos, output))
            self.assertEqual(bom.name, "BOM_JLCPCB.csv")
            self.assertEqual(cpl.name, "CPL.csv")
            self.assertNotEqual(bom.name, "BOM.csv")

    def test_smt_cpl_rejects_duplicate_invalid_side_and_nonfinite_rows(self):
        import hardware.pocket_card.case.export_smt as export_smt

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            header = '"Ref","Val","Package","PosX","PosY","Rot","Side"\n'
            valid_rows = [
                f'"{ref}","value","package","1","2","0","top"\n'
                for ref in CURATED_REFS
            ]
            cases = {
                "duplicate": valid_rows + [valid_rows[0]],
                "side": [valid_rows[0].replace('"top"', '"front"'), *valid_rows[1:]],
                "finite": [valid_rows[0].replace('"1"', '"NaN"', 1), *valid_rows[1:]],
            }
            for label, rows in cases.items():
                with self.subTest(label=label):
                    pos = output / f"{label}.csv"
                    pos.write_text(header + "".join(rows), encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, "duplicate|Side|finite"):
                        export_smt.write_cpl(pos, output / label)

    def test_smt_position_export_accepts_paths_and_uses_requested_board(self):
        import hardware.pocket_card.case.export_smt as export_smt

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "out"
            board = Path(directory) / "board.kicad_pcb"
            board.write_text("board", encoding="utf-8")
            calls = []

            def runner(command, **kwargs):
                calls.append((tuple(command), kwargs))
                path = Path(command[command.index("-o") + 1])
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("Ref,PosX,PosY,Rot,Side\n", encoding="utf-8")
                return subprocess.CompletedProcess(command, 0, "", "")

            result = Path(export_smt.export_kicad_pos(board, output, runner=runner))
            self.assertEqual(result.parent, output)
            self.assertEqual(Path(calls[0][0][-1]), board)

    def test_preview_refuses_stale_exports_before_import_or_output_side_effects(self):
        import hardware.pocket_card.case.place_preview as preview

        with mock.patch.object(
            preview,
            "require_current_exports",
            side_effect=RuntimeError(REQUIRED_CURRENT_ERROR),
        ), mock.patch.object(preview, "_load_modules") as load_modules:
            with self.assertRaisesRegex(RuntimeError, f"^{REQUIRED_CURRENT_ERROR}$"):
                preview.place_pcb()
        load_modules.assert_not_called()

    def test_preview_does_not_mask_internal_dependency_import_errors(self):
        import hardware.pocket_card.case.place_preview as preview

        with mock.patch.object(
            preview.importlib,
            "import_module",
            side_effect=(SimpleNamespace(), ImportError("dependency broke")),
        ) as import_module:
            with self.assertRaisesRegex(ImportError, "dependency broke"):
                preview._load_modules()
        self.assertEqual(import_module.call_count, 2)

    def test_preview_treats_manifest_owned_export_directory_as_read_only(self):
        import hardware.pocket_card.case.place_preview as preview

        exported = []
        bounds = SimpleNamespace(xmin=0, xmax=1, ymin=0, ymax=1, zmin=0, zmax=1)
        cadquery = SimpleNamespace(
            importers=SimpleNamespace(importStep=lambda path: object())
        )
        with mock.patch.object(preview, "_require_exports"), mock.patch.object(
            preview, "_ensure_output_dirs"
        ), mock.patch.object(
            preview, "_load_modules", return_value=(cadquery, None, None, None, None)
        ), mock.patch.object(
            preview, "kicad_pcb_to_model_space", return_value=object()
        ), mock.patch.object(
            preview, "_bbox", return_value=bounds
        ), mock.patch.object(
            preview, "_export", side_effect=lambda shape, path: exported.append(Path(path))
        ), mock.patch(
            "builtins.print"
        ):
            preview.place_pcb()
        self.assertTrue(exported)
        self.assertTrue(all(path.parent != preview.PCB_DIR for path in exported))


if __name__ == "__main__":
    unittest.main()
