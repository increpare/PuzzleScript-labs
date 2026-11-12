open Syntax
module Names = Domain.Names
module Slots = Domain.Int_map

(* Preserve insertion order, with canonical unsigned integer keys first, as at
   the compatibility boundary. Values and updates are ordinary persistent maps. *)
module Table = struct
  type 'a t = { values : 'a Names.t; insertion : string list }

  let empty = { values = Names.empty; insertion = [] }
  let find name table = Names.find_opt name table.values

  let add name value table =
    {
      values = Names.add name value table.values;
      insertion =
        (if Names.mem name table.values then table.insertion
         else table.insertion @ [ name ]);
    }

  let remove name table =
    {
      values = Names.remove name table.values;
      insertion = List.filter (( <> ) name) table.insertion;
    }

  let keys table =
    let index name =
      match Int64.of_string_opt name with
      | Some n when n >= 0L && n < 4294967295L && Int64.to_string n = name -> Some n
      | _ -> None
    in
    List.stable_sort
      (fun left right ->
        match (index left, index right) with
        | Some a, Some b -> Int64.compare a b
        | Some _, None -> -1
        | None, Some _ -> 1
        | None, None -> 0)
      table.insertion
end

type t = {
  aliases : string Table.t;
  properties : int Table.t;
  aggregates : int Table.t;
  slots : string list Slots.t;
  next_slot : int;
}

type kind = Property_kind | Aggregate_kind

let table kind state =
  match kind with Property_kind -> state.properties | Aggregate_kind -> state.aggregates

let update kind entries state =
  match kind with
  | Property_kind -> { state with properties = entries }
  | Aggregate_kind -> { state with aggregates = entries }

let opposite = function
  | Property_kind -> Aggregate_kind
  | Aggregate_kind -> Property_kind

let spelling = function Property_kind -> "property" | Aggregate_kind -> "aggregate"
let alias state name = Table.find name state.aliases

let compound kind state name =
  Option.map
    (fun slot -> Slots.find slot state.slots)
    (Table.find name (table kind state))

let property = compound Property_kind
let aggregate = compound Aggregate_kind

let names state =
  Table.keys state.aliases @ Table.keys state.properties @ Table.keys state.aggregates
  |> List.sort_uniq String.compare

let share kind name slot state =
  update kind (Table.add name slot (table kind state)) state

let allocate kind name members state =
  let slot = state.next_slot in
  share kind name slot
    { state with slots = Slots.add slot members state.slots; next_slot = slot + 1 }

module States = Set.Make (struct
  type nonrec t = t

  let compare = compare
end)

let compile declarations =
  let diagnostics = ref [] in
  let report message =
    diagnostics :=
      Diagnostics.normalize
        (!diagnostics @ [ { location = None; severity = Error_severity; message } ])
  in
  let initial =
    {
      aliases = Table.empty;
      properties = Table.empty;
      aggregates = Table.empty;
      slots = Slots.empty;
      next_slot = 0;
    }
  in
  let initial =
    List.fold_left
      (fun state declaration ->
        match declaration.expression with
        | Constituents members ->
            allocate Aggregate_kind declaration.legend_name members state
        | _ -> state)
      initial declarations
  in
  let initial =
    List.fold_left
      (fun state declaration ->
        match declaration.expression with
        | Alternatives members ->
            allocate Property_kind declaration.legend_name members state
        | _ -> state)
      initial declarations
  in
  let initial =
    List.fold_left
      (fun state declaration ->
        match declaration.expression with
        | Alias target -> (
            match
              (Table.find target state.aggregates, Table.find target state.properties)
            with
            | Some slot, _ -> share Aggregate_kind declaration.legend_name slot state
            | None, Some slot -> share Property_kind declaration.legend_name slot state
            | None, None when declaration.legend_name <> target ->
                {
                  state with
                  aliases = Table.add declaration.legend_name target state.aliases;
                }
            | None, None -> state)
        | _ -> state)
      initial declarations
  in
  let expand kind state =
    List.fold_left
      (fun (state, changed) name ->
        let slot = Option.get (Table.find name (table kind state)) in
        let rec visit index state changed =
          let values = Slots.find slot state.slots in
          match List.nth_opt values index with
          | None -> (state, changed)
          | Some value ->
              let state, changed =
                match alias state value with
                | Some target ->
                    let values =
                      List.mapi
                        (fun i value -> if i = index then target else value)
                        values
                    in
                    ({ state with slots = Slots.add slot values state.slots }, true)
                | None -> (
                    match Table.find value (table kind state) with
                    | None -> (state, changed)
                    | Some target_slot ->
                        let values = List.filteri (fun i _ -> i <> index) values in
                        let state =
                          { state with slots = Slots.add slot values state.slots }
                        in
                        let values =
                          List.fold_left
                            (fun values member ->
                              if List.mem member values then values
                              else values @ [ member ])
                            values
                            (Slots.find target_slot state.slots)
                        in
                        ({ state with slots = Slots.add slot values state.slots }, true))
              in
              if Table.find value (table (opposite kind) state) <> None then
                report
                  ("Trying to define " ^ spelling kind ^ " \"" ^ Utf8.uppercase name
                 ^ "\" in terms of "
                  ^ spelling (opposite kind)
                  ^ " \"" ^ Utf8.uppercase value ^ "\".");
              visit (index + 1) state changed
        in
        visit 0 state changed)
      (state, false)
      (Table.keys (table kind state))
  in
  let rec normalize seen state =
    if States.mem state seen then (
      report "Cyclic legend expansion";
      Error !diagnostics)
    else
      let seen = States.add state seen in
      let state, promoted =
        List.fold_left
          (fun (state, promoted) name ->
            let target = Option.get (alias state name) in
            match
              (Table.find target state.properties, Table.find target state.aggregates)
            with
            | Some slot, _ ->
                ( share Property_kind name slot
                    { state with aliases = Table.remove name state.aliases },
                  true )
            | None, Some slot ->
                ( share Aggregate_kind name slot
                    { state with aliases = Table.remove name state.aliases },
                  true )
            | None, None -> (
                match alias state target with
                | None -> (state, promoted)
                | Some target ->
                    ( { state with aliases = Table.add name target state.aliases },
                      promoted )))
          (state, false) (Table.keys state.aliases)
      in
      let state, properties_changed = expand Property_kind state in
      let state, aggregates_changed = expand Aggregate_kind state in
      (* Alias-to-alias updates do not request another pass in vanilla. Retain
         that distinction instead of silently computing a transitive closure. *)
      if promoted || properties_changed || aggregates_changed then normalize seen state
      else Ok (state, !diagnostics)
  in
  normalize States.empty initial
