# Pocket Card Blender Emboss and Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically convert the generated Pocket Card shell STLs into modifier-applied embossed STLs and a clean coloured Blender assembly containing the case, controls, PCB, and positioned display.

**Architecture:** A Python script executed inside headless Blender opens the existing finishing template, swaps only the two shell mesh datablocks, evaluates and stages modifier-applied STLs, then resets to an empty scene and builds a coloured assembly. All three outputs are validated before a rollback-capable same-filesystem publication step; Make invokes the workflow after both existing shell-generating targets.

**Tech Stack:** GNU Make, Blender 5.2 Python API (`bpy`, `bmesh`), Python standard library (`argparse`, `pathlib`, `tempfile`, `hashlib`, `unittest`, `subprocess`), binary STL, Blender `.blend` libraries.

---

## File Map

- Create `hardware/pocket_card/case/emboss_shells.py`: Blender-hosted pipeline; owns preflight, shell replacement, evaluated export, mesh validation, assembly construction, and transactional publication.
- Create `hardware/pocket_card/case/test_emboss_shells.py`: host-side integration tests that invoke Blender in a temporary output directory and inspect the saved assembly in a second Blender process.
- Modify `Makefile`: locate Blender, add `pocket_card_case_embossed`, and invoke it after both existing shell builds.
- Modify `hardware/pocket_card/case/README.md`: document automatic outputs, direct rerun, Blender override, colours, and failure behaviour.
- Add `hardware/card/case/es3c28p_3d.blend`: existing user-authored display asset required by the assembly.

### Task 1: Establish the Blender integration-test harness

**Files:**
- Create: `hardware/pocket_card/case/test_emboss_shells.py`
- Add: `hardware/card/case/es3c28p_3d.blend`

- [ ] **Step 1: Add the display asset without changing it**

Stage the existing file and record its hash before any Blender run:

```bash
shasum -a 256 hardware/card/case/es3c28p_3d.blend
git add hardware/card/case/es3c28p_3d.blend
```

Expected: one SHA-256 line and the asset staged as a new file.

- [ ] **Step 2: Write the failing success-path integration test**

Create a `unittest` harness with these concrete helpers and assertion contract:

```python
ROOT = Path(__file__).resolve().parents[3]
CASE = ROOT / "hardware/pocket_card/case"
TEMPLATE = ROOT / "hardware/card/case/case_updated.blend"
DISPLAY = ROOT / "hardware/card/case/es3c28p_3d.blend"
SCRIPT = CASE / "emboss_shells.py"

EXPECTED_OBJECTS = {
    "shell_front_embossed", "shell_back_embossed",
    "cap_up", "cap_down", "cap_left", "cap_right",
    "cap_undo", "cap_action", "cap_reset", "cap_menu",
    "tip_power", "tip_mute", "pcb", "es3c28p_3d",
}

def blender_bin():
    override = os.environ.get("BLENDER")
    candidates = [override, shutil.which("blender"),
                  "/Applications/Blender.app/Contents/MacOS/Blender"]
    for value in candidates:
        if value and Path(value).is_file():
            return value
    raise unittest.SkipTest("Blender not installed; set BLENDER=/path/to/blender")

def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

class BlenderFinishIntegrationTest(unittest.TestCase):
    def test_real_pipeline_builds_closed_shells_and_complete_assembly(self):
        before = (sha256(TEMPLATE), TEMPLATE.stat().st_mtime_ns)
        with tempfile.TemporaryDirectory() as tmp:
            result = run_pipeline(Path(tmp))
            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertGreater((Path(tmp) / "shell_front_embossed.stl").stat().st_size, 0)
            self.assertGreater((Path(tmp) / "shell_back_embossed.stl").stat().st_size, 0)
            self.assertGreater((Path(tmp) / "pocket_card_complete.blend").stat().st_size, 0)
            inventory = inspect_blend(Path(tmp) / "pocket_card_complete.blend")
            source_display = inspect_blend(DISPLAY)
            self.assertEqual(set(inventory["objects"]), EXPECTED_OBJECTS)
            self.assertEqual(set(inventory["collections"]),
                             {"Case", "Buttons", "Electronics", "Display"})
            self.assertEqual(inventory["display_transform"],
                             source_display["display_transform"])
        self.assertEqual((sha256(TEMPLATE), TEMPLATE.stat().st_mtime_ns), before)
```

`run_pipeline()` must invoke:

```python
[
    blender_bin(), "--background", str(TEMPLATE),
    "--python-exit-code", "1", "--python", str(SCRIPT), "--",
    "--output-dir", str(output_dir),
]
```

`inspect_blend()` must reopen either `.blend` with `--background` and parse one
`ASSEMBLY_INVENTORY=<json>` line containing collection names, mesh object
names, per-object material names, and the `es3c28p_3d` transform when present.

