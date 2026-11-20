import type {GazeDwellSnapshot, SequenceState, StationId} from '../types';

/**
 * Pure state machine tracking 2-second gaze dwell over stations.
 * Fires once when dwell reaches `dwellDurationSec` and stays disarmed
 * until the gaze leaves the target (or `reset()` is called).
 */
export class GazeDwellTracker {
  private hoveredId: StationId | null = null;
  private elapsedSec = 0;
  private armed = true;

  constructor(private readonly dwellDurationSec = 2.0) {
    if (!(dwellDurationSec > 0)) {
      throw new Error('dwellDurationSec must be positive.');
    }
  }

  update(targetId: StationId | null, deltaSec: number): GazeDwellSnapshot {
    const dt = Number.isFinite(deltaSec) ? Math.max(0, Math.min(deltaSec, 0.25)) : 0;

    if (targetId === null) {
      this.hoveredId = null;
      this.elapsedSec = 0;
      this.armed = true;
      return {
        hoveredId: null,
        progress: 0,
        triggeredId: null,
        completed: false,
      };
    }

    if (targetId !== this.hoveredId) {
      this.hoveredId = targetId;
      this.elapsedSec = 0;
      this.armed = true;
    }

    if (!this.armed) {
      return {
        hoveredId: this.hoveredId,
        progress: 1,
        triggeredId: null,
        completed: true,
      };
    }

    this.elapsedSec = Math.min(this.dwellDurationSec, this.elapsedSec + dt);
    const progress = this.elapsedSec / this.dwellDurationSec;

    if (this.elapsedSec >= this.dwellDurationSec) {
      this.armed = false;
      return {
        hoveredId: this.hoveredId,
        progress: 1,
        triggeredId: this.hoveredId,
        completed: true,
      };
    }

    return {
      hoveredId: this.hoveredId,
      progress,
      triggeredId: null,
      completed: false,
    };
  }

  completeCurrent(): void {
    if (this.hoveredId === null) return;
    this.elapsedSec = this.dwellDurationSec;
    this.armed = false;
  }

  reset(): void {
    this.hoveredId = null;
    this.elapsedSec = 0;
    this.armed = true;
  }
}

/**
 * Tracks active audio playback, visited stations, and which station the
 * glowing floor arrow should point toward once a track finishes.
 */
export class SequenceController {
  private activeStationIndex: number | null = null;
  private playingStationIndex: number | null = null;
  private completedStationIndex: number | null = null;
  private nextStationIndex: number | null = null;
  private readonly visited = new Set<number>();

  constructor(private readonly stationCount = 4) {}

  selectStation(index: number): SequenceState {
    if (index < 0 || index >= this.stationCount) {
      throw new RangeError(`Station index ${index} out of bounds.`);
    }
    this.activeStationIndex = index;
    this.playingStationIndex = index;
    // Hide the floor guide while the newly selected track plays.
    this.nextStationIndex = null;
    this.visited.add(index);
    return this.getState();
  }

  finishAudio(index: number): SequenceState {
    if (this.playingStationIndex !== index) {
      return this.getState();
    }
    this.playingStationIndex = null;
    this.completedStationIndex = index;
    this.nextStationIndex = (index + 1) % this.stationCount;
    return this.getState();
  }

  getState(): SequenceState {
    return {
      activeStationIndex: this.activeStationIndex,
      playingStationIndex: this.playingStationIndex,
      completedStationIndex: this.completedStationIndex,
      nextStationIndex: this.nextStationIndex,
      visitedCount: this.visited.size,
    };
  }

  reset(): void {
    this.activeStationIndex = null;
    this.playingStationIndex = null;
    this.completedStationIndex = null;
    this.nextStationIndex = null;
    this.visited.clear();
  }
}

/**
 * Computes Minecraft-dropped-item hover bob offset and smooth hover weight.
 */
export function stepHoverTransform(
  currentHoverWeight: number,
  isHovered: boolean,
  elapsedSec: number,
  deltaSec: number
): {hoverWeight: number; bobOffsetY: number; spinSpeedRadPerSec: number} {
  const dt = Number.isFinite(deltaSec) ? Math.max(0, Math.min(deltaSec, 0.25)) : 0;
  const target = isHovered ? 1 : 0;
  const alpha = 1 - Math.exp(-8 * dt);
  const nextWeight = currentHoverWeight + (target - currentHoverWeight) * alpha;
  const bobOffsetY = Math.sin(elapsedSec * 2.8) * 0.055 * nextWeight;
  const spinSpeedRadPerSec = 0.55 * nextWeight;
  return {
    hoverWeight: nextWeight,
    bobOffsetY,
    spinSpeedRadPerSec,
  };
}

/**
 * Wraps exterior drifting voxel clouds along the fuselage Z axis (-range..+range).
 */
export function wrapCloudZ(
  currentZ: number,
  speedMetersPerSec: number,
  deltaSec: number,
  halfSpanZ = 24
): number {
  const dt = Number.isFinite(deltaSec) ? Math.max(0, Math.min(deltaSec, 0.25)) : 0;
  const span = halfSpanZ * 2;
  let next = currentZ + speedMetersPerSec * dt;
  while (next > halfSpanZ) next -= span;
  while (next < -halfSpanZ) next += span;
  return next;
}

/**
 * Verifies a 3D point stays comfortably inside the enclosed airplane cabin walls.
 */
export function isInsideCabinBounds(
  point: {x: number; y: number; z: number},
  cabin = {halfWidthX: 3.7, ceilingY: 3.1, halfLengthZ: 6.6}
): boolean {
  return (
    Math.abs(point.x) < cabin.halfWidthX &&
    point.y >= 0 &&
    point.y < cabin.ceilingY &&
    Math.abs(point.z) < cabin.halfLengthZ
  );
}
