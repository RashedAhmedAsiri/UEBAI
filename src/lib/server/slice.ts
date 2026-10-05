import "server-only";

/**
 * Time budget for the job slice running on this instance (hosted only; locally there is no
 * deadline). Long steps check sliceExpired() between units of work and stop with SliceYield.
 */
type G = typeof globalThis & { __uebaiSliceDeadline?: number };
const g = globalThis as G;

export function startSlice(ms: number) { g.__uebaiSliceDeadline = Date.now() + ms; }
export function endSlice() { g.__uebaiSliceDeadline = Infinity; }
export function sliceExpired(): boolean { return Date.now() > (g.__uebaiSliceDeadline ?? Infinity); }

/** Thrown when the current slice is out of time; the job is re-queued from its checkpoint. */
export class SliceYield extends Error {
  constructor() { super("Out of time for this slice"); }
}