- [ ] **Step 3: Run the test to verify the missing script failure**

Run:

```bash
python3 -m unittest hardware.pocket_card.case.test_emboss_shells.BlenderFinishIntegrationTest.test_real_pipeline_builds_closed_shells_and_complete_assembly -v
```

Expected: FAIL because `hardware/pocket_card/case/emboss_shells.py` does not yet exist.

- [ ] **Step 4: Commit the failing test and source asset**

```bash
git add hardware/card/case/es3c28p_3d.blend hardware/pocket_card/case/test_emboss_shells.py
git commit -m "test: specify Pocket Card Blender finishing output"
```

### Task 2: Implement shell preflight, replacement, and evaluated export

**Files:**
- Create: `hardware/pocket_card/case/emboss_shells.py`
- Test: `hardware/pocket_card/case/test_emboss_shells.py`

- [ ] **Step 1: Add the CLI and immutable path contract**

Implement these concrete arguments and data structures:

```python
@dataclass(frozen=True)
class Paths:
    repo: Path
    template: Path
    display: Path
    front_input: Path
    back_input: Path
    preview: Path
    output: Path

def parse_args(argv):
    repo = Path(__file__).resolve().parents[3]
    order = repo / "hardware/pocket_card/case/out/order"
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=order)
    parser.add_argument("--front", type=Path, default=order / "shell_front.stl")
    parser.add_argument("--back", type=Path, default=order / "shell_back.stl")
    parser.add_argument("--preview-dir", type=Path, default=order / "preview")
    parser.add_argument("--display", type=Path,
                        default=repo / "hardware/card/case/es3c28p_3d.blend")
    args = parser.parse_args(argv)
    return Paths(repo, repo / "hardware/card/case/case_updated.blend",
                 args.display.resolve(), args.front.resolve(), args.back.resolve(),
                 args.preview_dir.resolve(), args.output_dir.resolve())
```

Use `sys.argv[sys.argv.index("--") + 1:]` when `--` is present, otherwise an
empty list. Create the output directory but do not create final files during
argument parsing.

- [ ] **Step 2: Implement preflight and one-object STL import**

Use these invariants:

```python
SHELLS = (("shell_front", "front_input"), ("shell_back", "back_input"))
BOUND_TOL = 0.05

def require_file(path, label):
    if not path.is_file() or path.stat().st_size == 0:
        raise FinishError(f"{label}: missing or empty file: {path}")

def identity_transform(obj):
    return (all(abs(v) < 1e-8 for v in obj.location) and
            all(abs(v) < 1e-8 for v in obj.rotation_euler) and
            all(abs(v - 1.0) < 1e-8 for v in obj.scale))

def import_one_stl(path, label):
    before = set(bpy.data.objects)
    bpy.ops.wm.stl_import(filepath=str(path), global_scale=1.0,
                          use_scene_unit=False, forward_axis="Y", up_axis="Z")
    created = [obj for obj in bpy.data.objects if obj not in before]
    if len(created) != 1 or created[0].type != "MESH":
        raise FinishError(f"{label}: expected one mesh, got {[o.name for o in created]}")
    return created[0]
```

Validate that the open `bpy.data.filepath` resolves to the template; both target
objects are identity-transformed meshes; every enabled Boolean has a non-null
mesh operand; and imported/template world bounds differ by no more than
`BOUND_TOL` on all six extrema.

- [ ] **Step 3: Replace mesh data while preserving object identity**

Implement:

```python
def replace_mesh_data(target, imported):
    old_mesh = target.data
    target.data = imported.data
    imported.data = None
    bpy.data.objects.remove(imported, do_unlink=True)
    if old_mesh.users == 0:
        bpy.data.meshes.remove(old_mesh)
```

Assert before and after replacement that `target.name`, modifier names, and
modifier count are unchanged.

- [ ] **Step 4: Export and validate each evaluated shell into staging**

Create a staging directory with `tempfile.mkdtemp(prefix=".pocket-card-finish-",
dir=paths.output)`. For each target, isolate selection and run:

```python
bpy.ops.wm.stl_export(
    filepath=str(staged_path), export_selected_objects=True,
    apply_modifiers=True, evaluation_mode="DAG_EVAL_RENDER",
    global_scale=1.0, use_scene_unit=False,
    forward_axis="Y", up_axis="Z",
)
```

Validate the evaluated Blender mesh with `bmesh`: at least one vertex and
polygon, finite coordinates, all dimensions positive, expected X/Y extrema
within 0.05 mm, and
`sum(not edge.is_manifold for edge in bm.edges) == 0`. Re-import the staged STL
and validate one identity-transformed mesh with vertices and polygons, finite
coordinates, positive dimensions, and matching X/Y bounds. Do not require the
re-imported topology itself to be manifold: Blender's STL importer removes
degenerate and duplicate boundary triangles emitted by the MANIFOLD Boolean
export, while the authoritative evaluated mesh remains closed.

