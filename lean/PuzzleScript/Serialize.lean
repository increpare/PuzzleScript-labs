import PuzzleScript.Board

namespace PuzzleScript

/-- Mirror of `convertLevelToString` in `src/js/debug.js`. -/
def serializeLevel (idDict : Array String) (b : Board) : String :=
  Id.run do
    let mut out : String := ""
    let mut seen : Array String := #[]
    for y in [:b.height] do
      for x in [:b.width] do
        let tile := x + y * b.width
        let cell := b.cellObjWords tile
        let mut objs : Array String := #[]
        let maxBit := 32 * b.strideObj
        for bit in [:maxBit] do
          if maskGetBit cell bit then
            let name := idDict.getD bit s!"obj{bit}"
            objs := objs.push name
        let sorted := objs.qsort fun a b => a < b
        let key := String.intercalate " " sorted.toList
        let idx : Nat :=
          match seen.findIdx? (· == key) with
          | some i => i
          | none => seen.size
        if idx == seen.size then
          seen := seen.push key
          out := out ++ key ++ ":"
        out := out ++ toString idx ++ ","
      out := out.push '\n'
    pure out

end PuzzleScript
