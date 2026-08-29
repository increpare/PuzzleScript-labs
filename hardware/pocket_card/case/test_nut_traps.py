import importlib
import math
import os
import struct
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

import cadquery as cq
import numpy as np


HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import params as P  # noqa: E402
import checks  # noqa: E402
import joints  # noqa: E402
import nut_traps  # noqa: E402
import place_preview  # noqa: E402
import shell_front  # noqa: E402


class NutTrapCouponApiTest(unittest.TestCase):
    def test_coupon_module_exposes_the_stable_variant_order(self):
        coupon_module = importlib.import_module("nut_trap_coupon")
        self.assertEqual(coupon_module.VARIANTS, (4.3, 4.4, 4.5))

    def test_coupon_is_one_valid_positive_volume_negative_z_solid(self):
        coupon_module = importlib.import_module("nut_trap_coupon")
        model = coupon_module.build()
        self.assertIsInstance(model, cq.Workplane)
        solids = model.solids().vals()
        self.assertEqual(len(solids), 1)
        self.assertTrue(solids[0].isValid())
        self.assertGreater(solids[0].Volume(), 0.0)
        bounds = model.val().BoundingBox()
        self.assertGreater(bounds.xlen, 30.0)
        self.assertGreater(bounds.ylen, 12.0)
        self.assertAlmostEqual(bounds.zlen, 4.3, delta=1e-6)
        self.assertAlmostEqual(bounds.zmax, 0.0, delta=1e-6)
        self.assertAlmostEqual(bounds.zmin, -4.3, delta=1e-6)

    def test_coupon_stations_are_left_to_right_on_thirteen_mm_pitch(self):
        coupon_module = importlib.import_module("nut_trap_coupon")
        stations = coupon_module.sites()
        self.assertEqual([site.x for site in stations], [-13.0, 0.0, 13.0])
        self.assertEqual([site.y for site in stations], [3.6, 3.6, 3.6])
        self.assertEqual([site.mouth for site in stations], [(0, -1)] * 3)
        self.assertEqual(
            list(zip([site.x for site in stations], coupon_module.VARIANTS)),
            [(-13.0, 4.3), (0.0, 4.4), (13.0, 4.5)],
        )

    def test_coupon_functional_regions_match_exact_production_voids(self):
        coupon_module = importlib.import_module("nut_trap_coupon")
        blank = (
            cq.Workplane("XY")
            .box(39.0, 17.0, 4.3, centered=(True, False, False))
            .translate((0.0, 0.0, -4.3))
        )
        expected = blank
        for site, across_flats in zip(
            coupon_module.sites(), (4.3, 4.4, 4.5)
        ):
            production_void = nut_traps.front_voids(site, across_flats).union(
                nut_traps.insertion_sweep(site, 4.0)
            )
            expected = expected.cut(production_void)

        functional_region = (
            cq.Workplane("XY")
            .box(39.0, 8.0, 4.3, centered=(True, False, False))
            .translate((0.0, 0.0, -4.3))
        )
        actual = coupon_module.build().intersect(functional_region)
        expected = expected.intersect(functional_region)
        symmetric_difference = shape_volume(actual.cut(expected)) + shape_volume(
            expected.cut(actual)
        )
        self.assertLess(symmetric_difference, 1e-5)

    def assert_nominal_nut_insertion_clear(self, model):
        coupon_module = importlib.import_module("nut_trap_coupon")
        coupon_bounds = model.val().BoundingBox()
        for site in coupon_module.sites():
            outside_x, outside_y = nut_traps.insertion_offsets(site, 4.0)[0]
            outside_nut = nut_traps.nut_solid(site, 4.0).translate(
                (outside_x, outside_y, 0.0)
            )
            self.assertLess(
                outside_nut.val().BoundingBox().ymax,
                coupon_bounds.ymin,
            )
            self.assertLess(shape_volume(model.intersect(outside_nut)), 1e-5)
            self.assertLess(
                shape_volume(
                    model.intersect(nut_traps.insertion_sweep(site, 4.0))
                ),
                1e-5,
            )

    def test_nominal_nut_translates_from_outside_edge_to_every_seat(self):
        coupon_module = importlib.import_module("nut_trap_coupon")
        self.assert_nominal_nut_insertion_clear(coupon_module.build())

    def test_insertion_check_rejects_sealed_and_narrow_edge_mouths(self):
        coupon_module = importlib.import_module("nut_trap_coupon")
        model = coupon_module.build()
        site = coupon_module.sites()[1]
        sealed_mouth = (
            cq.Workplane("XY")
            .box(5.0, 0.6, 1.6, centered=(True, False, False))
            .translate((site.x, -0.1, -3.1))
        )
        with self.assertRaises(AssertionError):
            self.assert_nominal_nut_insertion_clear(model.union(sealed_mouth))

        narrow_mouth = cq.Workplane("XY")
        for x in (-2.1, 2.1):
            cheek = (
                cq.Workplane("XY")
                .box(0.4, 0.6, 1.6, centered=(True, False, False))
                .translate((site.x + x, -0.1, -3.1))
            )
            narrow_mouth = narrow_mouth.union(cheek)
        with self.assertRaises(AssertionError):
            self.assert_nominal_nut_insertion_clear(model.union(narrow_mouth))

    def test_measured_cavity_taper_bore_and_skin_planes_match_production(self):
        coupon_module = importlib.import_module("nut_trap_coupon")
        model = coupon_module.build()
        removed = coupon_module.blank().cut(model)
        dz = 0.01

        for site, requested_af in zip(
            coupon_module.sites(), (4.3, 4.4, 4.5)
        ):
            positive_half = (
                cq.Workplane("XY")
                .box(8.0, 4.0, dz, centered=(True, False, False))
                .translate((site.x, site.y, -3.205))
            )
            cavity_area = (
                2.0 * shape_volume(removed.intersect(positive_half)) / dz
            )
            measured_cavity_af = math.sqrt(
                2.0 * cavity_area / math.sqrt(3.0)
            )
            self.assertAlmostEqual(measured_cavity_af, requested_af, delta=0.01)

            taper_slice = (
                cq.Workplane("XY")
                .box(8.0, 8.0, dz, centered=(True, True, False))
                .translate((site.x, site.y, -3.555))
            )
            taper_area = shape_volume(removed.intersect(taper_slice)) / dz
            measured_taper_af = math.sqrt(
                2.0 * taper_area / math.sqrt(3.0)
            )
            self.assertAlmostEqual(
                measured_taper_af, requested_af - 0.5, delta=0.01
            )

            roof_slice = (
                cq.Workplane("XY")
                .box(8.0, 8.0, dz, centered=(True, True, False))
                .translate((site.x, site.y, -4.055))
            )
            bore_area = shape_volume(removed.intersect(roof_slice)) / dz
            measured_bore_d = 2.0 * math.sqrt(bore_area / math.pi)
            self.assertAlmostEqual(measured_bore_d, 2.4, delta=0.01)

            front_skin = (
                cq.Workplane("XY")
                .circle(1.0)
                .extrude(0.89)
                .translate((site.x, site.y, -0.89))
            )
            self.assertLess(shape_volume(removed.intersect(front_skin)), 1e-7)

    def test_af_labels_are_engraved_only_in_the_nonfunctional_rear_strip(self):
        coupon_module = importlib.import_module("nut_trap_coupon")
        self.assertEqual(coupon_module.LABELS, ("4.3", "4.4", "4.5"))
        labels = coupon_module.label_voids()
        self.assertGreater(shape_volume(labels), 0.5)
        bounds = labels.val().BoundingBox()
        self.assertGreater(bounds.ymin, 10.0)
        self.assertGreaterEqual(bounds.zmin, -0.3)
        self.assertLessEqual(bounds.zmax, 1e-6)

        functional = cq.Workplane("XY")
        for site, across_flats in zip(
            coupon_module.sites(), (4.3, 4.4, 4.5)
        ):
            cage = (
                cq.Workplane("XY")
                .circle(3.6)
                .extrude(4.3)
                .translate((site.x, site.y, -4.3))
            )
            functional = functional.union(cage).union(
                nut_traps.insertion_sweep(site, 4.0)
            )
        self.assertLess(shape_volume(labels.intersect(functional)), 1e-7)

        unlabelled = coupon_module.blank()
        for site, across_flats in zip(
            coupon_module.sites(), (4.3, 4.4, 4.5)
        ):
            unlabelled = unlabelled.cut(
                coupon_module.station_void(site, across_flats)
            )
        engraved_volume = shape_volume(unlabelled.cut(coupon_module.build()))
        self.assertGreater(engraved_volume, 0.5)

    def test_coupon_preserves_full_backbone_and_separating_webs(self):
        coupon_module = importlib.import_module("nut_trap_coupon")
        model = coupon_module.build()
        backbone = (
            cq.Workplane("XY")
            .box(39.0, 2.0, 4.3, centered=(True, False, False))
            .translate((0.0, 8.0, -4.3))
        )
        self.assertAlmostEqual(
            shape_volume(model.intersect(backbone)), 39.0 * 2.0 * 4.3, places=5
        )
        for x in (-6.5, 6.5):
            web = (
                cq.Workplane("XY")
                .box(2.0, 8.0, 4.3, centered=(True, False, False))
                .translate((x, 0.0, -4.3))
            )
            self.assertAlmostEqual(
                shape_volume(model.intersect(web)), 2.0 * 8.0 * 4.3, places=5
            )

    def test_export_round_trips_as_one_step_solid_and_connected_stl(self):
        coupon_module = importlib.import_module("nut_trap_coupon")
        with tempfile.TemporaryDirectory() as tmp:
            written = coupon_module.export(tmp)
            expected = (
                Path(tmp, "nut_trap_coupon.stl"),
                Path(tmp, "nut_trap_coupon.step"),
            )
            self.assertEqual(written, expected)
            for path in written:
                self.assertTrue(path.is_file())
                self.assertGreater(path.stat().st_size, 100)

            imported = cq.importers.importStep(str(expected[1]))
            solids = imported.solids().vals()
            self.assertEqual(len(solids), 1)
            self.assertTrue(solids[0].isValid())
            bounds = solids[0].BoundingBox()
            self.assertAlmostEqual(bounds.xlen, 39.0, delta=1e-5)
            self.assertAlmostEqual(bounds.ylen, 17.0, delta=1e-5)
            self.assertAlmostEqual(bounds.zlen, 4.3, delta=1e-5)

            data = expected[0].read_bytes()
            triangle_count = struct.unpack("<I", data[80:84])[0]
            triangles = np.array(
                [
                    struct.unpack_from("<12f", data, 84 + index * 50)[3:12]
                    for index in range(triangle_count)
                ]
            ).reshape(triangle_count, 3, 3)
            vertices = triangles.reshape(-1, 3)
            _, inverse = np.unique(
                np.round(vertices, decimals=5), axis=0, return_inverse=True
            )
            faces = inverse.reshape(-1, 3)
            edge_faces = {}
            for face_index, face in enumerate(faces):
                for edge in (
                    tuple(sorted((face[0], face[1]))),
                    tuple(sorted((face[1], face[2]))),
                    tuple(sorted((face[2], face[0]))),
                ):
                    edge_faces.setdefault(edge, []).append(face_index)
            self.assertTrue(all(len(shared) == 2 for shared in edge_faces.values()))
            neighbours = [set() for _ in faces]
            for first, second in edge_faces.values():
                neighbours[first].add(second)
                neighbours[second].add(first)
            reached = {0}
            frontier = [0]
            while frontier:
                for neighbour in neighbours[frontier.pop()]:
                    if neighbour not in reached:
                        reached.add(neighbour)
                        frontier.append(neighbour)
            self.assertEqual(len(reached), len(faces))

    def assert_same_step_geometry(self, first_path, second_path):
        first = cq.importers.importStep(str(first_path))
        second = cq.importers.importStep(str(second_path))
        first_solids = first.solids().vals()
        second_solids = second.solids().vals()
        self.assertEqual(len(first_solids), 1)
        self.assertEqual(len(second_solids), 1)
        self.assertTrue(first_solids[0].isValid())
        self.assertTrue(second_solids[0].isValid())

        first_bounds = first_solids[0].BoundingBox()
        second_bounds = second_solids[0].BoundingBox()
        for first_value, second_value in zip(
            (first_bounds.xlen, first_bounds.ylen, first_bounds.zlen),
            (second_bounds.xlen, second_bounds.ylen, second_bounds.zlen),
        ):
            self.assertAlmostEqual(first_value, second_value, delta=1e-6)

        first_volume = shape_volume(first)
        second_volume = shape_volume(second)
        intersection_volume = shape_volume(first.intersect(second))
        symmetric_difference = shape_volume(first.cut(second)) + shape_volume(
            second.cut(first)
        )
        self.assertAlmostEqual(first_volume, second_volume, delta=1e-5)
        self.assertAlmostEqual(intersection_volume, first_volume, delta=1e-5)
        self.assertLess(symmetric_difference, 1e-5)

    def test_tracked_coupon_exports_match_fresh_geometry(self):
        coupon_module = importlib.import_module("nut_trap_coupon")
        tracked = Path(HERE, "out", "order")
        with tempfile.TemporaryDirectory() as tmp:
            fresh_stl, fresh_step = coupon_module.export(tmp)
            self.assertEqual(
                fresh_stl.read_bytes(),
                Path(tracked, "nut_trap_coupon.stl").read_bytes(),
            )
            self.assert_same_step_geometry(
                fresh_step,
                Path(tracked, "nut_trap_coupon.step"),
            )

    def test_artifact_freshness_check_rejects_stale_coupon_geometry(self):
        coupon_module = importlib.import_module("nut_trap_coupon")
        tracked = Path(HERE, "out", "order")
        with tempfile.TemporaryDirectory() as tmp:
            fresh_stl, _fresh_step = coupon_module.export(tmp)
            stale_model = coupon_module.blank()
            stale_stl = Path(tmp, "stale_coupon.stl")
            stale_step = Path(tmp, "stale_coupon.step")
            cq.exporters.export(stale_model, str(stale_stl))
            cq.exporters.export(stale_model, str(stale_step))

            with self.assertRaises(AssertionError):
                self.assertEqual(fresh_stl.read_bytes(), stale_stl.read_bytes())
            with self.assertRaises(AssertionError):
                self.assert_same_step_geometry(
                    Path(tracked, "nut_trap_coupon.step"), stale_step
                )

    def test_generated_step_files_disable_whitespace_diagnostics(self):
        attributes = Path(HERE, "..", "..", "..", ".gitattributes")
        lines = attributes.resolve().read_text(encoding="utf-8").splitlines()
        self.assertIn(
            "hardware/pocket_card/case/out/*.step -whitespace",
            lines,
        )
        self.assertIn(
            "hardware/pocket_card/case/out/order/*.step -whitespace",
            lines,
        )
        self.assertIn(
            "hardware/pocket_card/case/out/order/preview/*.step -whitespace",
            lines,
        )
        self.assertIn(
            "hardware/pocket_card/case/out/pcb/*.step -whitespace",
            lines,
        )

    def test_readme_has_only_the_current_captive_nut_closure_instructions(self):
        readme = Path(HERE, "README.md").read_text(encoding="utf-8")
        lowered = readme.lower()
        self.assertNotIn("pan-head self-tapper", lowered)
        self.assertNotIn("pan self-tap", lowered)
        self.assertNotIn("front-shell pilot", lowered)
        self.assertNotIn("(66, 84)", readme)
        self.assertIn("3 | M2×10 pan-head machine screw", readme)
        self.assertIn("3 | M2×12 pan-head machine screw", readme)
        self.assertIn("6 | DIN 934 M2 captive nut", readme)
        self.assertIn("(64.5, 84)", readme)
        self.assertIn("profile-aware rear seat", readme)
        self.assertIn("fit coupon", lowered)
        self.assertIn("hand-start", lowered)
        self.assertIn("anti-rattle", lowered)
        self.assertIn("must not be structural", lowered)

    def test_order_builder_exports_coupon_after_shells_without_cap_variant_count(self):
        build_module = importlib.import_module("build_variants")
        preview_module = importlib.import_module("place_preview")
        events = []
        front_shape = mock.MagicMock(name="front")
        back_shape = mock.MagicMock(name="back")
        coupon_shape = mock.MagicMock(name="coupon")
        other_shape = mock.MagicMock(name="other")
        other_shape.union.return_value = other_shape

        def build_shells():
            events.append("shells")
            return front_shape, back_shape

        def export_coupon(output_dir, model=None):
            events.append("coupon")
            self.assertEqual(Path(output_dir), Path(build_module.OUT))
            self.assertIs(model, coupon_shape)
            return (
                Path(output_dir, "nut_trap_coupon.stl"),
                Path(output_dir, "nut_trap_coupon.step"),
            )

        def cap_set(*_args):
            events.append("caps")
            return other_shape

        def volume(shape):
            if shape is front_shape:
                return 1.0
            if shape is back_shape:
                return 2.0
            if shape is coupon_shape:
                return 3.25
            return 4.0

        output = StringIO()
        with mock.patch.object(
            build_module, "build_shells", side_effect=build_shells
        ), mock.patch.object(
            build_module.nut_trap_coupon,
            "export",
            side_effect=export_coupon,
        ), mock.patch.object(
            build_module.nut_trap_coupon, "build", return_value=coupon_shape
        ) as build_coupon, mock.patch.object(
            build_module.slide_tip, "tip_solid", return_value=other_shape
        ), mock.patch.object(
            build_module, "cap_set", side_effect=cap_set
        ), mock.patch.object(
            build_module, "vol", side_effect=volume
        ) as measure_volume, mock.patch.object(
            build_module.cq.exporters, "export"
        ), mock.patch.object(preview_module, "main"), redirect_stdout(output):
            build_module.main()

        self.assertEqual(events[:2], ["shells", "coupon"])
        self.assertEqual(events.count("caps"), 4)
        build_coupon.assert_called_once_with()
        self.assertEqual(
            sum(call.args == (coupon_shape,) for call in measure_volume.call_args_list),
            1,
        )
        manifest = output.getvalue()
        self.assertIn("nut_trap_coupon.stl", manifest)
        self.assertIn("3.25 cm3", manifest)
        self.assertIn("8 fab files + preview/ overlays", manifest)


