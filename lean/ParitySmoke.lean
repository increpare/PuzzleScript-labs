import PuzzleScript

def main (args : List String) : IO UInt32 := do
  IO.println s!"{PuzzleScript.hello} args={args}"
  pure 0
