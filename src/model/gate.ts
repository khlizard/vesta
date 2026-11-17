// One action at a time: what happens to a command that arrives while another is still running.
// Spec: docs/spec/ui.md「モード」
//
// Commands that change files (paste, delete, undo...) take as long as the files do. A second one
// started in the meantime would work on a list and a clipboard that are about to change, and a
// held-down key would start the same operation over and over.

/** How a command behaves while an exclusive command is running. */
export type Policy =
  /** Runs at once whatever else is going on (moving the cursor, switching tabs, opening a menu). */
  | "free"
  /** Never overlaps another exclusive command: one may wait for its turn, the rest are dropped. */
  | "exclusive";

export interface Gate {
  /** An exclusive command is running. */
  running: boolean;
  /** One more is waiting for it to end. */
  waiting: boolean;
}

export const OPEN_GATE: Gate = { running: false, waiting: false };

export type Admission =
  /** Start now. */
  | "run"
  /** Start when the running one has ended. */
  | "wait"
  /** Do nothing. */
  | "drop";

/**
 * What to do with a command that arrives at the gate. `repeat` is true when it comes from a
 * key that is being held down.
 */
export function admit(gate: Gate, policy: Policy, repeat: boolean): Admission {
  if (policy === "free") return "run";
  // Holding a key must not queue up file operations: one press, one operation.
  if (repeat) return "drop";
  if (!gate.running) return "run";
  return gate.waiting ? "drop" : "wait";
}

/** The gate after an admission was acted on. */
export function entered(gate: Gate, admission: Admission, policy: Policy): Gate {
  if (policy === "free" || admission === "drop") return gate;
  return admission === "run" ? { running: true, waiting: gate.waiting } : { running: true, waiting: true };
}

/**
 * The gate after an exclusive command has ended: a waiting one takes its place and starts
 * (`next` is true), otherwise the gate opens.
 */
export function left(gate: Gate): { gate: Gate; next: boolean } {
  return gate.waiting ? { gate: { running: true, waiting: false }, next: true } : { gate: OPEN_GATE, next: false };
}
