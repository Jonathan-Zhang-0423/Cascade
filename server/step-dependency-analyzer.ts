import type { BuildStep } from "./build-orchestrator";

/**
 * AG-10: Step dependency analysis.
 *
 * Given a plan's steps, compute an execution order that groups independent
 * steps into "waves" — each wave is a set of steps that can be executed in
 * parallel because they share no required_files with each other, and all their
 * dependencies are satisfied by earlier waves.
 *
 * Dependency model (conservative):
 *   Step B depends on step A if A comes before B in the plan AND B's
 *   required_files intersects A's required_files.
 *
 * This catches the common cases:
 *   - Step 2 edits a file step 1 created
 *   - Step 5 depends on utility file from step 3
 *
 * And allows obvious parallelism:
 *   - Steps 1 (create App.tsx) and 2 (create styles.css) share no files → same wave
 *
 * The algorithm preserves original step order within a wave and never moves a
 * step before one it depends on.
 */

export interface Wave {
  /** Zero-based wave index (0 runs first). */
  index: number;
  /** Steps in this wave. Safe to execute concurrently. */
  steps: BuildStep[];
}

/**
 * Group plan steps into execution waves. Each wave's steps are independent of
 * each other and all steps in prior waves have completed.
 */
export function groupStepsIntoWaves(steps: BuildStep[]): Wave[] {
  if (steps.length === 0) return [];

  // For each step, compute the set of earlier steps it depends on.
  // Depends = shares any required_file with an earlier step.
  const depsByStep = new Map<number, Set<number>>();
  for (let i = 0; i < steps.length; i++) {
    const stepI = steps[i];
    const filesI = new Set(stepI.required_files ?? []);
    const deps = new Set<number>();
    for (let j = 0; j < i; j++) {
      const stepJ = steps[j];
      const filesJ = stepJ.required_files ?? [];
      if (filesJ.some((f) => filesI.has(f))) {
        deps.add(stepJ.step);
      }
    }
    depsByStep.set(stepI.step, deps);
  }

  // Assign wave index = 1 + max(wave of any dep), or 0 if no deps.
  const waveByStep = new Map<number, number>();
  for (const step of steps) {
    const deps = depsByStep.get(step.step) ?? new Set<number>();
    let maxDepWave = -1;
    for (const depStepNum of deps) {
      const w = waveByStep.get(depStepNum);
      if (w !== undefined && w > maxDepWave) maxDepWave = w;
    }
    waveByStep.set(step.step, maxDepWave + 1);
  }

  // Bucket steps into their waves, preserving plan order inside each wave.
  const byWave = new Map<number, BuildStep[]>();
  for (const step of steps) {
    const w = waveByStep.get(step.step) ?? 0;
    const bucket = byWave.get(w) ?? [];
    bucket.push(step);
    byWave.set(w, bucket);
  }

  const waveIndices = Array.from(byWave.keys()).sort((a, b) => a - b);
  return waveIndices.map((idx) => ({ index: idx, steps: byWave.get(idx)! }));
}

/**
 * Convenience: return true if the plan has at least one wave with parallel
 * steps. Used by the orchestrator to decide whether to take the parallel path.
 */
export function hasParallelOpportunity(waves: Wave[]): boolean {
  return waves.some((w) => w.steps.length > 1);
}
