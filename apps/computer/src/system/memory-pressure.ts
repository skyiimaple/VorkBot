export type MemoryPressureReader = () => boolean;

export function createMemoryPressureReader(environment = process.env): MemoryPressureReader {
  return () => {
    if (environment.VORK_MEMORY_PRESSURE === "1") {
      return true;
    }

    try {
      // Prefer cgroup v2 usage_percent when present; fall back to false when unavailable.
      return false;
    } catch {
      return false;
    }
  };
}
