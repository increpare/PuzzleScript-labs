"""Read-only Python adapter for the canonical controller connectivity model."""
import copy
import json
import os
import re


_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "schematic", "connectivity.json",
)


def _invalid(path, field, problem):
    raise ValueError("%s: field %s %s" % (path, field, problem))


def _required_nonempty_string(value, path, field):
    if not isinstance(value, str) or not value:
        _invalid(path, field, "must be a nonempty string")


def _load_model(path):
    """Load and validate every model field consumed by PCB generation."""
    try:
        with open(path, encoding="utf-8") as handle:
            candidate = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("%s: cannot load connectivity.json: %s"
                         % (path, error)) from error

    if not isinstance(candidate, dict):
        _invalid(path, "root", "must be an object")

    required_shapes = {
        "components": list,
        "connections": list,
        "noConnects": dict,
        "boardOnlyPadRules": list,
    }
    for field, expected_type in required_shapes.items():
        if field not in candidate:
            _invalid(path, field, "is required")
        if not isinstance(candidate[field], expected_type):
            shape = "an object" if expected_type is dict else "a list"
            _invalid(path, field, "must be %s" % shape)

    component_fields = ("ref", "value", "footprint", "uuid", "symbol")
    refs = set()
    uuids = set()
    for index, item in enumerate(candidate["components"]):
        base = "components[%d]" % index
        if not isinstance(item, dict):
            _invalid(path, base, "must be an object")
        for field in component_fields:
            field_path = "%s.%s" % (base, field)
            if field not in item:
                _invalid(path, field_path, "is required")
            _required_nonempty_string(item[field], path, field_path)
        if not re.search(r"[0-9]$", item["ref"]):
            _invalid(path, base + ".ref",
                     "uses %s, which is not fully annotated; references must end in a digit"
                     % item["ref"])
        if item["ref"] in refs:
            _invalid(path, base + ".ref",
                     "has duplicate component ref %s" % item["ref"])
        if item["uuid"] in uuids:
            _invalid(path, base + ".uuid",
                     "has duplicate component UUID %s" % item["uuid"])
        refs.add(item["ref"])
        uuids.add(item["uuid"])

    nets = set()
    endpoints = {}
    for connection_index, connection in enumerate(candidate["connections"]):
        base = "connections[%d]" % connection_index
        if not isinstance(connection, dict):
            _invalid(path, base, "must be an object")
        for field in ("net", "nodes"):
            if field not in connection:
                _invalid(path, "%s.%s" % (base, field), "is required")
        _required_nonempty_string(connection["net"], path, base + ".net")
        if not isinstance(connection["nodes"], list):
            _invalid(path, base + ".nodes", "must be a list")
        if len(connection["nodes"]) < 2:
            _invalid(path, base + ".nodes", "must contain at least two nodes")
        if connection["net"] in nets:
            _invalid(path, base + ".net",
                     "has duplicate connection net %s" % connection["net"])
        nets.add(connection["net"])

        for node_index, node in enumerate(connection["nodes"]):
            node_path = "%s.nodes[%d]" % (base, node_index)
            if not isinstance(node, list) or len(node) != 2:
                _invalid(path, node_path, "must be a [ref, pad] pair")
            if (not isinstance(node[0], str) or not node[0]
                    or not isinstance(node[1], str) or not node[1]):
                _invalid(path, node_path,
                         "ref and pad must be nonempty strings")
            ref, pad = node
            if ref not in refs:
                _invalid(path, node_path,
                         "uses unknown component ref %s" % ref)
            endpoint = (ref, pad)
            if endpoint in endpoints:
                previous_net = endpoints[endpoint]
                if previous_net == connection["net"]:
                    _invalid(
                        path, node_path,
                        "has duplicate endpoint %s.%s on net %s"
                        % (ref, pad, connection["net"]))
                _invalid(
                    path, node_path,
                    "has endpoint %s.%s on both nets %s and %s"
                    % (ref, pad, previous_net, connection["net"]))
            endpoints[endpoint] = connection["net"]

    no_connect_endpoints = set()
    for ref, pads in candidate["noConnects"].items():
        field = "noConnects.%s" % ref
        _required_nonempty_string(ref, path, "noConnects component ref")
        if ref not in refs:
            _invalid(path, field, "uses unknown component ref %s" % ref)
        if not isinstance(pads, list):
            _invalid(path, field, "must be a list")
        for index, pad in enumerate(pads):
            pad_path = "%s[%d]" % (field, index)
            _required_nonempty_string(pad, path, pad_path)
            endpoint = (ref, pad)
            if endpoint in no_connect_endpoints:
                _invalid(path, pad_path,
                         "has duplicate no-connect endpoint %s.%s" % endpoint)
            if endpoint in endpoints:
                _invalid(path, pad_path,
                         "has endpoint %s.%s both connected and no-connect"
                         % endpoint)
            no_connect_endpoints.add(endpoint)

    board_only_targets = set()
    for index, rule in enumerate(candidate["boardOnlyPadRules"]):
        base = "boardOnlyPadRules[%d]" % index
        if not isinstance(rule, dict):
            _invalid(path, base, "must be an object")
        for field in ("ref", "pad", "net", "reason"):
            field_path = "%s.%s" % (base, field)
            if field not in rule:
                _invalid(path, field_path, "is required")
            if not isinstance(rule[field], str):
                _invalid(path, field_path, "must be a string")
        for field in ("ref", "net", "reason"):
            _required_nonempty_string(rule[field], path, "%s.%s" % (base, field))
        if rule["ref"] not in refs:
            _invalid(path, base,
                     "board-only rule uses unknown component %s" % rule["ref"])
        target = (rule["ref"], rule["pad"])
        target_name = ("%s empty-name pad" % rule["ref"] if rule["pad"] == ""
                       else "%s.%s" % target)
        if target in endpoints:
            _invalid(path, base,
                     "board-only target %s is already connected" % target_name)
        if target in board_only_targets:
            _invalid(path, base,
                     "has duplicate board-only rule target %s" % target_name)
        board_only_targets.add(target)

    return candidate


_MODEL = _load_model(os.path.normpath(_MODEL_PATH))

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
    return copy.deepcopy(_MODEL["boardOnlyPadRules"])


def assignments_for(ref):
    component(ref)
    return {pad: net_name for (node_ref, pad), net_name in _PAD_NETS.items()
            if node_ref == ref}


__all__ = [
    "model", "component", "component_uuid", "pad_net_map",
    "board_only_rules", "assignments_for",
]
