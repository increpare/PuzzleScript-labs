type t = { i : int; j : int; permutation : int array }

let create seed =
  if seed = "" then invalid_arg "a random seed must be nonempty";
  let bytes =
    Utf8.utf16 seed
    |> List.concat_map (fun unit ->
        if unit < 256 then [ unit ] else [ unit lsr 8; unit land 255 ])
    |> Array.of_list
  in
  let permutation = Array.init 256 Fun.id in
  let j = ref 0 in
  for i = 0 to 255 do
    j := (!j + permutation.(i) + bytes.(i mod Array.length bytes)) land 255;
    let old = permutation.(i) in
    permutation.(i) <- permutation.(!j);
    permutation.(!j) <- old
  done;
  { i = 0; j = 0; permutation }

let bytes count before =
  if count < 0 then invalid_arg "random byte count must be nonnegative";
  let permutation = Array.copy before.permutation in
  let rec loop count i j acc =
    if count = 0 then (List.rev acc, { i; j; permutation })
    else
      let i = (i + 1) land 255 in
      let j = (j + permutation.(i)) land 255 in
      let old = permutation.(i) in
      permutation.(i) <- permutation.(j);
      permutation.(j) <- old;
      let byte = permutation.((permutation.(i) + permutation.(j)) land 255) in
      loop (count - 1) i j (byte :: acc)
  in
  loop count before.i before.j []

let draw before =
  let output, after = bytes 7 before in
  let value = List.fold_left (fun a b -> (a *. 256.) +. float_of_int b) 0. output in
  (value /. ((256. ** 7.) -. 1.), after)

let choose count before =
  if count <= 0 then invalid_arg "cannot choose from an empty collection";
  let value, after = draw before in
  let index = int_of_float (floor (value *. float_of_int count)) in
  if index < 0 || index >= count then
    invalid_arg "legacy random choice rounded outside its candidates";
  (index, after)

let indices s = (s.i, s.j)
let permutation s = Array.to_list s.permutation
let preview count s = fst (bytes count s)
let equal a b = a.i = b.i && a.j = b.j && a.permutation = b.permutation
