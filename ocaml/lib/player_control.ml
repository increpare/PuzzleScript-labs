type transition = Idle | Leaving_title | Closing_message | Leaving_both
type action_gate = Fresh_press_required | Repeats_allowed
type title_phase = Title_idle | Title_departure_pending

(* A new message can replace a selected one while its old close transition is
   still pending. Selection and pending closure therefore have four real states. *)
type message_phase =
  | Selectable
  | Closing_selected
  | Closing_unselected
  | Selection_consumed

type t = { action : action_gate; title : title_phase; message : message_phase }
type action_result = Blocked | Accepted of t

let initial = { action = Fresh_press_required; title = Title_idle; message = Selectable }
let title_pending state = state.title = Title_departure_pending

let message_pending state =
  match state.message with Closing_selected | Closing_unselected -> true | _ -> false

let message_selected state =
  match state.message with Closing_selected | Selection_consumed -> true | _ -> false

let ignore_held_action state = state.action = Fresh_press_required

let transition state =
  match (title_pending state, message_pending state) with
  | false, false -> Idle
  | true, false -> Leaving_title
  | false, true -> Closing_message
  | true, true -> Leaving_both

let require_fresh state = { state with action = Fresh_press_required }

let press_action ~repeated ~repeat_disabled state =
  if repeated && (ignore_held_action state || repeat_disabled) then Blocked
  else if repeated then Accepted state
  else Accepted { state with action = Repeats_allowed }

let reset_message_selection state =
  let message = if message_pending state then Closing_unselected else Selectable in
  { state with message }

let open_message state = reset_message_selection state |> require_fresh

let select_title state =
  { (reset_message_selection state) with title = Title_departure_pending }

let select_message state = { state with title = Title_idle; message = Closing_selected }
let finish_title state = { state with title = Title_idle; action = Fresh_press_required }

let finish_message state =
  let message =
    match state.message with
    | Closing_selected -> Selection_consumed
    | Closing_unselected -> Selectable
    | (Selectable | Selection_consumed) as phase -> phase
  in
  { state with message; action = Fresh_press_required }
