"""Cut the button region out of the reference DMG-01 front shell.

Produces a printable coupon of the *actual* reference geometry, with no
dimensions transcribed by hand. Print it, drop real DMG membranes and caps in,
and you learn whether the reference model matches real parts -- independently
of whether our own parametric rebuild is correct.

Run:  /Applications/Blender.app/Contents/MacOS/Blender -b -P cut_reference_coupon.py
"""
import bpy, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SRC  = os.path.join(REPO, "hardware", "DMG-01-Shell-Coffee", "STL", "DMG-01_Front_v54.stl")
OUT  = os.path.join(HERE, "out", "reference_button_coupon.stl")

# Region of interest in DMG model coordinates (mm).
# X width (-45 left .. +45 right, viewed from front), Y depth (0 = outer face,
# negative = into the shell), Z height (+74 = button end of the body).
X0, X1 = -43.0, 41.0
Z0, Z1 =  10.0, 57.0
Y0, Y1 =  -8.0,  1.0     # keep the 2.30 face plus the 6.25-deep collars

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.stl_import(filepath=SRC)
shell = bpy.context.selected_objects[0]
shell.name = "shell"

bpy.ops.mesh.primitive_cube_add(size=1)
box = bpy.context.active_object
box.name = "roi"
box.scale = (X1-X0, Y1-Y0, Z1-Z0)   # STL imports at 1 unit = 1 mm
box.location = ((X0+X1)/2, (Y0+Y1)/2, (Z0+Z1)/2)

m = shell.modifiers.new("cut", "BOOLEAN")
m.operation = "INTERSECT"
m.object = box
m.solver = "EXACT"

bpy.context.view_layer.objects.active = shell
bpy.ops.object.modifier_apply(modifier="cut")
box.select_set(True); shell.select_set(False)
bpy.ops.object.delete()

shell.select_set(True)
bpy.context.view_layer.objects.active = shell
bpy.ops.wm.stl_export(filepath=OUT, export_selected_objects=True)

d = shell.dimensions
print("COUPON_SIZE_MM %.2f %.2f %.2f" % (d.x, d.y, d.z))
print("COUPON_VERTS %d" % len(shell.data.vertices))
print("WROTE " + OUT)
