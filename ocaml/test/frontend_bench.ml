open Puzzlescript

type stage = Parse | Compile

let read path =
  let channel = open_in_bin path in
  Fun.protect
    ~finally:(fun () -> close_in channel)
    (fun () -> really_input_string channel (in_channel_length channel))

let () =
  let stage = ref Compile and iterations = ref 20 and paths = ref [] in
  Arg.parse
    [
      ( "--stage",
        Arg.Symbol
          ( [ "parse"; "compile" ],
            function "parse" -> stage := Parse | _ -> stage := Compile ),
        "Frontend stage" );
      ("--iterations", Arg.Set_int iterations, "Repetitions per source");
    ]
    (fun path -> paths := path :: !paths)
    "frontend_bench [OPTIONS] SOURCE ...";
  if !iterations <= 0 || !paths = [] then
    invalid_arg "Provide sources and positive iterations";
  let sources = List.rev_map (fun path -> (path, read path)) !paths in
  let observe source =
    match !stage with
    | Parse -> (
        match Parser.parse source with
        | Error issues -> -1 - List.length issues
        | Ok document ->
            List.length document.objects + List.length document.rules
            + List.length document.levels)
    | Compile -> (
        match Compiler.source source with
        | Error issues -> -1 - List.length issues
        | Ok compiled ->
            Frozen_array.length compiled.game.objects
            + Frozen_array.length compiled.game.early.groups
            + Frozen_array.length compiled.game.late.groups
            + Frozen_array.length compiled.game.levels)
  in
  let observations = List.map (fun (path, source) -> (path, observe source)) sources in
  Gc.full_major ();
  let cpu = Sys.time ()
  and wall = Unix.gettimeofday ()
  and allocated = Gc.allocated_bytes () in
  let checksum = ref 0 in
  for _ = 1 to !iterations do
    List.iter (fun (_, source) -> checksum := !checksum + observe source) sources
  done;
  let cpu = Sys.time () -. cpu and wall = Unix.gettimeofday () -. wall in
  let allocated = Gc.allocated_bytes () -. allocated in
  let open Json in
  print_endline
    (to_string
       (Object
          [
            ("stage", String (match !stage with Parse -> "parse" | Compile -> "compile"));
            ("iterations", Int !iterations);
            ("sources", Int (List.length sources));
            ("cpuSeconds", Float cpu);
            ("wallSeconds", Float wall);
            ("allocatedBytes", Float allocated);
            ("checksum", Int !checksum);
            ( "observations",
              Array
                (List.map
                   (fun (path, value) ->
                     Object [ ("file", String path); ("signature", Int value) ])
                   observations) );
          ]))
