open Domain
open Syntax

type context = {
  glyphs : int list Names.t;
  property_names : string list;
  layers : Int_set.t Frozen_array.t;
  background_id : int option;
  background_layer : int option;
}

type compiled = { board : Board.t; diagnostics : diagnostic list }

let grid context rows =
  let first_line = match rows with [] -> 1 | first :: _ -> first.level_line in
  let issue ?line message =
    {
      location = Option.map (fun line -> { line; column = 1 }) line;
      severity = Error_severity;
      message;
    }
  in
  let rows =
    Array.of_list (List.map (fun (row : level_row) -> Array.of_list row.glyphs) rows)
  in
  let width = if Array.length rows = 0 then 0 else Array.length rows.(0) in
  if width = 0 || Array.exists (fun row -> Array.length row = 0) rows then
    Error [ issue ~line:first_line "A level must have nonempty rows" ]
  else
    let initial = Board.create ~width ~height:(Array.length rows) in
    let rec write x y board =
      if x = width then Ok board
      else if y = Array.length rows then write (x + 1) 0 board
      else
        let row = rows.(y) in
        let glyph = Code_unit.single_text row.(min x (Array.length row - 1)) in
        match Names.find_opt glyph context.glyphs with
        | None ->
            let message =
              if List.mem glyph context.property_names then
                "Error, symbol \"" ^ glyph
                ^ "\" is defined using OR, and therefore ambiguous - it cannot be used \
                   in a map. Did you mean to define it in terms of AND?"
              else "Error, symbol \"" ^ glyph ^ "\", used in map, not found."
            in
            Error { board; diagnostics = [ issue ~line:(first_line + y) message ] }
        | Some occupants ->
            write x (y + 1)
              (Board.set board (x, y)
                 { empty_cell with objects = Int_set.of_list occupants })
    in
    match write 0 0 initial with
    | Error partial -> Ok partial
    | Ok board ->
        let background_layer =
          Option.bind context.background_layer (fun layer ->
              if layer >= 0 && layer < Frozen_array.length context.layers then
                Some (Frozen_array.get context.layers layer)
              else None)
        in
        let fallback = Int_set.of_list (Option.to_list context.background_id) in
        let diagnostics, background =
          match background_layer with
          | None -> ([ issue "you have to have a background layer" ], fallback)
          | Some layer ->
              let selected =
                Board.positions ~vertical:true board
                |> List.find_map (fun position ->
                    let present =
                      Int_set.inter layer (Board.get board position).objects
                    in
                    if Int_set.is_empty present then None else Some present)
              in
              ([], Option.value ~default:fallback selected)
        in
        let board =
          Board.map
            (fun _ cell ->
              if
                Option.fold ~none:true
                  ~some:(fun layer -> Int_set.disjoint layer cell.objects)
                  background_layer
              then { cell with objects = Int_set.union background cell.objects }
              else cell)
            board
        in
        Ok { board; diagnostics }

let wrapped_lines units =
  let units = Array.of_list units in
  let length = Array.length units in
  let line_end unit = List.mem (Code_unit.value unit) [ 10; 13; 0x2028; 0x2029 ] in
  let rec visit index lines =
    if index >= length then lines
    else if line_end units.(index) then visit (index + 1) lines
    else
      let rec extent count =
        if count < 34 && index + count < length && not (line_end units.(index + count))
        then extent (count + 1)
        else count
      in
      let available = extent 0 in
      let rec word_end count =
        if count = 0 then None
        else if index + count = length then Some count
        else if Code_unit.whitespace units.(index + count) then Some (count + 1)
        else word_end (count - 1)
      in
      let consumed = Option.value ~default:available (word_end available) in
      visit (index + consumed) (lines + 1)
  in
  visit 0 0

let message authored =
  let text = Code_unit.text authored.message_units in
  let diagnostics =
    if wrapped_lines authored.message_units > 12 then
      [
        {
          location = Some { line = authored.message_line; column = 1 };
          severity = Warning_severity;
          message = "Message too long to fit on screen.";
        };
      ]
    else []
  in
  (text, diagnostics)
