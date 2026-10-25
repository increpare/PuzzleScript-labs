export enum CommandKind {
  Cancel,
  Restart,
  Win,
  Checkpoint,
  Again,
  Message,
  Sound,
}

export type SoundIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type Command =
  | { readonly kind: CommandKind.Message; readonly text: string }
  | { readonly kind: CommandKind.Sound; readonly index: SoundIndex }
  | { readonly kind: CommandKind.Cancel | CommandKind.Restart | CommandKind.Win | CommandKind.Checkpoint | CommandKind.Again };

export interface QueuedCommand<Source> {
  readonly command: Command;
  readonly source: Source;
}

export interface CommandState<Source> {
  readonly entries: readonly QueuedCommand<Source>[];
  readonly message: string;
}

/** Queue one matched rule's commands without changing an earlier snapshot. */
export function queueCommands<Source>(
  before: CommandState<Source>,
  source: Source,
  commands: readonly Command[],
): CommandState<Source> {
  let entries: QueuedCommand<Source>[] = [];
  for (const entry of before.entries) {
    entries.push({ command: entry.command, source: entry.source });
  }
  let message = before.message;

  if (commands.length === 0) return { entries, message };

  let existingCancel = false;
  let existingRestart = false;
  for (const entry of entries) {
    if (entry.command.kind === CommandKind.Cancel) existingCancel = true;
    if (entry.command.kind === CommandKind.Restart) existingRestart = true;
  }

  let incomingCancel = false;
  let incomingRestart = false;
  for (const command of commands) {
    if (command.kind === CommandKind.Cancel) incomingCancel = true;
    if (command.kind === CommandKind.Restart) incomingRestart = true;
  }

  // Priority applies to whole rule lists, including any other commands in them.
  if (existingCancel || (existingRestart && !incomingCancel)) {
    return { entries, message };
  }
  if (incomingCancel || incomingRestart) {
    entries = [];
    message = '';
  }

  for (const command of commands) {
    let alreadyQueued = false;
    for (const entry of entries) {
      const queued = entry.command;
      if (queued.kind !== command.kind) continue;
      // Each sfx index is its own name; all message payloads share one name.
      if (queued.kind === CommandKind.Sound && command.kind === CommandKind.Sound
        && queued.index !== command.index) continue;
      alreadyQueued = true;
      break;
    }
    if (alreadyQueued) continue;

    entries.push({ command, source });
    if (command.kind === CommandKind.Message) message = command.text;
  }

  return { entries, message };
}
