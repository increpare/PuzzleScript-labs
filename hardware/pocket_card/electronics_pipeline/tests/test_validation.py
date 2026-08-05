import dataclasses
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from hardware.pocket_card.electronics_pipeline.inventory import project_digest
from hardware.pocket_card.electronics_pipeline.paths import VALIDATION_WAIVERS
from hardware.pocket_card.electronics_pipeline.validation import (
    INVALID,
    MECHANICAL_REVIEW_REQUIRED,
    PASS,
    ValidationResult,
    classify_reports,
    load_waivers,
    main,
    validate_project,
    violation_fingerprint,
    warning_group_digest,
)


def violation(scope="ERC", severity="warning", kind="endpoint_off_grid", uuids=("item-a",)):
    return {
        "scope": scope,
        "severity": severity,
        "type": kind,
        "items": tuple({"uuid": uuid} for uuid in uuids),
    }


def reports(*violations, unconnected=()):
    grouped = {"ERC": [], "DRC": [], "parity": []}
    for item in violations:
        grouped[item["scope"]].append(item)
    return {
        "ERC": {"violations": grouped["ERC"]},
        "DRC": {"violations": grouped["DRC"]},
        "parity": {"violations": grouped["parity"]},
        "unconnected": {"items": list(unconnected)},
    }


def waiver_for(*violations, rationale="Reviewed baseline."):
    first = violations[0]
    return {
        "schemaVersion": 1,
        "groups": [
            {
                "scope": first["scope"],
                "type": first["type"],
                "count": len(violations),
                "fingerprintDigest": warning_group_digest(violations),
                "rationale": rationale,
            }
        ],
    }


