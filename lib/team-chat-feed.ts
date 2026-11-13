interface IdentifiedMessage {
  id: number | string;
}

/** Database identity, never content, determines whether two messages are one row. */
export function upsertTeamChatMessages<T extends IdentifiedMessage>(current: readonly T[], incoming: readonly T[]): T[] {
  const rows = new Map<string, T>();
  for (const message of [...current, ...incoming]) rows.set(String(message.id), message);
  return [...rows.values()];
}

interface SnapshotToken {
  generation: number;
  request: number;
  revision: number;
}

/** Reapply live events arriving during a snapshot without keeping stale rows forever. */
export function createTeamChatReconciler<T extends IdentifiedMessage>() {
  let generation = 0;
  let request = 0;
  let revision = 0;
  const changes = new Map<string, { revision: number; message: T | null }>();
  return {
    reset() {
      generation += 1;
      request = 0;
      revision = 0;
      changes.clear();
    },
    beginSnapshot(): SnapshotToken {
      return { generation, request: ++request, revision };
    },
    upsert(message: T) {
      changes.set(String(message.id), { revision: ++revision, message });
    },
    remove(id: number | string) {
      changes.set(String(id), { revision: ++revision, message: null });
    },
    finishSnapshot(token: SnapshotToken, snapshot: readonly T[]): T[] | null {
      if (token.generation !== generation || token.request !== request) return null;
      const rows = new Map(upsertTeamChatMessages([], snapshot).map((message) => [String(message.id), message]));
      for (const [id, change] of changes) {
        if (change.revision > token.revision) {
          if (change.message) rows.set(id, change.message);
          else rows.delete(id);
        } else changes.delete(id);
      }
      return [...rows.values()];
    },
  };
}
