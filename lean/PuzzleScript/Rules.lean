import PuzzleScript.BitVec

namespace PuzzleScript

structure LayerCoupledLayer where
  layerIndex : Nat
  objectMask : MaskWords
  movementsAny : MaskWords
  movementsPresent : MaskWords
  movementsMissing : MaskWords
  deriving Repr

structure LayerCoupledTerm where
  objectMask : MaskWords
  layers : Array LayerCoupledLayer
  deriving Repr

structure InferredPropertyBinding where
  propertyName : String
  dirMode : Nat
  dirMask : Nat
  deriving Repr

structure InferredPropertySource where
  propertyName : String
  deriving Repr

structure InferredAggregateBinding where
  aggregateName : String
  layerIndex : Option Nat
  propertyName : Option String
  deriving Repr

structure LayerCoupledMovementReplacement where
  layers : Array LayerCoupledLayer
  replacementAggregateName : Option String
  replacementMovementMask : Option Nat
  deriving Repr

structure PropertyAlias where
  objectId : Nat
  layerIndex : Nat
  deriving Repr

structure PropertyBinding where
  propertyName : String
  sourceRow : Nat
  sourceCell : Nat
  sourceMovementMode : Nat
  sourceMovementMask : Nat
  aliases : Array PropertyAlias
  deriving Repr

structure AggregateBinding where
  aggregateName : String
  sourceRow : Nat
  sourceCell : Nat
  aggregateMask : Nat
  sourceLayer : Option Nat
  sourcePropertyName : Option String
  deriving Repr

structure CellPattern where
  objectsPresent : MaskWords
  objectsMissing : MaskWords
  anyObjectsPresent : Array MaskWords
  anyMovementsPresent : Array MaskWords
  layerCoupledMovementMasks : Array LayerCoupledTerm
  movementsPresent : MaskWords
  movementsMissing : MaskWords
  hasReplacement : Bool
  objectsClear : MaskWords
  objectsSet : MaskWords
  movementsClear : MaskWords
  movementsSet : MaskWords
  movementsLayerMask : MaskWords
  randomEntityMask : MaskWords
  randomDirMask : MaskWords
  inferredPropertyBindings : Array InferredPropertyBinding
  inferredPropertySources : Array InferredPropertySource
  inferredAggregateBindings : Array InferredAggregateBinding
  layerCoupledMovementReplacements : Array LayerCoupledMovementReplacement
  deriving Repr

inductive PatternCell where
  | cell (cp : CellPattern)
  | ellipsis
  deriving Repr

inductive RowMatch where
  | fixed (start : Nat)
  | ellipsis1 (start gap : Nat)
  | ellipsis2 (start gap1 gap2 : Nat)
  deriving Repr, Inhabited

structure Rule where
  direction : Nat
  lineNumber : Nat
  groupNumber : Nat
  patternRows : Array (Array PatternCell)
  ellipsisCounts : Array Nat
  commands : Array String
  rigid : Bool
  isRandom : Bool
  propertyBindings : Array PropertyBinding
  aggregateBindings : Array AggregateBinding
  deriving Repr

structure WinCondition where
  quantifier : Int
  filter1 : MaskWords
  filter2 : MaskWords
  aggr1 : Bool
  aggr2 : Bool
  deriving Repr

/-- Captures filled when a rule tuple is applied (JS `propertyCaptures` / `aggregateCaptures`). -/
structure RuleCaptures where
  properties : Array (String × PropertyAlias)
  aggregates : Array (String × Nat)
  deriving Repr

def RuleCaptures.empty : RuleCaptures := { properties := #[], aggregates := #[] }

def RuleCaptures.getProperty (c : RuleCaptures) (name : String) : Option PropertyAlias :=
  c.properties.find? (·.1 == name) |>.map (·.2)

def RuleCaptures.setProperty (c : RuleCaptures) (name : String) (alias : PropertyAlias) : RuleCaptures :=
  let props := c.properties.filter (·.1 != name) |>.push (name, alias)
  { c with properties := props }

def RuleCaptures.getAggregate (c : RuleCaptures) (name : String) : Option Nat :=
  c.aggregates.find? (·.1 == name) |>.map (·.2)

def RuleCaptures.setAggregate (c : RuleCaptures) (name : String) (bits : Nat) : RuleCaptures :=
  let aggr := c.aggregates.filter (·.1 != name) |>.push (name, bits)
  { c with aggregates := aggr }

end PuzzleScript
