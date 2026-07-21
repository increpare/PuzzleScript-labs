import PuzzleScript.BitVec
import PuzzleScript.Command
import PuzzleScript.Ids

namespace PuzzleScript

/-- Rule scan/apply direction bitfield (JS `rule.direction`; may be omni / multi-bit). -/
structure RuleDir where
  bits : UInt32
  deriving DecidableEq, Repr, Inhabited

def RuleDir.ofNat (n : Nat) : RuleDir :=
  ⟨UInt32.ofNat n⟩

def RuleDir.toNat (d : RuleDir) : Nat :=
  d.bits.toNat

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
  objectId : ObjectId
  layerIndex : LayerIdx
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
  direction : RuleDir
  lineNumber : Nat
  groupNumber : Nat
  patternRows : Array (Array PatternCell)
  ellipsisCounts : Array Nat
  commands : Array Command
  rigid : Bool
  isRandom : Bool
  propertyBindings : Array PropertyBinding
  aggregateBindings : Array AggregateBinding
  deriving Repr

/-- Compiled-IR effect summary for a cell pattern (T3; mirrors JS command_only intent). -/
structure PatternEffect where
  clearsObjects : Bool
  setsObjects : Bool
  writesMovement : Bool
  randomObject : Bool
  randomDir : Bool
  deriving Repr, DecidableEq

def CellPattern.effect (p : CellPattern) : PatternEffect :=
  { clearsObjects := maskAnyBits p.objectsClear
    setsObjects := maskAnyBits p.objectsSet
    -- `movementsLayerMask` is OR'd into movement clear on apply (Runtime.applyCellReplacement).
    writesMovement :=
      maskAnyBits p.movementsClear || maskAnyBits p.movementsSet
        || maskAnyBits p.movementsLayerMask
        || !p.layerCoupledMovementReplacements.isEmpty
    randomObject := maskAnyBits p.randomEntityMask
    randomDir := maskAnyBits p.randomDirMask }

def PatternEffect.mutatesBoard (e : PatternEffect) : Bool :=
  e.clearsObjects || e.setsObjects || e.writesMovement || e.randomObject || e.randomDir

/-- Inferred property/aggregate rewrites also mutate at apply time. -/
def CellPattern.hasInferredMutators (p : CellPattern) : Bool :=
  !p.inferredPropertyBindings.isEmpty
    || !p.inferredPropertySources.isEmpty
    || !p.inferredAggregateBindings.isEmpty

def PatternCell.mutatesBoard : PatternCell → Bool
  | .ellipsis => false
  | .cell p =>
      p.hasReplacement
        && (p.effect.mutatesBoard || p.hasInferredMutators)

/-- No cell in the rule writes objects/movements (compiled IR). -/
def Rule.cellsDoNotMutate (r : Rule) : Bool :=
  r.patternRows.all (fun row => row.all (fun c => !c.mutatesBoard))

/-- Preconditions for command-only aside from per-cell mutation checks. -/
def Rule.commandOnlyMeta (r : Rule) : Bool :=
  !r.commands.isEmpty
    && !r.isRandom
    && !r.rigid
    && r.propertyBindings.isEmpty
    && r.aggregateBindings.isEmpty

/--
JS `tags.command_only` for compiled IR: nonempty commands and no object/movement writes
on any replacement cell. Excludes random/rigid rules and property/aggregate bindings
(those rewrite masks via inferred fields / rigid masks).
-/
def Rule.isCommandOnly (r : Rule) : Bool :=
  r.commandOnlyMeta && r.cellsDoNotMutate

/-- JS `tags.inert_command_only`: command-only and every command is sfx/message. -/
def Rule.syntacticInertCommandOnly (r : Rule) : Bool :=
  r.isCommandOnly && PuzzleScript.syntacticInertCommandOnly r.commands

theorem Rule.isCommandOnly_implies_cellsDoNotMutate (r : Rule) (h : r.isCommandOnly = true) :
    r.cellsDoNotMutate = true :=
  (Bool.and_eq_true_iff.mp h).2

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
