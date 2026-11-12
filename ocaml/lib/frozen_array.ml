type 'a t = 'a array

let of_list = Array.of_list
let of_array = Array.copy
let to_list = Array.to_list
let to_array = Array.copy
let length = Array.length
let get = Array.get
let iter = Array.iter
let mapi = Array.mapi
let fold_left = Array.fold_left

let fold_lefti f initial values =
  let rec visit index state =
    if index = Array.length values then state
    else visit (index + 1) (f state index values.(index))
  in
  visit 0 initial

let find_opt = Array.find_opt