class FingerprintPolicyTest(unittest.TestCase):
    def test_fingerprint_uses_pipe_fields_and_pipe_joined_sorted_item_uuids(self):
        item = violation(uuids=("uuid-z", "uuid-a"))
        self.assertEqual(
            violation_fingerprint(item),
            "erc|warning|endpoint_off_grid|uuid-a|uuid-z",
        )
        expected = hashlib.sha256(
            b"erc|warning|endpoint_off_grid|uuid-a|uuid-z"
        ).hexdigest()
        self.assertEqual(warning_group_digest((item,)), expected)

    def test_warning_waiver_requires_exact_count_and_uuid_fingerprint(self):
        baseline = (
            violation(uuids=("a", "b")),
            violation(uuids=("c",)),
        )
        waivers = waiver_for(*baseline)
        self.assertEqual(classify_reports(reports(*baseline), waivers).status, PASS)

        variants = {
            "missing": baseline[:1],
            "extra": (*baseline, violation(uuids=("d",))),
            "substituted": (baseline[0], violation(uuids=("x",))),
        }
        for label, changed in variants.items():
            with self.subTest(label=label):
                result = classify_reports(reports(*changed), waivers)
                self.assertEqual(result.status, INVALID)
                self.assertTrue(any("waiver" in message.lower() for message in result.messages))

    def test_errors_unconnected_and_unwaived_warning_groups_are_invalid(self):
        cases = {
            "error": reports(violation(severity="error")),
            "unconnected": reports(unconnected=({"uuid": "loose-pad"},)),
            "unwaived": reports(violation()),
        }
        for expected, report in cases.items():
            with self.subTest(expected=expected):
                result = classify_reports(report, {"schemaVersion": 1, "groups": []})
                self.assertEqual(result.status, INVALID)
                self.assertTrue(any(expected in message.lower() for message in result.messages), result.messages)

    def test_status_precedence_is_invalid_then_mechanical_then_pass(self):
        clean = reports()
        no_waivers = {"schemaVersion": 1, "groups": []}
        self.assertEqual(classify_reports(clean, no_waivers).status, PASS)
        self.assertEqual(
            classify_reports(clean, no_waivers, mechanical_findings=("connector moved",)).status,
            MECHANICAL_REVIEW_REQUIRED,
        )
        result = classify_reports(
            clean,
            no_waivers,
            inventory_errors=("native parity mismatch",),
            mechanical_findings=("connector moved",),
        )
        self.assertEqual(result.status, INVALID)

    def test_duplicate_stale_unknown_and_malformed_waivers_are_policy_errors(self):
        warning = violation()
        valid = waiver_for(warning)
        cases = {
            "duplicate": {**valid, "groups": valid["groups"] * 2},
            "stale": valid,
            "unknown scope": {
                **valid,
                "groups": [{**valid["groups"][0], "scope": "OTHER"}],
            },
            "bad digest": {
                **valid,
                "groups": [{**valid["groups"][0], "fingerprintDigest": "nope"}],
            },
            "empty rationale": {
                **valid,
                "groups": [{**valid["groups"][0], "rationale": ""}],
            },
            "bad count": {
                **valid,
                "groups": [{**valid["groups"][0], "count": -1}],
            },
        }
        for expected, waivers in cases.items():
            with self.subTest(expected=expected):
                result = classify_reports(reports(), waivers)
                self.assertEqual(result.status, INVALID)
                self.assertTrue(any(expected in message.lower() for message in result.messages), result.messages)

    def test_matching_but_unapproved_scope_type_group_is_still_unknown(self):
        invented = violation(kind="invented_warning")
        result = classify_reports(reports(invented), waiver_for(invented))
        self.assertEqual(result.status, INVALID)
        self.assertTrue(any("unknown waiver group" in message.lower() for message in result.messages), result.messages)

    def test_load_waivers_rejects_duplicate_json_keys_and_wrong_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "waivers.json"
            path.write_text('{"schemaVersion":1,"schemaVersion":1,"groups":[]}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
                load_waivers(path)
            path.write_text('{"schemaVersion":2,"groups":[]}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "schemaVersion"):
                load_waivers(path)

    def test_checked_in_policy_has_exact_approved_group_counts_and_digests(self):
        policy = load_waivers(VALIDATION_WAIVERS)
        actual = {
            (group["scope"], group["type"]): (
                group["count"],
                group["fingerprintDigest"],
            )
            for group in policy["groups"]
        }
        self.assertEqual(actual, {
            ("ERC", "endpoint_off_grid"): (71, "9cb699ba1827fa447483e85c111b392f22e217ca02e4866e408ed0872bb57384"),
            ("ERC", "lib_symbol_issues"): (19, "078197b8ae3f4753b71a8329cec228bc7b895e147329d8cbde9b347336490eb9"),
            ("DRC", "via_dangling"): (2, "27b20d9750762cbf26cbf4343b6f0bc3542faea666c8c26b8b3f107ddc67ff95"),
            ("DRC", "silk_edge_clearance"): (163, "2ab9120f0ff908b419033b6765ce4be49f0634795c1d20c4b61a36592c196d39"),
            ("DRC", "silk_overlap"): (199, "bb8c204cb57e95e9230625dde888cc15f56afeaffbd4a15894e77b240c431e9d"),
            ("DRC", "silk_over_copper"): (21, "1ef1749815a28e02b61e4e3650689beae9ee9101c66bec3acd61d6f30521de32"),
            ("DRC", "nonmirrored_text_on_back_layer"): (4, "d54988b0fd8a967b1c1526fbae6d064316605bca07fe8ccfbc072ef2938421b3"),
            ("parity", "footprint_symbol_mismatch"): (32, "9c0f14314f30187bc131e9a9d693cb40e81b98f2d19ff38b9164f49a08187e23"),
            ("parity", "net_conflict"): (90, "f0cd0a9a2d6da3052181b7f0e848d6be7a3a1a02d775cf27413a65effdfdc527"),
            ("parity", "footprint_symbol_field_mismatch"): (3, "2f617d41d767197016f3ea21e1afe06954dab08d4ff677feec0ca23a9d2483b6"),
        })
        self.assertTrue(all(group["rationale"].strip() for group in policy["groups"]))


class ValidationResultTest(unittest.TestCase):
    def test_result_is_recursively_immutable_and_renders_deterministically(self):
        source = {"ERC": {"violations": [{"items": [{"uuid": "x"}]}]}}
        result = ValidationResult(PASS, ("first", "second"), source, None)
        source["ERC"]["violations"][0]["items"][0]["uuid"] = "mutated"
        self.assertEqual(result.render_text(), "PASS\n- first\n- second")
        self.assertEqual(result.reports["ERC"]["violations"][0]["items"][0]["uuid"], "x")
        with self.assertRaises(TypeError):
            result.reports["new"] = {}
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.status = INVALID


class RecordingRunner:
    def __init__(
        self,
        canonical,
        *,
        fail_on=None,
        timeout_on=None,
        malformed_on=None,
        version="10.0.4",
        mutate_canonical=False,
    ):
        self.canonical = canonical.resolve()
        self.fail_on = fail_on
        self.timeout_on = timeout_on
        self.malformed_on = malformed_on
        self.version = version
        self.mutate_canonical = mutate_canonical
        self.calls = []

    def __call__(self, command, **kwargs):
        command = tuple(str(part) for part in command)
        self.calls.append((command, kwargs))
        if command[-1] == "--version" or command[1:] == ("--version",):
            return subprocess.CompletedProcess(command, 0, self.version + "\n", "")
        operation = "netlist" if "netlist" in command else "erc" if "erc" in command else "drc"
        if self.timeout_on == operation:
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])
        for part in command:
            if part.endswith((".kicad_sch", ".kicad_pcb")):
                source = Path(part).resolve()
                self._assert_outside_canonical(source)
                self.assert_project_is_complete(source.parent)
        output = Path(command[command.index("--output") + 1])
        self._assert_outside_canonical(output.resolve())
        if self.mutate_canonical and operation == "erc":
            board = self.canonical / "pocket_card_controller.kicad_pcb"
            board.write_text(board.read_text(encoding="utf-8") + "\n", encoding="utf-8")
        if self.fail_on == operation:
            return subprocess.CompletedProcess(command, 7, "", f"{operation} exploded")
        if operation == "erc":
            output.write_text(json.dumps({
                "$schema": "https://schemas.kicad.org/erc.v1.json",
                "coordinate_units": "mm",
                "kicad_version": "10.0.4",
                "sheets": [{"path": "/", "uuid_path": "/root", "violations": []}],
            }), encoding="utf-8")
        elif operation == "drc":
            report = {
                "$schema": "https://schemas.kicad.org/drc.v1.json",
                "coordinate_units": "mm",
                "kicad_version": "10.0.4",
                "violations": [],
                "schematic_parity": [],
                "unconnected_items": [],
            }
            if self.malformed_on == "drc":
                del report["unconnected_items"]
            output.write_text(json.dumps(report), encoding="utf-8")
        else:
            output.write_text("(export (components) (nets))", encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, "", "")

    def _assert_outside_canonical(self, path):
        with self.assertRaises(ValueError):
            path.relative_to(self.canonical)

    def assert_project_is_complete(self, directory):
        for suffix in (".kicad_pro", ".kicad_sch", ".kicad_pcb"):
            if not (directory / f"pocket_card_controller{suffix}").is_file():
                raise AssertionError(f"temporary project missing {suffix}")

    def assert_runner_contract(self):
        for command, kwargs in self.calls:
            self.assertNotIn("--save-board", command)
            self.assertEqual(kwargs["env"]["LANG"], "C")
            self.assertEqual(kwargs["env"]["LC_ALL"], "C")
            self.assertGreater(kwargs["timeout"], 0)

    # unittest-style helpers keep call-site failures readable.
    def assertRaises(self, *args, **kwargs):
        return unittest.TestCase().assertRaises(*args, **kwargs)

    def assertNotIn(self, *args, **kwargs):
        return unittest.TestCase().assertNotIn(*args, **kwargs)

    def assertEqual(self, *args, **kwargs):
        return unittest.TestCase().assertEqual(*args, **kwargs)

    def assertGreater(self, *args, **kwargs):
        return unittest.TestCase().assertGreater(*args, **kwargs)


class ValidateProjectTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name) / "electronics"
        self.project.mkdir()
        (self.project / "toolchain.json").write_text(json.dumps({
            "schemaVersion": 1,
            "project": "pocket_card_controller",
            "kicad": {"major": 10, "minimum": "10.0.4"},
        }), encoding="utf-8")
        (self.project / "validation_waivers.json").write_text(
            '{"schemaVersion":1,"groups":[]}', encoding="utf-8"
        )
        (self.project / "mechanical_contract.json").write_text("{}", encoding="utf-8")
        (self.project / "pocket_card_controller.kicad_pro").write_text("{}", encoding="utf-8")
        (self.project / "pocket_card_controller.kicad_sch").write_text("(kicad_sch)", encoding="utf-8")
        (self.project / "pocket_card_controller.kicad_pcb").write_text(
            "(kicad_pcb (general (thickness 1.6)))", encoding="utf-8"
        )

    def run_validation(self, runner, output_dir=None):
        with mock.patch(
            "hardware.pocket_card.electronics_pipeline.validation.load_contract",
            return_value=object(),
        ), mock.patch(
            "hardware.pocket_card.electronics_pipeline.validation.check_contract_against_case_params",
            return_value=(),
        ), mock.patch(
            "hardware.pocket_card.electronics_pipeline.validation.check_mechanics",
            return_value=(),
        ):
            return validate_project(self.project, output_dir=output_dir, runner=runner)

    def test_validation_uses_complete_copy_preserves_digest_and_publishes_reports(self):
        before = project_digest(self.project)
        output_dir = Path(self.temporary.name) / "reports"
        runner = RecordingRunner(self.project)
        result = self.run_validation(runner, output_dir)
        self.assertEqual(result.status, PASS)
        self.assertEqual(project_digest(self.project), before)
        runner.assert_runner_contract()
        self.assertEqual(len(runner.calls), 4)
        self.assertTrue((output_dir / "erc.json").is_file())
        self.assertTrue((output_dir / "drc.json").is_file())
        self.assertTrue((output_dir / "validation.json").is_file())

    def test_command_failure_and_timeout_are_bounded_invalid_results(self):
        before = project_digest(self.project)
        for label, runner in {
            "failure": RecordingRunner(self.project, fail_on="erc"),
            "timeout": RecordingRunner(self.project, timeout_on="drc"),
        }.items():
            with self.subTest(label=label):
                result = self.run_validation(runner)
                self.assertEqual(result.status, INVALID)
                self.assertTrue(any(label in message.lower() or "timed out" in message.lower() for message in result.messages))
                self.assertEqual(project_digest(self.project), before)

    def test_output_directory_must_not_be_inside_editable_source(self):
        runner = RecordingRunner(self.project)
        result = self.run_validation(runner, self.project / "derived")
        self.assertEqual(result.status, INVALID)
        self.assertTrue(any("output" in message.lower() and "project" in message.lower() for message in result.messages))
        self.assertEqual(runner.calls, [])

    def test_missing_report_fields_and_wrong_tool_major_are_invalid(self):
        cases = {
            "missing": RecordingRunner(self.project, malformed_on="drc"),
            "major": RecordingRunner(self.project, version="11.0.0"),
        }
        for expected, runner in cases.items():
            with self.subTest(expected=expected):
                result = self.run_validation(runner)
                self.assertEqual(result.status, INVALID)
                self.assertTrue(any(expected in message.lower() or "kicad 10" in message.lower() for message in result.messages), result.messages)

    def test_canonical_mutation_wins_over_command_failure(self):
        runner = RecordingRunner(
            self.project,
            fail_on="erc",
            mutate_canonical=True,
        )
        result = self.run_validation(runner)
        self.assertEqual(result.status, INVALID)
        self.assertTrue(any("mutation detected" in message.lower() for message in result.messages), result.messages)

    def test_cli_exit_codes_follow_status(self):
        for status, expected in ((PASS, 0), (INVALID, 1), (MECHANICAL_REVIEW_REQUIRED, 2)):
            with self.subTest(status=status), mock.patch(
                "hardware.pocket_card.electronics_pipeline.validation.validate_project",
                return_value=ValidationResult(status, (), {}, None),
            ), mock.patch("builtins.print"):
                self.assertEqual(main(["--project-dir", str(self.project)]), expected)


if __name__ == "__main__":
    unittest.main()
