import { Movement, TurnInput } from './model.js';

/** Adapt the public movement-or-null input to a calculation's input domain. */
export function movementInput(input: Movement | null): TurnInput {
  switch (input) {
    case null: return TurnInput.None;
    case Movement.Up: return TurnInput.Up;
    case Movement.Down: return TurnInput.Down;
    case Movement.Left: return TurnInput.Left;
    case Movement.Right: return TurnInput.Right;
    case Movement.Action: return TurnInput.Action;
  }
}
