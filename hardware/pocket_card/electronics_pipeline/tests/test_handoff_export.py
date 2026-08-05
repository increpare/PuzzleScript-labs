import json
import hashlib
import stat
import subprocess
import tempfile
import threading
import time
import unittest
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

import hardware.pocket_card.electronics_pipeline.handoff as handoff_module
from hardware.pocket_card.electronics_pipeline.exports import (
    _policy_digest,
    export_outputs,
)
from hardware.pocket_card.electronics_pipeline.handoff import export_handoff
from hardware.pocket_card.electronics_pipeline.inventory import project_digest
from hardware.pocket_card.electronics_pipeline.tests.test_exports import (
    FakeRunner,
    FakeValidator,
)


PROJECT_NAME = "pocket_card_controller"


class HandoffExportTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = self.root / "electronics"
        self.exports = self.root / "exports"
        self.output = self.root / "outgoing"
        self.project.mkdir()
        self.exports.mkdir()
        for name, content in {
            f"{PROJECT_NAME}.kicad_pro": b"{}\n",
            f"{PROJECT_NAME}.kicad_sch": b"(kicad_sch)\n",
            f"{PROJECT_NAME}.kicad_pcb": b"(kicad_pcb)\n",
            "fp-lib-table": b"(fp_lib_table (version 7))\n",
            "mechanical_contract.json": (
                b'{"schemaVersion":1,"features":[{"ref":"H1","xMm":64.5,'
                b'"yMm":56.0,"rotationDeg":0.0,"side":"F.Cu",'
                b'"lockedRequired":true,"rationale":"Rear enclosure mounting pin."}]}\n'
            ),
            "validation_waivers.json": b'{"schemaVersion":1,"groups":[]}\n',
            "toolchain.json": (
                b'{"schemaVersion":1,"project":"pocket_card_controller",'
                b'"kicad":{"major":10,"minimum":"10.0.4"}}\n'
            ),
        }.items():
            (self.project / name).write_bytes(content)
        for name, content in {
            f"{PROJECT_NAME}.pdf": b"%PDF-fake\n",
            f"{PROJECT_NAME}.step": b"ISO-10303-21;\n",
            "erc.json": b'{"violations":[]}\n',
            "drc.json": b'{"violations":[]}\n',
        }.items():
            (self.exports / name).write_bytes(content)
        artifact_metadata = {
            name: {
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "size": path.stat().st_size,
            }
            for name in (
                f"{PROJECT_NAME}.pdf",
                f"{PROJECT_NAME}.step",
                "erc.json",
                "drc.json",
            )
            for path in (self.exports / name,)
        }
        (self.exports / "source_manifest.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "projectName": PROJECT_NAME,
                    "projectDigest": project_digest(self.project),
                    "policyDigest": _policy_digest(self.project),
                    "exportRecipeDigest": "c" * 64,
                    "kicadVersion": "10.0.4",
                    "artifacts": artifact_metadata,
                },
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )

    @staticmethod
    def validator(project_dir, runner=None):
        return type(
            "Result",
            (),
            {
                "status": "PASS",
                "messages": (),
                "inventory": {
                    "schematic": {"components": {}, "nets": {}},
                    "board": {"footprints": {}, "edge_cuts": [], "thickness_mm": 1.6},
                },
            },
        )()

    @staticmethod
    def current_checker(project_dir, export_dir):
        return None

    @staticmethod
    def git_metadata(repo_root):
        return "a" * 40, 1785888000

    def refresh_manifest_digest(self):
        manifest_path = self.exports / "source_manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["projectDigest"] = project_digest(self.project)
        manifest_path.write_text(
            json.dumps(manifest, sort_keys=True) + "\n", encoding="utf-8"
        )

    def export(self, output=None, **kwargs):
        epoch = kwargs.pop("source_date_epoch", 1785888000)
        checker = kwargs.pop("current_exports_checker", self.current_checker)
        return export_handoff(
            self.project,
            output_dir=output or self.output,
            export_dir=self.exports,
            validator=self.validator,
            current_exports_checker=checker,
            git_metadata_provider=self.git_metadata,
            source_date_epoch=epoch,
            **kwargs,
        )

    def test_export_contains_sources_metadata_and_references_only(self):
        archive = self.export()
        with zipfile.ZipFile(archive) as package:
            names = package.namelist()
            self.assertIn(
                "pocket-card-controller/project/pocket_card_controller.kicad_sch",
                names,
            )
            self.assertIn("pocket-card-controller/HANDOFF.md", names)
            self.assertIn("pocket-card-controller/handoff.json", names)
            self.assertIn("pocket-card-controller/reference/board.step", names)
            self.assertIn("pocket-card-controller/reference/inventory.json", names)
            self.assertIn(
                "pocket-card-controller/reference/semantic-summary.md", names
            )
            self.assertNotIn(
                "pocket-card-controller/reference/pocket_card_complete.blend", names
            )
            self.assertFalse(
                any(name.endswith((".kicad_prl", ".lck", "~")) for name in names)
            )
            metadata = json.loads(
                package.read("pocket-card-controller/handoff.json")
            )
        self.assertEqual(metadata["schemaVersion"], 1)
        self.assertEqual(metadata["projectName"], PROJECT_NAME)
        self.assertRegex(metadata["baseProjectDigest"], r"^[0-9a-f]{64}$")
        self.assertEqual(metadata["gitCommit"], "a" * 40)
        self.assertEqual(metadata["kicadVersion"], "10.0.4")

    def test_same_source_date_epoch_produces_identical_zip_bytes(self):
        first = self.export(self.root / "first")
        second = self.export(self.root / "second")
        self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_nonpassing_validation_refuses_without_checking_exports_or_writing(self):
        calls = []

        def invalid_validator(project_dir, runner=None):
            return type(
                "Result",
                (),
                {"status": "MECHANICAL REVIEW REQUIRED", "messages": ("moved H1",)},
            )()

        def checker(project_dir, export_dir):
            calls.append("checked")

        with self.assertRaisesRegex(RuntimeError, "requires baseline PASS"):
            export_handoff(
                self.project,
                output_dir=self.output,
                export_dir=self.exports,
                validator=invalid_validator,
                current_exports_checker=checker,
                git_metadata_provider=self.git_metadata,
            )
        self.assertEqual(calls, [])
        self.assertFalse(self.output.exists())

    def test_false_currentness_result_is_treated_as_stale(self):
        with self.assertRaisesRegex(RuntimeError, "stale"):
            export_handoff(
                self.project,
                output_dir=self.output,
                export_dir=self.exports,
                validator=self.validator,
                current_exports_checker=lambda project, exports: False,
                git_metadata_provider=self.git_metadata,
            )
        self.assertFalse(self.output.exists())

    def test_source_mutation_at_publication_is_detected_and_old_zip_is_preserved(self):
        old = self.export().read_bytes()
        board = self.project / f"{PROJECT_NAME}.kicad_pcb"

        def mutate():
            board.write_bytes(board.read_bytes() + b"changed\n")

        with self.assertRaisesRegex(RuntimeError, "canonical project changed"):
            self.export(before_publish=mutate)
        self.assertEqual(
            (self.output / "pocket-card-controller.zip").read_bytes(), old
        )
        self.assertEqual(
            [path for path in self.output.iterdir() if path.suffix == ".tmp"], []
        )

    def test_archive_metadata_layout_and_engineer_instructions_are_exact(self):
        (self.project / "pocket_card_controller.kicad_prl").write_bytes(b"editor\n")
        (self.project / "~pocket_card_controller.kicad_pro.lck").write_bytes(b"lock\n")
        backup = self.project / "pocket_card_controller-backups"
        backup.mkdir()
        (backup / "old.kicad_sch").write_bytes(b"old\n")
        models = self.project / "3dmodels" / "nested"
        models.mkdir(parents=True)
        (models / "button.step").write_bytes(b"STEP local model\n")
        self.refresh_manifest_digest()
        archive = self.export()
        with zipfile.ZipFile(archive) as package:
            infos = package.infolist()
            names = [info.filename for info in infos]
            instructions = package.read("pocket-card-controller/HANDOFF.md").decode()
        self.assertEqual(names, sorted(names))
        self.assertTrue(all(name.startswith("pocket-card-controller/") for name in names))
        self.assertFalse(any("backups" in name or name.endswith((".kicad_prl", ".lck")) for name in names))
        self.assertIn("pocket-card-controller/project/3dmodels/nested/button.step", names)
        self.assertTrue(all(info.compress_type == zipfile.ZIP_DEFLATED for info in infos))
        self.assertTrue(all(info.date_time == (2026, 8, 5, 0, 0, 0) for info in infos))
        self.assertTrue(all((info.external_attr >> 16) & 0o777 == 0o644 for info in infos))
        self.assertTrue(all(stat.S_ISREG(info.external_attr >> 16) for info in infos))
        for phrase in (
            "KiCad 10",
            "Edit anything needed",
            "Preserve existing reference designators",
            "Annotate every new symbol",
            "Update PCB from Schematic",
            "deliberately unlock",
            "trigger enclosure review",
            "${KIPRJMOD}",
            "Never edit",
            "same single top-level `pocket-card-controller/` directory",
            "authoritative mechanical references",
            "Blender is visual context only",
        ):
            self.assertIn(phrase, instructions)

    def test_semantic_summary_describes_contracted_mechanical_features(self):
        archive = self.export()
        with zipfile.ZipFile(archive) as package:
            summary = package.read(
                "pocket-card-controller/reference/semantic-summary.md"
            ).decode()
        for detail in (
            "H1",
            "64.5 mm",
            "56.0 mm",
            "F.Cu",
            "locked",
            "Rear enclosure mounting pin.",
        ):
            self.assertIn(detail, summary)

    def test_optional_blender_uses_distinct_filename_and_is_visual_only(self):
        blend = self.root / "pocket_card_complete.blend"
        blend.write_bytes(b"BLENDER-viz\n")
        archive = self.export(include_blend=True, blend_path=blend)
        self.assertEqual(archive.name, "pocket-card-controller-with-blender.zip")
        with zipfile.ZipFile(archive) as package:
            self.assertEqual(
                package.read(
                    "pocket-card-controller/reference/pocket_card_complete.blend"
                ),
                b"BLENDER-viz\n",
            )
            instructions = package.read("pocket-card-controller/HANDOFF.md").decode()
        self.assertIn("supplementary visual context", instructions)
        self.assertIn("must not be treated as dimensional CAD authority", instructions)

    def test_optional_blender_refuses_a_symlink(self):
        real = self.root / "real.blend"
        real.write_bytes(b"blend\n")
        link = self.root / "linked.blend"
        link.symlink_to(real)
        with self.assertRaisesRegex(RuntimeError, "missing or unsafe"):
            self.export(include_blend=True, blend_path=link)
        self.assertFalse(self.output.exists())

    def test_missing_required_project_source_is_rejected_even_by_passing_fake_validator(self):
        (self.project / f"{PROJECT_NAME}.kicad_pcb").unlink()
        with self.assertRaisesRegex(RuntimeError, "required.*project|missing.*project"):
            self.export()
        self.assertFalse(self.output.exists())

    def test_real_task5_currentness_accepts_verified_tree_and_rejects_tampering(self):
        verified = self.root / "verified-exports"
        export_outputs(
            self.project,
            verified,
            runner=FakeRunner(self.project),
            validator=FakeValidator(),
        )
        archive = export_handoff(
            self.project,
            output_dir=self.output,
            export_dir=verified,
            validator=self.validator,
            git_metadata_provider=self.git_metadata,
            source_date_epoch=1785888000,
        )
        old = archive.read_bytes()
        (verified / f"{PROJECT_NAME}.pdf").write_bytes(b"tampered PDF\n")
        with self.assertRaisesRegex(RuntimeError, "missing or stale"):
            export_handoff(
                self.project,
                output_dir=self.output,
                export_dir=verified,
                validator=self.validator,
                git_metadata_provider=self.git_metadata,
                source_date_epoch=1785888000,
            )
        self.assertEqual(archive.read_bytes(), old)

    def test_export_mutation_between_currentness_checks_cannot_publish(self):
        calls = 0
        pdf = self.exports / f"{PROJECT_NAME}.pdf"

        def mutating_checker(project, exports):
            nonlocal calls
            calls += 1
            if calls == 1:
                pdf.write_bytes(b"mutated after check\n")
            elif pdf.read_bytes() != b"%PDF-fake\n":
                raise RuntimeError("PCB export is missing or stale")

        with self.assertRaisesRegex(RuntimeError, "stale|hash"):
            self.export(current_exports_checker=mutating_checker)
        self.assertFalse(self.output.exists())

    def test_output_inside_source_tree_is_refused_without_creating_it(self):
        nested = self.project / "generated" / "outgoing"
        with self.assertRaisesRegex(RuntimeError, "outside source"):
            self.export(output=nested)
        self.assertFalse(nested.exists())

    def test_unsafe_existing_destination_is_never_overwritten(self):
        self.output.mkdir()
        target = self.root / "outside.zip"
        target.write_bytes(b"outside\n")
        destination = self.output / "pocket-card-controller.zip"
        destination.symlink_to(target)
        with self.assertRaisesRegex(RuntimeError, "non-regular"):
            self.export()
        self.assertEqual(target.read_bytes(), b"outside\n")
        self.assertTrue(destination.is_symlink())

    def test_replace_failure_preserves_old_archive_and_cleans_only_owned_temp(self):
        archive = self.export()
        old = archive.read_bytes()
        unrelated = self.output / ".pocket-card-controller.zip.keep.tmp"
        unrelated.write_bytes(b"keep\n")
        with mock.patch.object(
            handoff_module.os, "replace", side_effect=OSError("replace failed")
        ):
            with self.assertRaisesRegex(OSError, "replace failed"):
                self.export()
        self.assertEqual(archive.read_bytes(), old)
        self.assertEqual(unrelated.read_bytes(), b"keep\n")
        self.assertEqual(
            sorted(path.name for path in self.output.glob("*.tmp")),
            [unrelated.name],
        )

    def test_epoch_precedence_metadata_schema_and_zip_safe_clamping(self):
        with mock.patch.dict("os.environ", {"SOURCE_DATE_EPOCH": "not-an-epoch"}):
            explicit = self.export(source_date_epoch=-315619200)
        with zipfile.ZipFile(explicit) as package:
            metadata = json.loads(package.read("pocket-card-controller/handoff.json"))
            self.assertTrue(all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in package.infolist()))
        self.assertEqual(
            set(metadata),
            {
                "schemaVersion",
                "projectName",
                "baseProjectDigest",
                "gitCommit",
                "createdAt",
                "kicadVersion",
                "toolVersions",
            },
        )
        self.assertEqual(metadata["createdAt"], "1960-01-01T00:00:00Z")
        self.assertEqual(metadata["toolVersions"], {"handoffPipeline": "1"})

        high = self.export(
            self.root / "future", source_date_epoch=4354819201
        )
        with zipfile.ZipFile(high) as package:
            self.assertTrue(
                all(
                    info.date_time == (2107, 12, 31, 23, 59, 58)
                    for info in package.infolist()
                )
            )

    def test_environment_epoch_then_commit_epoch_are_used_deterministically(self):
        with mock.patch.dict("os.environ", {"SOURCE_DATE_EPOCH": "1785888001"}):
            environment = self.export(
                self.root / "environment", source_date_epoch=None
            )
        with zipfile.ZipFile(environment) as package:
            metadata = json.loads(package.read("pocket-card-controller/handoff.json"))
            self.assertTrue(
                all(info.date_time == (2026, 8, 5, 0, 0, 0) for info in package.infolist())
            )
        self.assertEqual(metadata["createdAt"], "2026-08-05T00:00:01Z")

        with mock.patch.dict("os.environ", {}, clear=True):
            commit = self.export(self.root / "commit", source_date_epoch=None)
        with zipfile.ZipFile(commit) as package:
            commit_metadata = json.loads(
                package.read("pocket-card-controller/handoff.json")
            )
        self.assertEqual(commit_metadata["createdAt"], "2026-08-05T00:00:00Z")

    def test_invalid_environment_epoch_refuses_without_output(self):
        with mock.patch.dict("os.environ", {"SOURCE_DATE_EPOCH": " 123 "}):
            with self.assertRaisesRegex(RuntimeError, "must be an integer"):
                self.export(source_date_epoch=None)
        self.assertFalse(self.output.exists())

    def test_git_head_change_and_policy_change_preserve_old_archive(self):
        archive = self.export()
        old = archive.read_bytes()
        calls = 0

        def moving_head(repo):
            nonlocal calls
            calls += 1
            return (("b" if calls > 1 else "a") * 40, 1785888000)

        with self.assertRaisesRegex(RuntimeError, "Git HEAD changed"):
            export_handoff(
                self.project,
                output_dir=self.output,
                export_dir=self.exports,
                validator=self.validator,
                current_exports_checker=self.current_checker,
                git_metadata_provider=moving_head,
                source_date_epoch=1785888000,
            )
        self.assertEqual(archive.read_bytes(), old)

        policy = self.project / "validation_waivers.json"

        def mutate_policy():
            policy.write_bytes(policy.read_bytes() + b" ")

        with self.assertRaisesRegex(RuntimeError, "validation policy changed"):
            self.export(before_publish=mutate_policy)
        self.assertEqual(archive.read_bytes(), old)

    def test_metadata_and_generated_references_leak_no_workstation_path(self):
        archive = self.export()
        forbidden = str(self.root).encode()
        with zipfile.ZipFile(archive) as package:
            for name in package.namelist():
                if "/project/" not in name:
                    self.assertNotIn(forbidden, package.read(name), name)

    def test_cli_export_prints_absolute_archive_and_passes_variant_options(self):
        self.output.mkdir()
        archive = self.output / "pocket-card-controller-with-blender.zip"
        archive.write_bytes(b"zip\n")
        with mock.patch.object(
            handoff_module, "export_handoff", return_value=archive
        ) as exporter, mock.patch("builtins.print") as printed:
            status = handoff_module.main(
                ["export", "--include-blend", "--output-dir", str(self.output)]
            )
        self.assertEqual(status, 0)
        exporter.assert_called_once_with(
            include_blend=True, output_dir=self.output
        )
        printed.assert_called_once_with(str(archive.resolve()))

    def test_cli_failure_is_bounded_and_returns_one(self):
        with mock.patch.object(
            handoff_module,
            "export_handoff",
            side_effect=RuntimeError("x" * 20000),
        ), mock.patch("builtins.print") as printed:
            status = handoff_module.main(["export"])
        self.assertEqual(status, 1)
        message = printed.call_args.args[0]
        self.assertTrue(message.startswith("ERROR: "))
        self.assertLessEqual(len(message), len("ERROR: ") + 8192)

    def test_cli_failure_sanitizes_workstation_paths(self):
        secret_path = str(self.root / "secret")
        with mock.patch.object(
            handoff_module,
            "export_handoff",
            side_effect=RuntimeError(f"unsafe input at {secret_path}"),
        ), mock.patch("builtins.print") as printed:
            status = handoff_module.main(["export"])
        self.assertEqual(status, 1)
        message = printed.call_args.args[0]
        self.assertNotIn(str(self.root), message)
        self.assertIn("<tmp>", message)

    def test_backslash_in_local_asset_name_is_rejected_as_non_posix(self):
        models = self.project / "3dmodels"
        models.mkdir()
        (models / "bad\\name.step").write_bytes(b"step\n")
        self.refresh_manifest_digest()
        with self.assertRaisesRegex(RuntimeError, "unsafe archive member"):
            self.export()
        self.assertFalse(self.output.exists())

    def test_nonfinite_validation_inventory_is_rejected(self):
        def validator(project_dir, runner=None):
            return type(
                "Result",
                (),
                {
                    "status": "PASS",
                    "messages": (),
                    "inventory": {
                        "schematic": {"components": {}, "nets": {}},
                        "board": {
                            "footprints": {},
                            "edge_cuts": [],
                            "thickness_mm": float("nan"),
                        },
                    },
                },
            )()

        with self.assertRaisesRegex((RuntimeError, ValueError), "finite|JSON"):
            export_handoff(
                self.project,
                output_dir=self.output,
                export_dir=self.exports,
                validator=validator,
                current_exports_checker=self.current_checker,
                git_metadata_provider=self.git_metadata,
                source_date_epoch=1785888000,
            )
        self.assertFalse(self.output.exists())

    def test_output_directory_substitution_refuses_and_cleans_owned_temp(self):
        archive = self.export()
        old = archive.read_bytes()
        displaced = self.root / "displaced-output"
        attacker = self.root / "attacker-output"

        def substitute_output():
            self.output.rename(displaced)
            attacker.mkdir()
            self.output.symlink_to(attacker, target_is_directory=True)

        with self.assertRaisesRegex(RuntimeError, "output directory changed"):
            self.export(before_publish=substitute_output)
        self.assertFalse((attacker / "pocket-card-controller.zip").exists())
        self.assertEqual(
            (displaced / "pocket-card-controller.zip").read_bytes(), old
        )
        self.assertEqual(list(displaced.glob("*.tmp")), [])

    def test_temporary_file_substitution_cannot_replace_old_archive(self):
        archive = self.export()
        old = archive.read_bytes()
        victim = self.root / "victim"
        victim.write_bytes(b"victim\n")
        substituted = None

        def substitute_temp():
            nonlocal substituted
            substituted = next(self.output.glob(".*.tmp"))
            substituted.unlink()
            substituted.symlink_to(victim)

        with self.assertRaisesRegex(RuntimeError, "temporary handoff file changed"):
            self.export(before_publish=substitute_temp)
        self.assertEqual(victim.read_bytes(), b"victim\n")
        self.assertEqual(archive.read_bytes(), old)
        self.assertIsNotNone(substituted)
        self.assertTrue(substituted.is_symlink())

    def test_stream_open_failure_closes_descriptor_and_cleans_owned_temp(self):
        archive = self.export()
        old = archive.read_bytes()
        with mock.patch.object(
            handoff_module.os, "fdopen", side_effect=OSError("stream failed")
        ):
            with self.assertRaisesRegex(OSError, "stream failed"):
                self.export()
        self.assertEqual(archive.read_bytes(), old)
        self.assertEqual(list(self.output.glob(".*.tmp")), [])

    def test_transient_export_swap_cannot_be_hidden_by_later_currentness_restore(self):
        pdf = self.exports / f"{PROJECT_NAME}.pdf"
        original = pdf.read_bytes()
        transient = b"%PDF-transient-attack\n"
        calls = 0

        def checker(project, exports):
            nonlocal calls
            calls += 1
            if calls == 1:
                pdf.write_bytes(transient)
            else:
                pdf.write_bytes(original)

        try:
            with self.assertRaisesRegex(RuntimeError, "manifest|hash|snapshot"):
                self.export(current_exports_checker=checker)
        finally:
            pdf.write_bytes(original)
        self.assertFalse((self.output / "pocket-card-controller.zip").exists())

    def test_transient_project_swap_cannot_be_hidden_by_later_digest_restore(self):
        board = self.project / f"{PROJECT_NAME}.kicad_pcb"
        original = board.read_bytes()
        calls = 0

        def checker(project, exports):
            nonlocal calls
            calls += 1
            if calls == 1:
                board.write_bytes(original + b"transient attack\n")
            else:
                board.write_bytes(original)

        try:
            with self.assertRaisesRegex(RuntimeError, "digest|snapshot"):
                self.export(current_exports_checker=checker)
        finally:
            board.write_bytes(original)
        self.assertFalse((self.output / "pocket-card-controller.zip").exists())

    def test_transient_manifest_and_artifact_pair_cannot_replace_verified_provenance(self):
        pdf = self.exports / f"{PROJECT_NAME}.pdf"
        manifest_path = self.exports / "source_manifest.json"
        original_pdf = pdf.read_bytes()
        original_manifest = manifest_path.read_bytes()
        transient_pdf = b"%PDF-transient-with-matching-manifest\n"
        transient_manifest = json.loads(original_manifest)
        transient_manifest["artifacts"][f"{PROJECT_NAME}.pdf"] = {
            "sha256": hashlib.sha256(transient_pdf).hexdigest(),
            "size": len(transient_pdf),
        }
        transient_manifest_bytes = (
            json.dumps(transient_manifest, sort_keys=True) + "\n"
        ).encode()
        calls = 0

        def checker(project, exports):
            nonlocal calls
            calls += 1
            if calls == 1:
                pdf.write_bytes(transient_pdf)
                manifest_path.write_bytes(transient_manifest_bytes)
            else:
                pdf.write_bytes(original_pdf)
                manifest_path.write_bytes(original_manifest)

        try:
            with self.assertRaisesRegex(RuntimeError, "manifest.*changed|provenance"):
                self.export(current_exports_checker=checker)
        finally:
            pdf.write_bytes(original_pdf)
            manifest_path.write_bytes(original_manifest)
        self.assertFalse((self.output / "pocket-card-controller.zip").exists())

    def test_optional_blender_fifo_is_rejected_without_blocking(self):
        fifo = self.root / "visual.blend"
        fifo_code = f"""
import os
from pathlib import Path
from hardware.pocket_card.electronics_pipeline.handoff import _read_regular_bytes
path = Path({str(fifo)!r})
os.mkfifo(path)
try:
    _read_regular_bytes(path, 'Blender visual reference')
except Exception as error:
    print(error)
    raise SystemExit(0)
raise SystemExit(3)
"""
        result = subprocess.run(
            ["python3", "-c", fifo_code],
            cwd=Path(__file__).resolve().parents[4],
            text=True,
            capture_output=True,
            timeout=2,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("regular file", result.stdout)

    def test_blender_requires_real_header_and_rejects_lfs_pointer(self):
        for content in (
            b"arbitrary bytes\n",
            b"version https://git-lfs.github.com/spec/v1\noid sha256:123\n",
        ):
            with self.subTest(content=content[:12]):
                blend = self.root / "invalid.blend"
                blend.write_bytes(content)
                with self.assertRaisesRegex(RuntimeError, "Blender.*header|BLENDER"):
                    self.export(include_blend=True, blend_path=blend)
                self.assertFalse(self.output.exists())

    def test_archive_member_and_total_size_bounds_are_inclusive_and_strict(self):
        entry_type = handoff_module._ArchiveEntry
        placeholder = self.root / "placeholder"
        digest = "0" * 64
        exactly_members = [
            entry_type(f"pocket-card-controller/project/{index}", placeholder, 1, digest)
            for index in range(2_000)
        ]
        self.assertEqual(handoff_module._check_archive_bounds(exactly_members), 2_000)
        with self.assertRaisesRegex(RuntimeError, "2000 members"):
            handoff_module._check_archive_bounds(
                exactly_members
                + [entry_type("pocket-card-controller/project/overflow", placeholder, 1, digest)]
            )

        exactly_bytes = [
            entry_type("pocket-card-controller/project/a", placeholder, 2**31 - 1, digest),
            entry_type("pocket-card-controller/project/b", placeholder, 1, digest),
        ]
        self.assertEqual(handoff_module._check_archive_bounds(exactly_bytes), 2**31)
        with self.assertRaisesRegex(RuntimeError, "2147483648 uncompressed bytes"):
            handoff_module._check_archive_bounds(
                exactly_bytes
                + [entry_type("pocket-card-controller/project/c", placeholder, 1, digest)]
            )

    def test_archive_bounds_reject_malformed_per_file_digest(self):
        entry = handoff_module._ArchiveEntry(
            "pocket-card-controller/project/a", self.root / "a", 1, "bad"
        )
        with self.assertRaisesRegex(RuntimeError, "digest"):
            handoff_module._check_archive_bounds([entry])

    def test_sparse_oversized_blender_is_rejected_before_copying_payload(self):
        blend = self.root / "oversized.blend"
        with blend.open("wb") as stream:
            stream.write(b"BLENDER")
            stream.truncate(2**31 + 1)
        snapshot = self.root / "snapshot"
        with self.assertRaisesRegex(RuntimeError, "maximum supported size"):
            handoff_module._snapshot_regular(
                blend,
                snapshot,
                "Blender visual reference",
                required_prefix=b"BLENDER",
            )
        self.assertFalse(snapshot.exists())

    def test_project_local_asset_fifo_is_rejected_without_opening_it(self):
        models = self.project / "3dmodels"
        models.mkdir()
        fifo = models / "model.step"
        fifo_code = f"""
import os
from pathlib import Path
from hardware.pocket_card.electronics_pipeline.handoff import _canonical_project_digest
project = Path({str(self.project)!r})
os.mkfifo(project / '3dmodels' / 'model.step')
try:
    _canonical_project_digest(project)
except Exception as error:
    print(error)
    raise SystemExit(0)
raise SystemExit(3)
"""
        fifo.unlink(missing_ok=True)
        result = subprocess.run(
            ["python3", "-c", fifo_code],
            cwd=Path(__file__).resolve().parents[4],
            text=True,
            capture_output=True,
            timeout=2,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("regular file", result.stdout)

    def test_export_streaming_does_not_use_path_read_bytes_for_payloads(self):
        with mock.patch.object(
            Path,
            "read_bytes",
            side_effect=AssertionError("payload buffering is forbidden"),
        ):
            archive = self.export()
        with zipfile.ZipFile(archive) as package:
            self.assertEqual(
                package.read(
                    "pocket-card-controller/project/pocket_card_controller.kicad_pcb"
                ),
                b"(kicad_pcb)\n",
            )

    def test_post_replace_directory_fsync_failure_leaves_new_zip_authoritative(self):
        archive = self.export()
        old = archive.read_bytes()

        def fail_directory_fsync(descriptor):
            raise OSError("directory fsync failed")

        with self.assertRaisesRegex(
            RuntimeError, "publication committed; durability unknown"
        ):
            self.export(
                source_date_epoch=1785888002,
                directory_fsync=fail_directory_fsync,
            )
        self.assertTrue(archive.is_file())
        self.assertNotEqual(archive.read_bytes(), old)
        with zipfile.ZipFile(archive) as package:
            metadata = json.loads(package.read("pocket-card-controller/handoff.json"))
        self.assertEqual(metadata["createdAt"], "2026-08-05T00:00:02Z")
        journal = self.output / ".pocket-card-controller.zip.handoff-journal.json"
        self.assertTrue(journal.is_file())
        recovered = self.export(source_date_epoch=1785888004)
        self.assertTrue(recovered.is_file())
        self.assertFalse(journal.exists())

    def test_abrupt_crash_complete_temp_is_recovered_before_next_export(self):
        archive = self.export()
        old = archive.read_bytes()

        class SimulatedCrash(BaseException):
            pass

        with self.assertRaises(SimulatedCrash):
            self.export(
                source_date_epoch=1785888002,
                before_publish=lambda: (_ for _ in ()).throw(SimulatedCrash()),
            )
        hidden = list(self.output.glob(".pocket-card-controller.zip.*.tmp"))
        self.assertEqual(len(hidden), 1)
        self.assertTrue(
            (self.output / ".pocket-card-controller.zip.handoff-journal.json").is_file()
        )
        self.assertEqual(archive.read_bytes(), old)

        recovered = self.export(source_date_epoch=1785888004)
        self.assertNotEqual(recovered.read_bytes(), old)
        self.assertEqual(
            list(self.output.glob(".pocket-card-controller.zip.*.tmp")), []
        )
        self.assertFalse(
            (self.output / ".pocket-card-controller.zip.handoff-journal.json").exists()
        )

    def test_crash_recovery_refuses_substituted_temp_and_journal(self):
        class SimulatedCrash(BaseException):
            pass

        with self.assertRaises(SimulatedCrash):
            self.export(
                before_publish=lambda: (_ for _ in ()).throw(SimulatedCrash())
            )
        temp_path = next(self.output.glob(".pocket-card-controller.zip.*.tmp"))
        journal = self.output / ".pocket-card-controller.zip.handoff-journal.json"
        victim = self.root / "victim"
        victim.write_bytes(b"victim\n")
        temp_path.unlink()
        temp_path.symlink_to(victim)
        with self.assertRaisesRegex(RuntimeError, "ownership|substitut"):
            self.export()
        self.assertEqual(victim.read_bytes(), b"victim\n")
        self.assertTrue(temp_path.is_symlink())
        self.assertTrue(journal.is_file())

        temp_path.unlink()
        journal.unlink()
        journal.symlink_to(victim)
        with self.assertRaisesRegex(RuntimeError, "journal|unsafe"):
            self.export()
        self.assertEqual(victim.read_bytes(), b"victim\n")
        self.assertTrue(journal.is_symlink())

    def test_concurrent_publishers_are_serialized_by_variant_lock(self):
        active = 0
        maximum_active = 0
        state_lock = threading.Lock()
        rendezvous = threading.Barrier(2)

        def callback():
            nonlocal active, maximum_active
            with state_lock:
                active += 1
                maximum_active = max(maximum_active, active)
            try:
                try:
                    rendezvous.wait(timeout=0.3)
                except threading.BrokenBarrierError:
                    pass
                time.sleep(0.05)
            finally:
                with state_lock:
                    active -= 1

        def publish(epoch):
            return self.export(source_date_epoch=epoch, before_publish=callback)

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = tuple(executor.map(publish, (1785888000, 1785888002)))
        self.assertEqual(maximum_active, 1)
        self.assertTrue(all(path.is_file() for path in results))
        self.assertEqual(
            list(self.output.glob(".pocket-card-controller.zip.*.tmp")), []
        )

    def test_unknown_matching_temp_without_journal_is_never_scavenged(self):
        self.output.mkdir()
        unknown = (
            self.output
            / ".pocket-card-controller.zip.0123456789abcdef0123456789abcdef.tmp"
        )
        unknown.write_bytes(b"unowned\n")
        archive = self.export()
        self.assertTrue(archive.is_file())
        self.assertEqual(unknown.read_bytes(), b"unowned\n")


if __name__ == "__main__":
    unittest.main()
