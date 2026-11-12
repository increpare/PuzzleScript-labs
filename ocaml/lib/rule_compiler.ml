open Syntax

type prepared = {
  entries : rule_entry list;
  early : Domain.schedule;
  late : Domain.schedule;
}

let reporters diagnostics =
  let report line message =
    Compile_diagnostics.report diagnostics ~line Error_severity message
  in
  let warn line message =
    Compile_diagnostics.report diagnostics ~line Warning_severity message
  in
  (report, warn)

let prepare ~diagnostics (declarations : Source_declarations.t) document =
  let report, warn = reporters diagnostics in
  let parsed =
    Source_rules.compile ~known_names:document.rule_names
      ~is_property:(fun name ->
        Compiled_names.property declarations.compiled_names name <> None)
      ~sounds:document.sounds document.rules
  in
  Compile_diagnostics.add diagnostics parsed.diagnostics;
  if parsed.invalid_shapes then raise Compile_diagnostics.Stop;
  let entries, issues = Rule_checks.recover declarations parsed.entries in
  Compile_diagnostics.add diagnostics issues;
  let bound = Rule_expansion.compile ~report declarations entries in
  let variants =
    List.filter_map (Rule_lowering.compile ~report ~warn declarations) bound
  in
  let early = Rule_schedule.schedule ~report variants ~late:false in
  let late = Rule_schedule.schedule ~report variants ~late:true in
  Rule_schedule.check_gaps ~report ~warn early;
  Rule_schedule.check_gaps ~report ~warn late;
  Rule_schedule.check_rigid_limit ~report early;
  { entries; early; late }

let finish ~diagnostics prepared =
  let report, _ = reporters diagnostics in
  let pairs = Rule_schedule.loop_pairs ~report prepared.entries in
  let early = Rule_schedule.attach_loops ~report pairs prepared.early in
  let late = Rule_schedule.attach_loops ~report pairs prepared.late in
  (early, late)
