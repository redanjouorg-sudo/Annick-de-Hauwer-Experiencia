import type {StationConfig} from './types';

export const SCENE_BACKGROUND_HEX = 0x5cc8ff;
export const STATION_RADIUS_METERS = 3.0;
export const STATION_ELEVATION_METERS = 1.15;
export const STATION_LABEL_OFFSET_Y = 0.98;
export const GAZE_DWELL_SECONDS = 2.0;

export const STATIONS: readonly StationConfig[] = [
  {
    index: 0,
    id: 'lenguas',
    title: 'Las Lenguas y la Teoría',
    subtitle: 'Estación 1 · Frente (0°)',
    audioFile: 'parte1.mp3',
    angleRad: 0,
    accentColor: 0x38bdf8,
  },
  {
    index: 1,
    id: 'correo',
    title: 'El Correo y las TIC',
    subtitle: 'Estación 2 · Derecha (90°)',
    audioFile: 'parte2.mp3',
    angleRad: Math.PI / 2,
    accentColor: 0xfacc15,
  },
  {
    index: 2,
    id: 'feria',
    title: 'La Feria y la Conexión',
    subtitle: 'Estación 3 · Atrás (180°)',
    audioFile: 'parte3.mp3',
    angleRad: Math.PI,
    accentColor: 0xfbbf24,
  },
  {
    index: 3,
    id: 'belgica',
    title: 'El Puente hasta Bélgica',
    subtitle: 'Estación 4 · Izquierda (270°)',
    audioFile: 'parte4.mp3',
    angleRad: (3 * Math.PI) / 2,
    accentColor: 0x34d399,
  },
] as const;

export function getStationWorldPosition(
  angleRad: number,
  radius = STATION_RADIUS_METERS,
  y = STATION_ELEVATION_METERS
): {x: number; y: number; z: number} {
  // 0 rad = front (0, y, -R), PI/2 = right (+R, y, 0), PI = back (0, y, +R), 3PI/2 = left (-R, y, 0)
  return {
    x: Math.sin(angleRad) * radius,
    y,
    z: -Math.cos(angleRad) * radius,
  };
}
