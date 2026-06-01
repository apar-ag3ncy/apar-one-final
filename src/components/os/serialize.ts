// localStorage serialization helpers for the OS demo.
//
// `JSON.stringify` throws on bigint. Money is stored as `bigint` paise per
// CLAUDE.md rule #1 + LEDGER-SPEC §8.1, so we tag-and-revive any bigint
// value as `{ __paise: "12345" }` on the wire and reconstruct on read.
//
// This is OS-internal — the wire format only has to survive the round trip
// between the in-memory state object and the user's localStorage. Backend
// uses Postgres bigint directly.

type PaiseTag = { __paise: string };

function isPaiseTag(value: unknown): value is PaiseTag {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__paise' in value &&
    typeof (value as PaiseTag).__paise === 'string'
  );
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return { __paise: value.toString() } satisfies PaiseTag;
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (isPaiseTag(value)) {
    return BigInt(value.__paise);
  }
  return value;
}

export function stringifyState(state: unknown): string {
  return JSON.stringify(state, replacer);
}

export function parseState<T>(raw: string): T {
  return JSON.parse(raw, reviver) as T;
}
