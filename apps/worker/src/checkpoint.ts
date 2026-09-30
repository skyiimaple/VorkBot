import { CheckpointStateSchema, type CheckpointState } from "@vork/contracts";

const MAX_OBSERVATION_CHARS = 4000;

export function sanitizeCheckpointObservation(value: string | undefined): string {
  if (!value) return "";
  const redacted = value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:set-)?cookie\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(/\b(sk-[a-z0-9_-]{8,})\b/gi, "[REDACTED]");
  return redacted.slice(0, MAX_OBSERVATION_CHARS);
}

export function toCheckpointState(input: CheckpointState): CheckpointState {
  return CheckpointStateSchema.parse({
    ...input,
    lastObservation: sanitizeCheckpointObservation(input.lastObservation)
  });
}