- [ ] **Step 5: Run the integration test and confirm it advances to the assembly failure**

Run the Task 1 unittest again.

Expected: FAIL because `pocket_card_complete.blend` is not yet produced; logs
must show two staged, closed shell STLs.

- [ ] **Step 6: Commit the shell-finishing core**

```bash
git add hardware/pocket_card/case/emboss_shells.py
git commit -m "feat: export modifier-applied Pocket Card shells"
```

### Task 3: Build the clean coloured Blender assembly

**Files:**
- Modify: `hardware/pocket_card/case/emboss_shells.py`
- Modify: `hardware/pocket_card/case/test_emboss_shells.py`

- [ ] **Step 1: Extend the failing test with material and display assertions**

Add these exact expectations:

```python
self.assertEqual(inventory["materials"]["shell_front_embossed"], ["Case Purple"])
self.assertEqual(inventory["materials"]["shell_back_embossed"], ["Case White"])
for name in EXPECTED_OBJECTS & {"cap_up", "cap_down", "cap_left", "cap_right",
                               "cap_undo", "cap_action", "cap_reset", "cap_menu",
                               "tip_power", "tip_mute"}:
    self.assertEqual(inventory["materials"][name], ["Button Yellow"])
self.assertEqual(inventory["materials"]["pcb"], ["PCB Green"])
self.assertEqual(inventory["display_material_count"], 4)
self.assertEqual(inventory["display_transform"],
                 inspect_blend(DISPLAY)["display_transform"])
```

Run the test and expect failure because the assembly builder is absent.

- [ ] **Step 2: Reset Blender and create deterministic collections/materials**

After shell staging, call `bpy.ops.wm.read_factory_settings(use_empty=True)` and
create exactly `Case`, `Buttons`, `Electronics`, and `Display` under the scene
root collection. Create materials with Principled BSDF base colours and
roughness 0.45:

```python
MATERIALS = {
    "Case Purple": (0.435, 0.235, 0.765, 1.0),
    "Case White": (0.90, 0.90, 0.87, 1.0),
    "Button Yellow": (0.96, 0.67, 0.12, 1.0),
    "PCB Green": (0.12, 0.48, 0.20, 1.0),
}
```

Set both `material.diffuse_color` and each object's `object.color`.

- [ ] **Step 3: Import and classify all STL assembly parts**

Import the two staged shell STLs, eight `cap_*.stl` files, two `tip_*.stl`
files, and `preview/pcb.stl` separately with `import_one_stl()`. Rename each
object to its filename stem, remove it from importer-created collections, link
it only to the required named collection, clear all imported material slots,
and assign its designated basic material.

- [ ] **Step 4: Append the display as native Blender data**

Implement:

```python
def append_display(path, collection):
    with bpy.data.libraries.load(str(path), link=False) as (source, target):
        if "es3c28p_3d" not in source.objects:
            raise FinishError(f"display object es3c28p_3d missing from {path}")
        target.objects = ["es3c28p_3d"]
    obj = target.objects[0]
    collection.objects.link(obj)
    if len(obj.material_slots) != 4:
        raise FinishError("display must retain four material slots")
    # Resolve image-node paths against the source library, then pack the images
    # so the completed assembly remains self-contained at its new save path.
    return obj
```

Do not alter the appended object's transform, mesh, slots, or material data.
Require every referenced image to load at its source resolution and pack it
into the completed `.blend`.

- [ ] **Step 5: Validate and stage the complete `.blend`**

Assert the exact 14-object set, exact four collection set, single collection
membership for every imported STL object, requested material assignment,
source-equal display transform/slots, and packed source-resolution display
images. Set metric scene units, then save only to
`staging/pocket_card_complete.blend` with `bpy.ops.wm.save_as_mainfile()`.

- [ ] **Step 6: Run the integration test**

Run:

```bash
python3 -m unittest hardware.pocket_card.case.test_emboss_shells -v
```

Expected: the success-path test passes and the second Blender process reports
four collections, 14 mesh objects, requested material names, and four display
material slots.

- [ ] **Step 7: Commit assembly generation**

```bash
git add hardware/pocket_card/case/emboss_shells.py hardware/pocket_card/case/test_emboss_shells.py
git commit -m "feat: build coloured Pocket Card Blender assembly"
```

### Task 4: Add rollback-capable publication and Make integration

**Files:**
- Modify: `hardware/pocket_card/case/emboss_shells.py`
- Modify: `hardware/pocket_card/case/test_emboss_shells.py`
- Modify: `Makefile`

- [ ] **Step 1: Write the failing preservation test**