class NutTrapDefinitionTest(unittest.TestCase):
    def test_six_sites_have_approved_axes_and_loading_directions(self):
        self.assertEqual(
            [(s.x, s.y, s.kind, s.mouth) for s in nut_traps.sites()],
            [
                (6.0, 6.5, "module", (1, 1)),
                (6.0, 48.5, "module", (1, -1)),
                (84.0, 6.5, "module", (-1, 1)),
                (84.0, 48.5, "module", (-1, -1)),
                (64.5, 56.0, "pcb", (-1, 0)),
                (64.5, 84.0, "pcb", (0, -1)),
            ],
        )

    def test_sites_are_derived_from_case_parameters(self):
        expected_module = (
            (P.MOD_X + P.MOUNT_INSET, P.MOD_Y + P.MOUNT_INSET),
            (P.MOD_X + P.MOUNT_INSET, P.MOD_Y + P.MOD_H - P.MOUNT_INSET),
            (P.MOD_X + P.MOD_W - P.MOUNT_INSET, P.MOD_Y + P.MOUNT_INSET),
            (
                P.MOD_X + P.MOD_W - P.MOUNT_INSET,
                P.MOD_Y + P.MOD_H - P.MOUNT_INSET,
            ),
        )
        sites = nut_traps.sites()
        self.assertEqual(tuple((s.x, s.y) for s in sites[:4]), expected_module)
        self.assertEqual(tuple((s.x, s.y) for s in sites[4:]), P.PCB_MOUNTS)

    def test_maximum_coupon_cavity_fits_the_conservative_envelope(self):
        largest_coupon_af = max(P.NUT_AF_VARIANTS)
        self.assertAlmostEqual(
            nut_traps.cage_radius(largest_coupon_af),
            largest_coupon_af / math.sqrt(3.0) + P.NUT_WALL,
        )
        self.assertLessEqual(
            nut_traps.cage_radius(largest_coupon_af),
            P.NUT_ENVELOPE_R,
        )

    def test_roof_transition_is_a_half_mm_forty_five_degree_chamfer(self):
        self.assertEqual(getattr(P, "NUT_ROOF_TAPER", None), 0.5)

    def test_kernel_safe_across_flats_minimum_is_documented(self):
        self.assertEqual(getattr(P, "NUT_KERNEL_MIN_AF", None), 0.0001)

    def test_hex_corner_diameter_matches_across_flats(self):
        self.assertAlmostEqual(
            nut_traps.hex_corner_diameter(4.4), 2.0 * 4.4 / math.sqrt(3.0)
        )

    def test_controller_axial_stack_preserves_board_gap(self):
        used = P.NUT_CAVITY_T + P.NUT_ROOF_T
        available = P.PCB_FRONT_Z - P.FACE_T
        self.assertAlmostEqual(used, 2.8)
        self.assertAlmostEqual(available - used, 0.2)

    def test_site_planes_follow_the_front_face_and_axial_stack(self):
        for site in nut_traps.sites():
            with self.subTest(site=site):
                self.assertAlmostEqual(site.nut_front_z, -P.FACE_T)
                self.assertAlmostEqual(
                    site.cavity_back_z, -P.FACE_T - P.NUT_CAVITY_T
                )
                self.assertAlmostEqual(
                    site.roof_back_z,
                    -P.FACE_T - P.NUT_CAVITY_T - P.NUT_ROOF_T,
                )

    def test_preview_fasteners_have_stable_alternating_names_and_valid_solids(self):
        fasteners = nut_traps.preview_fasteners()
        self.assertEqual(
            tuple(name for name, _shape in fasteners),
            tuple(
                name
                for index in range(1, 7)
                for name in (f"nut_{index}", f"screw_{index}")
            ),
        )
        self.assertEqual(len(fasteners), 12)
        for name, shape in fasteners:
            with self.subTest(name=name):
                solids = shape.solids().vals()
                self.assertEqual(len(solids), 1)
                self.assertTrue(solids[0].isValid())
                self.assertGreater(solids[0].Volume(), 0.0)

    def test_preview_nuts_are_bored_din934_m2_solids_seated_in_cavity_direction(self):
        fasteners = dict(nut_traps.preview_fasteners())
        for index, site in enumerate(nut_traps.sites(), 1):
            nut = fasteners[f"nut_{index}"]
            bounds = nut.val().BoundingBox()
            mouth_length = math.hypot(*site.mouth)
            across_flat_axis = (
                -site.mouth[1] / mouth_length,
                site.mouth[0] / mouth_length,
            )
            projections = [
                vertex.X * across_flat_axis[0]
                + vertex.Y * across_flat_axis[1]
                for vertex in nut.val().Vertices()
            ]
            unbored = nut_traps.nut_solid(site)
            visual_thread = unbored.cut(nut)
            thread_bounds = visual_thread.val().BoundingBox()
            with self.subTest(site=index):
                self.assertAlmostEqual(
                    max(projections) - min(projections),
                    P.NUT_NOMINAL_AF,
                    delta=1e-6,
                )
                self.assertAlmostEqual(bounds.zmax, site.nut_front_z, delta=1e-6)
                self.assertAlmostEqual(bounds.zmin, site.nut_front_z - P.NUT_MAX_T, delta=1e-6)
                self.assertAlmostEqual(bounds.zlen, P.NUT_MAX_T, delta=1e-6)
                self.assertAlmostEqual(
                    (bounds.xmin + bounds.xmax) / 2.0, site.x, delta=1e-6
                )
                self.assertAlmostEqual(
                    (bounds.ymin + bounds.ymax) / 2.0, site.y, delta=1e-6
                )
                self.assertAlmostEqual(
                    thread_bounds.xlen, nut_traps.PREVIEW_NUT_THREAD_D, delta=1e-6
                )
                self.assertAlmostEqual(
                    thread_bounds.ylen, nut_traps.PREVIEW_NUT_THREAD_D, delta=1e-6
                )

    def test_preview_screws_match_selected_pan_head_and_under_head_stack(self):
        fasteners = dict(nut_traps.preview_fasteners())
        for index, (site, selection) in enumerate(
            zip(nut_traps.sites(), joints.selected_screws()), 1
        ):
            screw = fasteners[f"screw_{index}"]
            bounds = screw.val().BoundingBox()
            shaft_mid = selection.seat_z + selection.length / 2.0
            shaft = screw.intersect(thin_slab(shaft_mid - 0.05, shaft_mid + 0.05))
            shaft_bounds = shaft.val().BoundingBox()
            head_mid = selection.seat_z - nut_traps.PREVIEW_SCREW_HEAD_H / 2.0
            head = screw.intersect(thin_slab(head_mid - 0.05, head_mid + 0.05))
            head_bounds = head.val().BoundingBox()
            with self.subTest(site=index):
                self.assertEqual((selection.x, selection.y), (site.x, site.y))
                self.assertAlmostEqual(shaft_bounds.xlen, 2.0, delta=1e-6)
                self.assertAlmostEqual(shaft_bounds.ylen, 2.0, delta=1e-6)
                self.assertAlmostEqual(head_bounds.xlen, joints.HEAD_D, delta=1e-6)
                self.assertAlmostEqual(head_bounds.ylen, joints.HEAD_D, delta=1e-6)
                self.assertAlmostEqual(bounds.zmin, selection.seat_z - 1.5, delta=1e-6)
                self.assertAlmostEqual(bounds.zmax, selection.seat_z + selection.length, delta=1e-6)
                self.assertAlmostEqual(
                    bounds.zmax - site.nut_front_z,
                    selection.tip_protrusion,
                    delta=1e-6,
                )
                self.assertGreaterEqual(selection.tip_protrusion, 0.2 - 1e-9)
                self.assertLessEqual(selection.tip_protrusion, 0.6 + 1e-9)

    def test_place_fasteners_exports_twelve_individual_solids_and_compound(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            preview = root / "preview"
            with mock.patch.object(place_preview, "ORDER", root), \
                    mock.patch.object(place_preview, "PREV", preview):
                placed = place_preview.place_fasteners()

            self.assertEqual(len(placed), 12)
            expected_names = [name for name, _shape in nut_traps.preview_fasteners()]
            for name in expected_names:
                with self.subTest(name=name):
                    self.assertGreater((preview / f"{name}.stl").stat().st_size, 0)
                    step = preview / f"{name}.step"
                    self.assertGreater(step.stat().st_size, 0)
                    imported = cq.importers.importStep(str(step))
                    self.assertEqual(len(imported.solids().vals()), 1)
                    self.assertTrue(imported.val().isValid())

            compound = cq.importers.importStep(str(preview / "fasteners_placed.step"))
            self.assertEqual(len(compound.solids().vals()), 12)
            self.assertGreater((root / "fasteners_placed.step").stat().st_size, 0)

    def test_place_fasteners_applies_the_layout_to_model_transform_once(self):
        expected = dict(nut_traps.preview_fasteners())
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with mock.patch.object(place_preview, "ORDER", root), \
                    mock.patch.object(place_preview, "PREV", root / "preview"):
                placed = dict(place_preview.place_fasteners())

        for name, layout_shape in expected.items():
            layout_bounds = layout_shape.val().BoundingBox()
            model_bounds = placed[name].val().BoundingBox()
            with self.subTest(name=name):
                # OCC's reflected BREP records sub-micron edge tolerances; the
                # 0.002 mm bound remains far below any physical fit clearance.
                self.assertAlmostEqual(model_bounds.xmin, layout_bounds.xmin, delta=0.002)
                self.assertAlmostEqual(model_bounds.xmax, layout_bounds.xmax, delta=0.002)
                self.assertAlmostEqual(model_bounds.ymin, P.BODY_H - layout_bounds.ymax, delta=0.002)
                self.assertAlmostEqual(model_bounds.ymax, P.BODY_H - layout_bounds.ymin, delta=0.002)
                self.assertAlmostEqual(model_bounds.zmin, layout_bounds.zmin, delta=0.002)
                self.assertAlmostEqual(model_bounds.zmax, layout_bounds.zmax, delta=0.002)

    def test_assembly_step_adds_exactly_twelve_separable_fastener_solids(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with mock.patch.object(place_preview, "ORDER", root), \
                    mock.patch.object(place_preview, "PREV", root / "preview"), \
                    mock.patch.object(place_preview, "_require_exports"):
                place_preview.assemble()
            assembly = cq.importers.importStep(str(root / "assembly.step"))

        pcb_raw = cq.importers.importStep(
            str(place_preview.PCB_DIR / "pocket_card_controller.step")
        )
        expected_without_fasteners = (
            len(shell_front.build().solids().vals())
            + len(importlib.import_module("shell_back").build_back().solids().vals())
            + len(pcb_raw.solids().vals())
        )
        self.assertEqual(
            len(assembly.solids().vals()), expected_without_fasteners + 12
        )

    def test_invalid_site_and_dimensions_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "mouth"):
            nut_traps.NutTrapSite(0.0, 0.0, "module", (0, 0))
        with self.assertRaisesRegex(ValueError, "mouth"):
            nut_traps.NutTrapSite(0.0, 0.0, "module", (math.nan, 1))
        with self.assertRaisesRegex(ValueError, "mouth"):
            nut_traps.NutTrapSite(0.0, 0.0, "module", ("east", "north"))
        for function in (nut_traps.cage_radius, nut_traps.hex_corner_diameter):
            with self.subTest(function=function.__name__):
                with self.assertRaisesRegex(ValueError, "across_flats"):
                    function(0.0)
                with self.assertRaisesRegex(ValueError, "across_flats"):
                    function("wide")


def shape_volume(shape):
    return sum(solid.Volume() for solid in shape.solids().vals())


def thin_slab(z0, z1):
    return (
        cq.Workplane("XY")
        .box(300.0, 300.0, z1 - z0, centered=(True, True, False))
        .translate((45.0, 46.5, z0))
    )


def roof_hex_probe(site, across_flats, z0, z1):
    mouth_x, mouth_y = site.mouth
    angle = math.degrees(math.atan2(mouth_y, mouth_x))
    return (
        cq.Workplane("XY")
        .polygon(6, 2.0 * across_flats / math.sqrt(3.0))
        .extrude(z1 - z0)
        .translate((0.0, 0.0, z0))
        .rotate((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), angle)
        .translate((site.x, site.y, 0.0))
    )


def roof_cylinder_probe(site, diameter, z0, z1):
    return (
        cq.Workplane("XY")
        .circle(diameter / 2.0)
        .extrude(z1 - z0)
        .translate((site.x, site.y, z0))
    )


def equivalent_hex_af_at(voids, z):
    section_thickness = 0.01
    section = voids.intersect(
        thin_slab(z - section_thickness / 2.0, z + section_thickness / 2.0)
    )
    section_area = shape_volume(section) / section_thickness
    return math.sqrt(2.0 * section_area / math.sqrt(3.0))


class ControllerNutChuteContractTest(unittest.TestCase):
    """Rigid, PCB-capped staging chutes make H1/H2 genuinely captive."""

    @classmethod
    def setUpClass(cls):
        shell_back = importlib.import_module("shell_back")
        raw = cq.importers.importStep(
            str(place_preview.PCB_DIR / "pocket_card_controller.step")
        )
        controller = place_preview.kicad_pcb_to_model_space(raw)
        cls.controller = (
            controller.val() if hasattr(controller, "val") else controller
        )
        cls.controller_board = max(
            cls.controller.Solids(), key=lambda solid: solid.Volume()
        )
        cls.controller_outline = shell_back.pcb_outline_wire()

    def controller_sites(self):
        return nut_traps.sites()[4:]

    def test_required_rigid_chute_api_exists(self):
        for name in (
            "controller_chute_material",
            "controller_stage_nut",
            "controller_stage_opening",
            "controller_loading_sweep",
        ):
            with self.subTest(name=name):
                self.assertIsNotNone(
                    getattr(nut_traps, name, None), f"{name} API is missing"
                )

    def test_preassembly_drop_then_slide_path_is_clear_in_finished_front(self):
        finished = shell_front.to_model_space(shell_front.build())
        for site in self.controller_sites():
            loading = nut_traps.controller_loading_sweep(site)
            with self.subTest(site=site):
                self.assertLess(shape_volume(finished.intersect(loading)), 1e-5)

    def test_actual_controller_board_caps_every_complete_stage_opening(self):
        board = self.controller_board
        for site in self.controller_sites():
            opening = shell_front.to_model_space(
                nut_traps.controller_stage_opening(site)
            ).val()
            with self.subTest(site=site):
                self.assertGreater(sum(s.Volume() for s in opening.Solids()), 0.1)
                self.assertLess(
                    sum(s.Volume() for s in opening.cut(board).Solids()),
                    1e-5,
                )

    def test_chute_top_gap_to_actual_pcb_is_smaller_than_nut_thickness(self):
        for site in self.controller_sites():
            chute = nut_traps.controller_chute_material(site)
            gap = abs(-P.PCB_FRONT_Z - chute.val().BoundingBox().zmin)
            with self.subTest(site=site):
                self.assertGreaterEqual(gap, 0.15)
                self.assertLess(gap, P.NUT_MAX_T)

    def test_low_staged_nut_is_stopped_outward_and_at_both_side_rails(self):
        for site in self.controller_sites():
            chute = nut_traps.controller_chute_material(site)
            staged = nut_traps.controller_stage_nut(site)
            mouth_x, mouth_y = nut_traps._normalized_mouth(site)
            across_x, across_y = -mouth_y, mouth_x
            attempts = {
                "outward": (0.35 * mouth_x, 0.35 * mouth_y, 0.0),
                "side-positive": (0.35 * across_x, 0.35 * across_y, 0.0),
                "side-negative": (-0.35 * across_x, -0.35 * across_y, 0.0),
            }
            self.assertLess(shape_volume(chute.intersect(staged)), 1e-5)
            for name, offset in attempts.items():
                with self.subTest(site=site, escape=name):
                    self.assertGreater(
                        shape_volume(chute.intersect(staged.translate(offset))),
                        0.01,
                    )

    def test_chutes_clear_actual_components_and_all_moving_button_envelopes(self):
        moving_buttons = []
        for name, x, y, diameter in (
            ("Undo", P.UNDO_X, P.UNDO_Y, P.AB_CAP_D),
            ("Action", P.ACT_X, P.ACT_Y, P.AB_CAP_D),
            ("Reset", P.RESET_X, P.RESET_Y, P.RESET_CAP_D),
        ):
            flange_radius = diameter / 2.0 + P.CAP_FLANGE_OS
            travel = (
                cq.Workplane("XY")
                .circle(flange_radius)
                .extrude(-(P.FACE_T + P.COLLAR_DEPTH + P.CAP_PROUD))
                .translate((x, y, P.CAP_PROUD))
            )
            moving_buttons.append((name, travel))

        for site in self.controller_sites():
            chute = nut_traps.controller_chute_material(site)
            model_chute = shell_front.to_model_space(chute).val()
            with self.subTest(site=site, obstacle="actual PCB components"):
                self.assertLess(
                    sum(
                        solid.Volume()
                        for solid in model_chute.intersect(
                            self.controller
                        ).Solids()
                    ),
                    1e-5,
                )
            for name, travel in moving_buttons:
                with self.subTest(site=site, obstacle=name):
                    self.assertLess(shape_volume(chute.intersect(travel)), 1e-5)


def square_ledged_voids(site, across_flats=P.NUT_AF):
    cavity_front_z = site.nut_front_z + 0.1
    cavity = nut_traps._hex_prism(
        site,
        across_flats,
        cavity_front_z,
        cavity_front_z - site.cavity_back_z,
    )
    throat = nut_traps._mouth_prism(
        site,
        P.NUT_THROAT_W,
        site.cavity_back_z,
        cavity_front_z,
    )
    bore = nut_traps.screw_path(site, site.roof_back_z - 0.1)
    return cavity.union(throat).union(bore)


class NutTrapSolidTest(unittest.TestCase):
    def trajectory(self, site):
        helper = getattr(nut_traps, "insertion_offsets", None)
        self.assertIsNotNone(helper, "insertion_offsets API is missing")
        return helper(site)

    def test_insertion_offsets_run_from_wholly_outside_to_exactly_seated(self):
        for site in nut_traps.sites():
            offsets = self.trajectory(site)
            first_distance = math.hypot(*offsets[0])
            nut_corner_radius = (
                nut_traps.hex_corner_diameter(P.NUT_NOMINAL_AF) / 2.0
            )
            with self.subTest(site=site):
                self.assertGreater(
                    first_distance - nut_corner_radius,
                    P.NUT_ENVELOPE_R,
                )
                self.assertEqual(offsets[-1], (0.0, 0.0))
                self.assertEqual(
                    tuple(math.copysign(1.0, value) for value in offsets[-1]),
                    (1.0, 1.0),
                )

    def test_insertion_offset_distances_decrease_monotonically(self):
        for site in nut_traps.sites():
            distances = [
                math.hypot(offset_x, offset_y)
                for offset_x, offset_y in self.trajectory(site)
            ]
            with self.subTest(site=site):
                self.assertTrue(
                    all(
                        first > second
                        for first, second in zip(distances, distances[1:])
                    )
                )

    def test_insertion_offset_spacing_is_at_most_point_two_mm(self):
        for site in nut_traps.sites():
            offsets = self.trajectory(site)
            spacings = [
                math.dist(first, second)
                for first, second in zip(offsets, offsets[1:])
            ]
            with self.subTest(site=site):
                self.assertGreater(len(spacings), 1)
                self.assertTrue(
                    all(0.0 < spacing <= 0.20 for spacing in spacings)
                )

    def test_insertion_offsets_follow_each_normalized_mouth_direction(self):
        for site in nut_traps.sites():
            mouth_length = math.hypot(*site.mouth)
            expected_x = site.mouth[0] / mouth_length
            expected_y = site.mouth[1] / mouth_length
            offsets = self.trajectory(site)
            for offset_x, offset_y in offsets[:-1]:
                distance = math.hypot(offset_x, offset_y)
                with self.subTest(site=site, distance=distance):
                    self.assertAlmostEqual(offset_x / distance, expected_x)
                    self.assertAlmostEqual(offset_y / distance, expected_y)

    def test_exact_sweep_contains_intermediate_nuts_for_tiny_and_nominal_af(self):
        site = nut_traps.sites()[0]
        for across_flats in (0.05, P.NUT_NOMINAL_AF):
            sweep = nut_traps.insertion_sweep(site, across_flats)
            outside_x, outside_y = nut_traps.insertion_offsets(
                site, across_flats
            )[0]
            for fraction in (0.137, 0.503, 0.881):
                translated_nut = nut_traps.nut_solid(
                    site, across_flats
                ).translate(
                    (outside_x * fraction, outside_y * fraction, 0.0)
                )
                missing = shape_volume(translated_nut.cut(sweep))
                with self.subTest(
                    across_flats=across_flats,
                    fraction=fraction,
                ):
                    self.assertLess(missing, 1e-7)

    def test_exact_sweep_has_analytic_convex_translation_volume(self):
        site = nut_traps.sites()[0]
        for across_flats in (0.05, P.NUT_NOMINAL_AF):
            sweep = nut_traps.insertion_sweep(site, across_flats)
            travel = math.hypot(
                *nut_traps.insertion_offsets(site, across_flats)[0]
            )
            hex_area = math.sqrt(3.0) * across_flats ** 2 / 2.0
            expected_volume = (
                hex_area + travel * across_flats
            ) * P.NUT_MAX_T
            with self.subTest(across_flats=across_flats):
                self.assertTrue(sweep.val().isValid())
                self.assertEqual(len(sweep.solids().vals()), 1)
                self.assertGreater(shape_volume(sweep), shape_volume(
                    nut_traps.nut_solid(site, across_flats)
                ))
                self.assertAlmostEqual(
                    shape_volume(sweep), expected_volume, delta=1e-6
                )

    def af_calls(self, site, across_flats):
        return (
            lambda: nut_traps.cage_radius(across_flats),
            lambda: nut_traps.hex_corner_diameter(across_flats),
            lambda: nut_traps.nut_solid(site, across_flats),
            lambda: nut_traps.front_voids(site, across_flats),
            lambda: nut_traps.insertion_offsets(site, across_flats),
            lambda: nut_traps.insertion_sweep(site, across_flats),
        )

    def test_kernel_safe_minimum_produces_valid_analytic_exact_sweep(self):
        minimum_af = getattr(P, "NUT_KERNEL_MIN_AF", 0.0001)
        for site in nut_traps.sites():
            nut = nut_traps.nut_solid(site, minimum_af)
            sweep = nut_traps.insertion_sweep(site, minimum_af)
            travel = math.hypot(
                *nut_traps.insertion_offsets(site, minimum_af)[0]
            )
            expected_volume = (
                math.sqrt(3.0) * minimum_af ** 2 / 2.0
                + travel * minimum_af
            ) * P.NUT_MAX_T
            with self.subTest(site=site):
                self.assertTrue(nut.val().isValid())
                self.assertTrue(sweep.val().isValid())
                self.assertEqual(len(sweep.solids().vals()), 1)
                self.assertAlmostEqual(
                    shape_volume(sweep), expected_volume, delta=1e-10
                )

    def test_values_immediately_below_kernel_minimum_reject_before_cadquery(self):
        minimum_af = getattr(P, "NUT_KERNEL_MIN_AF", 0.0001)
        below_minimum = math.nextafter(minimum_af, 0.0)
        site = nut_traps.sites()[0]
        with mock.patch.object(
            nut_traps.cq,
            "Workplane",
            side_effect=AssertionError("CadQuery must not be called"),
        ):
            for call in self.af_calls(site, below_minimum):
                with self.subTest(call=call):
                    try:
                        call()
                    except ValueError as error:
                        self.assertRegex(str(error), "across_flats")
                    except AssertionError as error:
                        self.fail(str(error))
                    else:
                        self.fail("below-minimum across_flats was accepted")

    def test_nonpositive_and_nonfinite_af_reject_consistently(self):
        site = nut_traps.sites()[0]
        for across_flats in (0.0, -1.0, math.nan, math.inf, -math.inf):
            for call in self.af_calls(site, across_flats):
                with self.subTest(across_flats=across_flats, call=call):
                    with self.assertRaisesRegex(ValueError, "across_flats"):
                        call()

    def test_thickness_validation_remains_independent_at_minimum_af(self):
        minimum_af = getattr(P, "NUT_KERNEL_MIN_AF", 0.0001)
        site = nut_traps.sites()[0]
        with self.assertRaisesRegex(ValueError, "thickness"):
            nut_traps.nut_solid(site, minimum_af, thickness=0.0)
        with self.assertRaisesRegex(ValueError, "across_flats"):
            nut_traps.nut_solid(
                site,
                math.nextafter(minimum_af, 0.0),
                thickness=0.0,
            )

    def assert_tapered_void_geometry(self, voids, site):
        for depth, expected_af in ((0.10, 4.20), (0.40, 3.60)):
            measured_af = equivalent_hex_af_at(
                voids,
                site.cavity_back_z - depth,
            )
            self.assertAlmostEqual(measured_af, expected_af, delta=0.02)

    def test_roof_void_has_forty_five_degree_internal_transition(self):
        for site in nut_traps.sites():
            with self.subTest(site=site):
                self.assert_tapered_void_geometry(
                    nut_traps.front_voids(site), site
                )

    def test_square_ledged_cavity_is_rejected_by_taper_probe(self):
        site = nut_traps.sites()[0]
        with self.assertRaises(AssertionError):
            self.assert_tapered_void_geometry(square_ledged_voids(site), site)

    def test_all_public_geometry_outputs_are_valid(self):
        for site in nut_traps.sites():
            outputs = {
                "nut": nut_traps.nut_solid(site),
                "material": nut_traps.front_material(site),
                "voids": nut_traps.front_voids(site),
                "screw": nut_traps.screw_path(site, site.roof_back_z - 0.1),
                "sweep": nut_traps.insertion_sweep(site),
            }
            for name, output in outputs.items():
                with self.subTest(site=site, output=name):
                    self.assertTrue(output.val().isValid())
                    self.assertGreater(shape_volume(output), 0.0)

    def test_front_material_is_one_valid_positive_solid(self):
        for site in nut_traps.sites():
            material = nut_traps.front_material(site)
            with self.subTest(site=site):
                self.assertTrue(material.val().isValid())
                self.assertEqual(len(material.solids().vals()), 1)
                self.assertGreater(shape_volume(material), 1.0)
                bounds = material.val().BoundingBox()
                self.assertAlmostEqual(bounds.xlen, 2.0 * P.NUT_ENVELOPE_R)
                self.assertAlmostEqual(bounds.ylen, 2.0 * P.NUT_ENVELOPE_R)
                self.assertAlmostEqual(bounds.zmin, site.roof_back_z)
                self.assertAlmostEqual(bounds.zmax, site.nut_front_z + 0.1)

    def test_finished_isolated_trap_is_valid_and_nonempty(self):
        for site in nut_traps.sites():
            trap = nut_traps.front_material(site).cut(
                nut_traps.front_voids(site)
            )
            with self.subTest(site=site):
                self.assertTrue(trap.val().isValid())
                self.assertEqual(len(trap.solids().vals()), 1)
                self.assertGreater(shape_volume(trap), 1.0)

    def test_nominal_seated_nut_does_not_intersect_finished_trap(self):
        for site in nut_traps.sites():
            trap = nut_traps.front_material(site).cut(
                nut_traps.front_voids(site)
            )
            overlap = shape_volume(trap.intersect(nut_traps.nut_solid(site)))
            with self.subTest(site=site):
                self.assertLess(overlap, 1e-5)

    def test_real_side_insertion_sweep_is_clear(self):
        for site in nut_traps.sites():
            trap = nut_traps.front_material(site).cut(
                nut_traps.front_voids(site)
            )
            overlap = shape_volume(
                trap.intersect(nut_traps.insertion_sweep(site))
            )
            with self.subTest(site=site):
                self.assertLess(overlap, 1e-5)

    def test_insertion_sweep_begins_with_the_whole_nut_outside_the_cage(self):
        for site in nut_traps.sites():
            mouth_x, mouth_y = nut_traps._normalized_mouth(site)
            nut = nut_traps.nut_solid(site)
            sweep = nut_traps.insertion_sweep(site)

            def projections(shape):
                return [
                    (vertex.X - site.x) * mouth_x
                    + (vertex.Y - site.y) * mouth_y
                    for vertex in shape.vertices().vals()
                ]

            nut_projections = projections(nut)
            sweep_projections = projections(sweep)
            travel = max(sweep_projections) - max(nut_projections)
            starting_nut_nearest_point = travel + min(nut_projections)
            with self.subTest(site=site):
                self.assertGreater(
                    starting_nut_nearest_point,
                    P.NUT_ENVELOPE_R,
                )

    def test_blocking_the_throat_makes_the_insertion_sweep_collide(self):
        site = nut_traps.sites()[4]
        mouth_x, mouth_y = nut_traps._normalized_mouth(site)
        blocker_center = (
            site.x + 1.5 * mouth_x,
            site.y + 1.5 * mouth_y,
            site.cavity_back_z,
        )
        blocker = (
            cq.Workplane("XY")
            .box(
                P.NUT_THROAT_W,
                P.NUT_THROAT_W,
                P.NUT_CAVITY_T,
                centered=(True, True, False),
            )
            .translate(blocker_center)
        )
        blocked_path_overlap = shape_volume(
            blocker.intersect(nut_traps.insertion_sweep(site))
        )
        self.assertGreater(blocked_path_overlap, 1.0)

    def assert_finished_roof_geometry(self, finished, site):
        roof_hex = roof_hex_probe(
            site,
            4.4,
            site.roof_back_z,
            site.cavity_back_z - 0.5,
        )
        roof_bore = roof_cylinder_probe(
            site,
            2.4,
            site.roof_back_z,
            site.cavity_back_z - 0.5,
        )
        load_area = roof_hex.cut(roof_bore)
        self.assertGreater(shape_volume(load_area), 6.0)
        actual_load_area = finished.intersect(load_area)
        self.assertAlmostEqual(
            shape_volume(actual_load_area),
            shape_volume(load_area),
            delta=1e-5,
        )
        self.assertAlmostEqual(actual_load_area.val().BoundingBox().zlen, 0.5)

        full_roof_bore = roof_cylinder_probe(
            site,
            2.4,
            site.roof_back_z,
            site.cavity_back_z,
        )
        self.assertLess(shape_volume(finished.intersect(full_roof_bore)), 1e-8)

        cage_section = (
            cq.Workplane("XY")
            .circle(P.NUT_ENVELOPE_R)
            .extrude(0.01)
            .translate((site.x, site.y, site.cavity_back_z - 0.405))
        )
        self.assertGreater(
            shape_volume(finished.intersect(cage_section)) / 0.01,
            20.0,
        )

        cavity_side_probe = roof_hex_probe(
            site,
            4.0,
            site.cavity_back_z,
            site.cavity_back_z + 0.05,
        )
        self.assertLess(
            shape_volume(finished.intersect(cavity_side_probe)),
            1e-8,
        )

    def test_finished_trap_has_solid_roof_around_an_open_screw_bore(self):
        for site in nut_traps.sites():
            finished = nut_traps.front_material(site).cut(
                nut_traps.front_voids(site)
            )
            with self.subTest(site=site):
                self.assert_finished_roof_geometry(finished, site)

    def test_overdeep_hex_cavity_is_rejected_by_roof_geometry_probe(self):
        site = nut_traps.sites()[0]
        overdeep_cavity = roof_hex_probe(
            site,
            4.4,
            site.roof_back_z,
            site.cavity_back_z + 0.1,
        )
        bad_finished = nut_traps.front_material(site).cut(
            nut_traps.front_voids(site).union(overdeep_cavity)
        )
        with self.assertRaises(AssertionError):
            self.assert_finished_roof_geometry(bad_finished, site)

    def test_voids_reach_the_intended_planes_without_opening_outer_face(self):
        for site in nut_traps.sites():
            voids = nut_traps.front_voids(site)
            bounds = voids.val().BoundingBox()
            with self.subTest(site=site):
                self.assertAlmostEqual(bounds.zmin, site.roof_back_z - 0.1)
                self.assertAlmostEqual(
                    bounds.zmax,
                    site.nut_front_z + P.MACHINE_SCREW_TIP_RELIEF,
                )
                self.assertAlmostEqual(-bounds.zmax, 0.9)
                self.assertLess(bounds.zmax, 0.0)
                cavity_back_slice = voids.intersect(
                    thin_slab(site.cavity_back_z, site.cavity_back_z + 0.05)
                )
                inside_face_slice = voids.intersect(
                    thin_slab(site.nut_front_z, site.nut_front_z + 0.05)
                )
                outer_face_slice = voids.intersect(thin_slab(-0.5, -0.45))
                self.assertGreater(shape_volume(cavity_back_slice), 0.1)
                self.assertGreater(shape_volume(inside_face_slice), 0.1)
                self.assertLess(shape_volume(outer_face_slice), 1e-8)

    def test_invalid_public_geometry_inputs_are_rejected(self):
        site = nut_traps.sites()[0]
        for function in (
            nut_traps.nut_solid,
            nut_traps.front_voids,
            nut_traps.insertion_offsets,
            nut_traps.insertion_sweep,
        ):
            with self.subTest(function=function.__name__):
                with self.assertRaisesRegex(ValueError, "across_flats"):
                    function(site, across_flats=-1.0)
        with self.assertRaisesRegex(ValueError, "thickness"):
            nut_traps.nut_solid(site, thickness=0.0)
        with self.assertRaisesRegex(ValueError, "z_back"):
            nut_traps.screw_path(
                site,
                site.nut_front_z + P.MACHINE_SCREW_TIP_RELIEF,
            )
        with self.assertRaisesRegex(ValueError, "z_back"):
            nut_traps.screw_path(site, "behind")


class AssembledFrontNutTrapTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.front_model = shell_front.build()
        # to_model_space is an involution: applying it a second time returns
        # the layout-space coordinates used by params and nut_traps.
        cls.front = shell_front.to_model_space(cls.front_model)
        cls.outer = shell_front.outer_body()

    def test_finished_front_is_one_valid_solid(self):
        self.assertTrue(self.front_model.val().isValid())
        self.assertEqual(len(self.front_model.solids().vals()), 1)

    def test_all_seated_nuts_and_exact_insertion_sweeps_are_clear(self):
        for site in nut_traps.sites():
            nut_overlap = shape_volume(
                self.front.intersect(nut_traps.nut_solid(site))
            )
            sweep_overlap = shape_volume(
                self.front.intersect(nut_traps.insertion_sweep(site))
            )
            with self.subTest(site=site, probe="seated nut"):
                self.assertLess(nut_overlap, 1e-5)
            with self.subTest(site=site, probe="insertion sweep"):
                self.assertLess(sweep_overlap, 1e-5)

    def test_machine_screw_paths_are_clear_through_the_whole_front(self):
        for site in nut_traps.sites():
            path = nut_traps.screw_path(
                site,
                -shell_front.SHELL_DEPTH - 0.1,
            )
            overlap = shape_volume(self.front.intersect(path))
            with self.subTest(site=site):
                self.assertLess(overlap, 1e-5)

    def test_preview_hardware_clears_actual_electronics_and_shell_exports(self):
        shell_back = importlib.import_module("shell_back")
        back = shell_back.build_back().val()
        controller = place_preview.kicad_pcb_to_model_space(
            cq.importers.importStep(
                str(place_preview.PCB_DIR / "pocket_card_controller.step")
            )
        )
        controller = (
            controller.val() if hasattr(controller, "val") else controller
        )
        module = (
            cq.Workplane("XY")
            .box(P.MOD_W, P.MOD_H, P.MOD_PCB_T, centered=(False, False, False))
            .translate((P.MOD_X, P.MOD_Y, -shell_front.MOD_PCB_BACK))
        )
        for site in nut_traps.sites()[:4]:
            module = module.cut(
                cq.Workplane("XY")
                .circle(P.MOUNT_HOLE_D / 2.0)
                .extrude(P.MOD_PCB_T + 0.2)
                .translate((site.x, site.y, -shell_front.MOD_PCB_BACK - 0.1))
            )
        module = shell_front.to_model_space(module).val()
        battery = shell_front.to_model_space(
            cq.Workplane("XY")
            .box(P.CELL_W, P.CELL_H, P.CELL_T, centered=(False, False, False))
            .translate((P.BATT_X, P.BATT_Y, -P.LOWER_ZONE_T + P.WALL))
        ).val()
        speaker = shell_front.to_model_space(
            cq.Workplane("XY")
            .slot2D(P.DRIVER_H, P.DRIVER_W, 90)
            .extrude(-P.DRIVER_T)
            .translate((P.GRILLE_X, P.GRILLE_Y, -P.FACE_T))
        ).val()
        front = self.front_model.val()
        fasteners = place_preview._model_fasteners()

        for index in range(0, len(fasteners), 2):
            nut_name, nut_workplane = fasteners[index]
            screw_name, screw_workplane = fasteners[index + 1]
            nut = nut_workplane.val()
            screw = screw_workplane.val()
            for part_name, part in (
                ("front", front), ("back", back),
                ("controller PCB/components", controller),
                ("display module", module),
                ("battery", battery),
                ("speaker", speaker),
            ):
                with self.subTest(fastener=nut_name, part=part_name):
                    self.assertLess(
                        sum(solid.Volume() for solid in part.intersect(nut).Solids()),
                        1e-5,
                    )
                with self.subTest(fastener=screw_name, part=part_name):
                    self.assertLess(
                        sum(solid.Volume() for solid in part.intersect(screw).Solids()),
                        1e-5,
                    )
            with self.subTest(fastener=screw_name, contact=nut_name):
                self.assertGreater(
                    sum(solid.Volume() for solid in nut.intersect(screw).Solids()),
                    1.0,
                )

        for fastener_name in ("screw_5", "screw_6"):
            screw = dict(fasteners)[fastener_name].val()
            with self.subTest(fastener=fastener_name, pcb="actual"):
                self.assertLess(
                    sum(
                        solid.Volume()
                        for solid in controller.intersect(screw).Solids()
                    ),
                    1e-5,
                )
            wrong_holes = controller.translate((2.0, 0.0, 0.0))
            with self.subTest(fastener=fastener_name, pcb="translated holes"):
                self.assertGreater(
                    sum(
                        solid.Volume()
                        for solid in wrong_holes.intersect(screw).Solids()
                    ),
                    1.0,
                )

    def test_cages_fit_the_true_envelope_without_breaking_the_outer_skin(self):
        skin_slab = thin_slab(-0.50, -0.45)
        for site in nut_traps.sites():
            material = nut_traps.front_material(site)
            outside = shape_volume(material.cut(self.outer))
            required_skin = (
                cq.Workplane("XY")
                .circle(P.NUT_ENVELOPE_R)
                .extrude(0.05)
                .translate((site.x, site.y, -0.50))
                .intersect(self.outer)
                .intersect(skin_slab)
            )
            missing_skin = shape_volume(required_skin.cut(self.front))
            with self.subTest(site=site, probe="compound envelope"):
                self.assertLess(outside, 1e-8)
            with self.subTest(site=site, probe="outer skin"):
                self.assertGreater(shape_volume(required_skin), 0.1)
                self.assertLess(missing_skin, 1e-5)

    def test_finished_front_retains_each_complete_isolated_trap(self):
        for site in nut_traps.sites():
            required = nut_traps.front_material(site).cut(
                nut_traps.front_voids(site)
            )
            missing = shape_volume(required.cut(self.front))
            with self.subTest(site=site):
                self.assertLess(missing, 1e-5)

    def test_old_self_tapping_pilot_cannot_clear_an_m2_screw_path(self):
        site = nut_traps.sites()[0]
        legacy_post = (
            cq.Workplane("XY")
            .circle(shell_front.POST_D / 2.0)
            .extrude(-shell_front.SHELL_DEPTH)
            .translate((site.x, site.y, 0.0))
            .cut(
                cq.Workplane("XY")
                .circle(1.7 / 2.0)
                .extrude(-shell_front.SHELL_DEPTH)
                .translate((site.x, site.y, 0.0))
            )
        )
        required_path = nut_traps.screw_path(
            site,
            -shell_front.SHELL_DEPTH - 0.1,
        )
        self.assertGreater(
            shape_volume(legacy_post.intersect(required_path)),
            1.0,
        )

    def test_h2_complete_radial_envelope_clears_real_neighbours(self):
        h2_x, h2_y = P.PCB_MOUNTS[1]
        radius = P.NUT_ENVELOPE_R

        battery_gap = h2_x - (P.BATT_X + P.CELL_W) - radius

        driver_radius = P.DRIVER_W / 2.0
        cap_offset = (P.DRIVER_H - P.DRIVER_W) / 2.0
        segment_y0 = P.GRILLE_Y - cap_offset
        segment_y1 = P.GRILLE_Y + cap_offset
        closest_segment_y = max(segment_y0, min(h2_y, segment_y1))
        speaker_gap = (
            math.hypot(
                h2_x - P.GRILLE_X,
                h2_y - closest_segment_y,
            )
            - driver_radius
            - radius
        )

        reset_outer_radius = (
            P.RESET_CAP_D / 2.0
            + P.CAP_FLANGE_OS
            + P.COLLAR_CLEAR
            + shell_front.COLLAR_WALL
        )
        reset_gap = (
            math.hypot(h2_x - P.RESET_X, h2_y - P.RESET_Y)
            - radius
            - reset_outer_radius
        )

        self.assertGreaterEqual(battery_gap, 1.8)
        self.assertGreaterEqual(speaker_gap, 0.9)
        self.assertGreaterEqual(reset_gap, 0.6)

    def test_speaker_wire_envelopes_cover_both_rear_wall_notches(self):
        helper = getattr(shell_front, "speaker_wire_envelopes", None)
        self.assertIsNotNone(helper, "speaker lead envelopes are missing")
        envelopes = helper()
        self.assertEqual(len(envelopes), 2)

        wall = 1.2
        driver_h = P.DRIVER_H + 0.6
        driver_back_z = -P.FACE_T - P.DRIVER_T
        for sign, envelope in zip((-1, 1), envelopes):
            notch = (
                cq.Workplane("XY")
                .box(
                    P.DRIVER_CABLE_W,
                    2.0 * (wall + 1.0),
                    P.DRIVER_CABLE_CLR + 1.0,
                    centered=(True, True, False),
                )
                .translate((
                    P.GRILLE_X,
                    P.GRILLE_Y + sign * driver_h / 2.0,
                    driver_back_z - 1.0,
                ))
            )
            with self.subTest(exit="north" if sign < 0 else "south"):
                bounds = envelope.val().BoundingBox()
                self.assertTrue(envelope.val().isValid())
                self.assertEqual(len(envelope.solids().vals()), 1)
                self.assertGreater(shape_volume(envelope), 0.0)
                self.assertGreater(shape_volume(envelope.intersect(notch)), 1.0)
                self.assertLess(bounds.zmin, -P.PCB_FRONT_Z)
                self.assertGreater(bounds.zmax, -P.PCB_FRONT_Z)

    def test_only_south_is_the_approved_installed_speaker_lead_exit(self):
        self.assertEqual(getattr(P, "DRIVER_LEAD_EXIT", None), "south")
        north, south = shell_front.speaker_wire_envelopes()
        action_guide, _ = shell_front.button_station(
            hole_d=P.AB_CAP_D, pill=False
        )
        action_guide = shell_front._dev(action_guide, P.ACT_X, P.ACT_Y)
        self.assertGreater(shape_volume(action_guide.intersect(north)), 0.1)
        self.assertLess(shape_volume(action_guide.intersect(south)), 1e-5)

    def test_approved_south_service_route_is_clear_in_finished_front(self):
        north, south = shell_front.speaker_wire_envelopes()
        self.assertGreater(shape_volume(self.front.intersect(north)), 0.1)
        self.assertLess(shape_volume(self.front.intersect(south)), 1e-5)

    def test_approved_south_route_returns_below_driver_into_free_interior(self):
        south = shell_front.speaker_wire_envelopes()[1]
        driver_back_z = -P.FACE_T - P.DRIVER_T
        interior_tail = (
            cq.Workplane("XY")
            .box(P.DRIVER_CABLE_W, 0.5, 0.5, centered=(True, True, False))
            .translate((
                P.GRILLE_X,
                P.GRILLE_Y + P.DRIVER_H / 2.0 - 1.0,
                driver_back_z - P.DRIVER_CABLE_CLR,
            ))
        )
        self.assertGreater(shape_volume(south.intersect(interior_tail)), 0.1)
        self.assertLess(shape_volume(self.front.intersect(interior_tail)), 1e-5)

    def test_south_relief_preserves_exterior_skin_split_lip_and_action_travel(self):
        relief = shell_front.speaker_wire_service_relief()
        base = shell_front.outer_body().cut(shell_front.cavity())
        cut_material = base.intersect(relief)
        bounds = cut_material.val().BoundingBox()
        relief_bounds = relief.val().BoundingBox()
        rebate_top = (
            -shell_front.SHELL_DEPTH + P.LAP_H + P.LAP_OVER
        )
        radial_skin = P.BODY_H - bounds.ymax
        face_skin = -relief_bounds.zmax
        split_gap = bounds.zmin - rebate_top
        self.assertGreaterEqual(radial_skin, P.NUT_ROOF_T)
        self.assertGreaterEqual(face_skin, P.FACE_T)
        self.assertGreaterEqual(split_gap, P.LAP_FRONT_T)

        skin_probe = (
            cq.Workplane("XY")
            .box(
                bounds.xlen,
                radial_skin,
                bounds.zlen,
                centered=(True, True, False),
            )
            .translate((
                (bounds.xmin + bounds.xmax) / 2.0,
                bounds.ymax + radial_skin / 2.0,
                bounds.zmin,
            ))
        )
        required_skin = base.intersect(skin_probe)
        self.assertGreater(shape_volume(required_skin), 1.0)
        self.assertLess(shape_volume(required_skin.cut(self.front)), 1e-5)

        lip_probe = (
            cq.Workplane("XY")
            .box(
                bounds.xlen,
                P.WALL,
                P.LAP_H + P.LAP_OVER,
                centered=(True, True, False),
            )
            .translate((
                (bounds.xmin + bounds.xmax) / 2.0,
                P.BODY_H - P.WALL / 2.0,
                -shell_front.SHELL_DEPTH,
            ))
        )
        required_lip = base.intersect(lip_probe)
        self.assertGreater(shape_volume(required_lip), 1.0)
        self.assertLess(shape_volume(required_lip.cut(self.front)), 1e-5)

        action_guide, _ = shell_front.button_station(
            hole_d=P.AB_CAP_D, pill=False
        )
        action_guide = shell_front._dev(action_guide, P.ACT_X, P.ACT_Y)
        action_flange_r = P.AB_CAP_D / 2.0 + P.CAP_FLANGE_OS
        action_travel = (
            cq.Workplane("XY")
            .circle(action_flange_r)
            .extrude(-(P.FACE_T + P.COLLAR_DEPTH + P.CAP_PROUD))
            .translate((P.ACT_X, P.ACT_Y, P.CAP_PROUD))
        )
        self.assertLess(shape_volume(relief.intersect(action_guide)), 1e-5)
        self.assertLess(shape_volume(relief.intersect(action_travel)), 1e-5)

    def test_production_check_rejects_front_built_without_south_relief(self):
        unrelieved_model = shell_front.build(apply_speaker_wire_relief=False)
        unrelieved = shell_front.to_model_space(unrelieved_model)
        south = shell_front.speaker_wire_envelopes()[1]
        self.assertGreater(shape_volume(unrelieved.intersect(south)), 0.1)

        previous_failures = list(checks.FAILURES)
        checks.FAILURES.clear()
        try:
            checks.check_captive_nut_traps(unrelieved_model)
            self.assertTrue(
                any(
                    "approved speaker lead south route blocked" in failure
                    for failure in checks.FAILURES
                ),
                checks.FAILURES,
            )
        finally:
            checks.FAILURES[:] = previous_failures

    def test_all_complete_traps_clear_both_speaker_lead_options(self):
        helper = getattr(shell_front, "speaker_wire_envelopes", None)
        self.assertIsNotNone(helper, "speaker lead envelopes are missing")
        for exit_name, wire in zip(("north", "south"), helper()):
            for site in nut_traps.sites():
                material = nut_traps.front_material(site)
                actual_trap = self.front.intersect(material)
                with self.subTest(exit=exit_name, site=site, probe="envelope"):
                    self.assertLess(shape_volume(material.intersect(wire)), 1e-5)
                with self.subTest(exit=exit_name, site=site, probe="actual"):
                    self.assertLess(
                        shape_volume(actual_trap.intersect(wire)),
                        1e-5,
                    )

    def test_production_check_rejects_an_adversarial_speaker_lead_overlap(self):
        helper = getattr(shell_front, "speaker_wire_envelopes", None)
        self.assertIsNotNone(helper, "speaker lead envelopes are missing")
        north, south = helper()
        site = nut_traps.sites()[-1]
        bounds = north.val().BoundingBox()
        bad_north = north.translate((
            site.x - (bounds.xmin + bounds.xmax) / 2.0,
            site.y - (bounds.ymin + bounds.ymax) / 2.0,
            0.0,
        ))
        self.assertGreater(
            shape_volume(bad_north.intersect(nut_traps.front_material(site))),
            0.1,
        )

        previous_failures = list(checks.FAILURES)
        checks.FAILURES.clear()
        try:
            with mock.patch.object(
                shell_front,
                "speaker_wire_envelopes",
                return_value=(bad_north, south),
            ):
                checks.check_captive_nut_traps(self.front_model)
            self.assertTrue(
                any("speaker lead" in failure for failure in checks.FAILURES),
                checks.FAILURES,
            )
        finally:
            checks.FAILURES[:] = previous_failures

    def test_production_check_accepts_the_built_front_and_reports_h2_gaps(self):
        previous_failures = list(checks.FAILURES)
        checks.FAILURES.clear()
        try:
            check = getattr(checks, "check_captive_nut_traps", None)
            self.assertIsNotNone(check, "production captive-nut check is missing")
            metrics = check(self.front_model)
            self.assertEqual(checks.FAILURES, [])
        finally:
            checks.FAILURES[:] = previous_failures
        self.assertAlmostEqual(metrics["h2_battery_gap"], 1.9)
        self.assertAlmostEqual(metrics["h2_speaker_gap"], 0.9433963806)
        self.assertAlmostEqual(metrics["h2_reset_gap"], 0.6703296143)
        self.assertLess(metrics["speaker_wire_north_overlap"], 1e-5)
        self.assertLess(metrics["speaker_wire_south_overlap"], 1e-5)
        self.assertGreater(metrics["speaker_wire_north_clearance"], 0.0)
        self.assertGreater(metrics["speaker_wire_south_clearance"], 0.0)
        self.assertGreater(metrics["speaker_wire_north_front_overlap"], 0.1)
        self.assertLess(metrics["speaker_wire_south_front_overlap"], 1e-5)
        self.assertGreaterEqual(metrics["speaker_wire_radial_skin"], P.NUT_ROOF_T)
        self.assertGreaterEqual(metrics["speaker_wire_face_skin"], P.FACE_T)
        self.assertGreaterEqual(metrics["speaker_wire_split_gap"], P.LAP_FRONT_T)


if __name__ == "__main__":
    unittest.main()
