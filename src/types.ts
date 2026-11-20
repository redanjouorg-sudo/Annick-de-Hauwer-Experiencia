export type StationId = 'lenguas' | 'correo' | 'feria' | 'belgica';

export interface StationConfig {
  readonly index: number;
  readonly id: StationId;
  readonly title: string;
  readonly subtitle: string;
  readonly audioFile: string;
  /** Angle around the user in radians (0 = front -Z, PI/2 = right +X, PI = back +Z, 3*PI/2 = left -X). */
  readonly angleRad: number;
  readonly accentColor: number;
}

export interface GazeDwellSnapshot {
  readonly hoveredId: StationId | null;
  readonly progress: number;
  readonly triggeredId: StationId | null;
  readonly completed: boolean;
}

export interface SequenceState {
  readonly activeStationIndex: number | null;
  readonly playingStationIndex: number | null;
  readonly completedStationIndex: number | null;
  readonly nextStationIndex: number | null;
  readonly visitedCount: number;
}