Create three sentinel final files in a temporary output directory, invoke the
pipeline with `--front <missing-path>`, and assert non-zero exit plus exact
sentinel bytes remaining at all three final paths:

```python
sentinels = {
    "shell_front_embossed.stl": b"old-front",
    "shell_back_embossed.stl": b"old-back",
    "pocket_card_complete.blend": b"old-blend",
}
```

Run this test and expect failure until cleanup/publication is implemented.

- [ ] **Step 2: Implement transactional publication**

Map staged files to final names, move existing finals to unique backup paths,
then replace staged files with `os.replace`. If any operation fails, remove any
new finals and restore every backup. Delete backups only after all replacements
succeed. In a `finally` block, delete the run staging directory with
`shutil.rmtree(staging, ignore_errors=True)`.

- [ ] **Step 3: Add Blender discovery and automatic Make calls**

Add:

```make
POCKET_CARD_BLEND_TEMPLATE := hardware/card/case/case_updated.blend
POCKET_CARD_BLEND_SCRIPT := $(POCKET_CARD_CASE_DIR)/emboss_shells.py
BLENDER ?= $(shell command -v blender 2>/dev/null)
ifeq ($(strip $(BLENDER)),)
  ifneq ($(wildcard /Applications/Blender.app/Contents/MacOS/Blender),)
    BLENDER := /Applications/Blender.app/Contents/MacOS/Blender
  endif
endif

.PHONY: pocket_card_case pocket_card_case_shells pocket_card_case_embossed

pocket_card_case_embossed:
	@test -n "$(BLENDER)" || (echo "Blender not found; set BLENDER=/path/to/blender" >&2; exit 1)
	$(BLENDER) --background $(POCKET_CARD_BLEND_TEMPLATE) --python-exit-code 1 --python $(POCKET_CARD_BLEND_SCRIPT)
```

Append `$(MAKE) pocket_card_case_embossed` after `build_variants.py` in both
existing case recipes, ensuring it cannot run in parallel with shell generation.

- [ ] **Step 4: Verify dry-run ordering and rollback test**

Run:

```bash
make -n pocket_card_case_shells
make -n pocket_card_case
python3 -m unittest hardware.pocket_card.case.test_emboss_shells -v
```

Expected: each Make dry run lists shell generation before one Blender command;
all integration tests pass, including byte-for-byte sentinel preservation.

- [ ] **Step 5: Commit transaction and build integration**

```bash
git add Makefile hardware/pocket_card/case/emboss_shells.py hardware/pocket_card/case/test_emboss_shells.py
git commit -m "build: automate Pocket Card Blender finishing"
```

### Task 5: Document, execute, and visually verify the real deliverable

**Files:**
- Modify: `hardware/pocket_card/case/README.md`
- Generate: `hardware/pocket_card/case/out/order/shell_front_embossed.stl`
- Generate: `hardware/pocket_card/case/out/order/shell_back_embossed.stl`
- Generate: `hardware/pocket_card/case/out/order/pocket_card_complete.blend`

- [ ] **Step 1: Document the automatic and direct workflows**

Add a `Blender finishing` subsection explaining that both existing Make targets
produce the three final files automatically, `make pocket_card_case_embossed`
reruns only Blender, `BLENDER=/path` overrides discovery, the template is never
saved, and failures preserve prior outputs. List the four collection/material
groups and the appended display source.

- [ ] **Step 2: Run the complete shells build**

Run:

```bash
make pocket_card_case_shells
```

Expected: CadQuery finishes first, Blender reports two closed shell exports and
a 14-object assembly, and the command exits 0.

- [ ] **Step 3: Verify artifacts and template immutability**

Run the integration test again, `git diff --check`, and compare the template
hash captured before the build. Expected: tests pass, no whitespace errors,
and `case_updated.blend` is unchanged.

- [ ] **Step 4: Inspect the real assembly in Blender**

Open `out/order/pocket_card_complete.blend` and confirm:

- the front/back shells align and show baked embossing;
- the display occupies its authored global position;
- all caps and tips align with their openings;
- the PCB aligns inside the case;
- colours are purple/white/yellow/green as specified; and
- Outliner contains only the four named collections and 14 mesh components.

- [ ] **Step 5: Commit documentation and intentional generated outputs**

Review `git status` first and preserve unrelated user files. Then stage only the
README and the three requested final deliverables if they are repository-tracked
outputs:

```bash
git add hardware/pocket_card/case/README.md \
  hardware/pocket_card/case/out/order/shell_front_embossed.stl \
  hardware/pocket_card/case/out/order/shell_back_embossed.stl \
  hardware/pocket_card/case/out/order/pocket_card_complete.blend
git commit -m "docs: ship automated Pocket Card Blender assembly"
```

If `.gitignore` intentionally excludes an output, report its absolute path
instead of forcing it into Git.
