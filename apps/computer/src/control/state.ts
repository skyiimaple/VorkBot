export type ControlState = "agent_control" | "handoff_pending" | "human_control";

export type ControlAction = "takeover" | "release";

export class InvalidControlTransitionError extends Error {
  readonly code = "invalid_control_transition" as const;

  constructor(readonly from: ControlState, readonly action: ControlAction) {
    super(`invalid_control_transition:${from}:${action}`);
    this.name = "InvalidControlTransitionError";
  }
}

export class ControlStateStore {
  readonly #states = new Map<string, ControlState>();

  get(slotId: string): ControlState {
    return this.#states.get(slotId) ?? "agent_control";
  }

  apply(slotId: string, action: ControlAction): ControlState {
    const current = this.get(slotId);
    const next = this.#transition(current, action);
    this.#states.set(slotId, next);
    return next;
  }

  reset(slotId: string): void {
    this.#states.delete(slotId);
  }

  #transition(current: ControlState, action: ControlAction): ControlState {
    if (action === "takeover") {
      if (current === "agent_control") {
        return "human_control";
      }
      if (current === "handoff_pending") {
        return "human_control";
      }
      return current;
    }

    if (action === "release") {
      if (current === "human_control" || current === "handoff_pending") {
        return "agent_control";
      }
      throw new InvalidControlTransitionError(current, action);
    }

    throw new InvalidControlTransitionError(current, action);
  }

  requestHandoff(slotId: string): ControlState {
    const current = this.get(slotId);
    if (current !== "agent_control") {
      return current;
    }
    this.#states.set(slotId, "handoff_pending");
    return "handoff_pending";
  }
}
