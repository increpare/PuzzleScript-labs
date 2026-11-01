import type { SoundIndex } from './commands.js';
import type { SourceLexicalToken } from './source-model.js';
import { SimpleSound } from './session-model.js';

export enum AcceptedSoundKind { Event, Target, BareEvent, BareTarget }
export enum SoundEventKind { Simple, SFX }
export type SoundEvent =
  | { readonly kind: SoundEventKind.Simple; readonly sound: SimpleSound; readonly token: SourceLexicalToken }
  | { readonly kind: SoundEventKind.SFX; readonly index: SoundIndex; readonly token: SourceLexicalToken };
export enum SoundVerb { Move, CantMove, Action, Create, Destroy }
export enum SoundDirectionFamily { Up, Down, Left, Right, Horizontal, Vertical, Orthogonal }
export interface SoundDirection { readonly family: SoundDirectionFamily; readonly token: SourceLexicalToken }
interface SoundVerbToken { readonly token: SourceLexicalToken }
export type DirectionalSoundVerb = SoundVerbToken & (
  { readonly kind: SoundVerb.Move; readonly directions: readonly SoundDirection[] }
  | { readonly kind: SoundVerb.CantMove; readonly directions: readonly SoundDirection[] });
export type OtherSoundVerb = SoundVerbToken & (
  { readonly kind: SoundVerb.Action } | { readonly kind: SoundVerb.Create } | { readonly kind: SoundVerb.Destroy });
export type SoundTargetVerb = DirectionalSoundVerb | OtherSoundVerb;
export enum SoundSeedKind { Numeric, Recovered }
export type SoundSeed = { readonly kind: SoundSeedKind; readonly token: SourceLexicalToken };
export type CompleteSound =
  | { readonly kind: AcceptedSoundKind.Event; readonly event: SoundEvent; readonly seed: SourceLexicalToken }
  | { readonly kind: AcceptedSoundKind.Target; readonly target: SourceLexicalToken; readonly verb: SoundTargetVerb; readonly seed: SoundSeed };
export type AcceptedSound = CompleteSound
  | { readonly kind: AcceptedSoundKind.BareEvent; readonly event: SoundEvent }
  | { readonly kind: AcceptedSoundKind.BareTarget; readonly target: SourceLexicalToken };

const events = new Map<string, SimpleSound>([
  ['titlescreen', SimpleSound.TitleScreen], ['startgame', SimpleSound.StartGame], ['endgame', SimpleSound.EndGame],
  ['startlevel', SimpleSound.StartLevel], ['endlevel', SimpleSound.EndLevel], ['undo', SimpleSound.Undo],
  ['restart', SimpleSound.Restart], ['showmessage', SimpleSound.ShowMessage], ['closemessage', SimpleSound.CloseMessage], ['cancel', SimpleSound.Cancel],
]);
const indices = new Map<string, SoundIndex>([
  ['sfx0', 0], ['sfx1', 1], ['sfx2', 2], ['sfx3', 3], ['sfx4', 4], ['sfx5', 5], ['sfx6', 6],
  ['sfx7', 7], ['sfx8', 8], ['sfx9', 9], ['sfx10', 10],
]);
/** Classify an event already accepted by the native event matcher. */
export function acceptedSoundEvent(token: SourceLexicalToken): SoundEvent {
  const sound = events.get(token.value);
  if (sound !== undefined) return { kind: SoundEventKind.Simple, sound, token };
  const index = indices.get(token.value);
  if (index !== undefined) return { kind: SoundEventKind.SFX, index, token };
  throw new Error('Accepted sound event has no event kind.');
}

const verbs = new Map<string, SoundVerb>([
  ['move', SoundVerb.Move], ['cantmove', SoundVerb.CantMove], ['action', SoundVerb.Action],
  ['create', SoundVerb.Create], ['destroy', SoundVerb.Destroy],
]);
export function acceptedSoundVerb(token: SourceLexicalToken): SoundTargetVerb {
  const kind = verbs.get(token.value);
  if (kind === undefined) throw new Error('Accepted sound verb has no verb kind.');
  return kind === SoundVerb.Move || kind === SoundVerb.CantMove ? { kind, token, directions: [] } : { kind, token };
}
const families = new Map<string, SoundDirectionFamily>([
  ['up', SoundDirectionFamily.Up], ['down', SoundDirectionFamily.Down], ['left', SoundDirectionFamily.Left],
  ['right', SoundDirectionFamily.Right], ['horizontal', SoundDirectionFamily.Horizontal],
  ['vertical', SoundDirectionFamily.Vertical], ['orthogonal', SoundDirectionFamily.Orthogonal],
]);
export function acceptedSoundDirection(token: SourceLexicalToken): SoundDirection {
  const family = families.get(token.value);
  if (family === undefined) throw new Error('Accepted sound direction has no direction family.');
  return { family, token };
}

/** Bind every retained lexical token to its authored identity once. */
export function bindSoundSyntax(definition: AcceptedSound, bind: (token: SourceLexicalToken) => SourceLexicalToken): AcceptedSound {
  switch (definition.kind) {
    case AcceptedSoundKind.BareEvent: return { ...definition, event: { ...definition.event, token: bind(definition.event.token) } };
    case AcceptedSoundKind.BareTarget: return { ...definition, target: bind(definition.target) };
    case AcceptedSoundKind.Event: return { ...definition, event: { ...definition.event, token: bind(definition.event.token) }, seed: bind(definition.seed) };
    case AcceptedSoundKind.Target: {
      const verb = definition.verb;
      return { ...definition, target: bind(definition.target), seed: { ...definition.seed, token: bind(definition.seed.token) },
        verb: verb.kind === SoundVerb.Move || verb.kind === SoundVerb.CantMove
          ? { ...verb, token: bind(verb.token), directions: verb.directions.map(direction => ({ ...direction, token: bind(direction.token) })) }
          : { ...verb, token: bind(verb.token) } };
    }
  }
}
