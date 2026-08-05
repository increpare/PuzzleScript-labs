"""Read-only Python adapter for the canonical controller connectivity model."""
import copy
import json
import os


_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "schematic", "connectivity.json",
)
with open(_MODEL_PATH, encoding="utf-8") as _handle:
    _MODEL = json.load(_handle)

_COMPONENTS = {item["ref"]: item for item in _MODEL["components"]}
_PAD_NETS = {}
for _connection in _MODEL["connections"]:
    for _ref, _pad in _connection["nodes"]:
        _PAD_NETS[(_ref, str(_pad))] = _connection["net"]


def model():
    return copy.deepcopy(_MODEL)


def component(ref):
    try:
        return copy.deepcopy(_COMPONENTS[ref])
    except KeyError:
        raise KeyError("unknown component reference %r" % ref) from None


def component_uuid(ref):
    return component(ref)["uuid"]


def pad_net_map():
    return dict(_PAD_NETS)


def board_only_rules():
    return copy.deepcopy(_MODEL.get("boardOnlyPadRules", []))


def assignments_for(ref):
    component(ref)
    return {pad: net_name for (node_ref, pad), net_name in _PAD_NETS.items()
            if node_ref == ref}


__all__ = [
    "model", "component", "component_uuid", "pad_net_map",
    "board_only_rules", "assignments_for",
]
