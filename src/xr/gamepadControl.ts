export interface GamepadInputSnapshot {
  connected: boolean;
  id: string | null;
  moveX: number;
  moveY: number;
  actionJustPressed: boolean;
}

export interface CabinClampBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const DEFAULT_GAMEPAD_DEADZONE = 0.15;
export const GAMEPAD_MOVE_SPEED_MPS = 2.4;
export const PRIMARY_ACTION_BUTTON_INDICES = [0, 1, 7] as const;

export const CABIN_WALK_BOUNDS: CabinClampBounds = {
  minX: -3.1,
  maxX: 3.1,
  minZ: -5.9,
  maxZ: 5.9,
};

/**
 * Applies a symmetric radial-like per-axis deadzone and rescales the remaining
 * active range [deadzone..1] smoothly onto [0..1].
 */
export function applyAxisDeadzone(
  rawValue: number,
  deadzone = DEFAULT_GAMEPAD_DEADZONE
): number {
  if (!Number.isFinite(rawValue)) return 0;
  const clamped = Math.max(-1, Math.min(1, rawValue));
  const abs = Math.abs(clamped);
  if (abs <= deadzone) return 0;
  const normalized = (abs - deadzone) / (1 - deadzone);
  return Math.sign(clamped) * normalized;
}

/**
 * Computes camera-relative XZ movement and clamps the player inside the cabin walls.
 */
export function stepCabinMovement(
  pos: {x: number; z: number},
  forward: {x: number; z: number},
  stick: {moveX: number; moveY: number},
  deltaSec: number,
  speedMps = GAMEPAD_MOVE_SPEED_MPS,
  bounds: CabinClampBounds = CABIN_WALK_BOUNDS
): {x: number; z: number} {
  const dt = Number.isFinite(deltaSec) ? Math.max(0, Math.min(deltaSec, 0.25)) : 0;
  const fLen = Math.hypot(forward.x, forward.z);
  const fx = fLen > 1e-5 ? forward.x / fLen : 0;
  const fz = fLen > 1e-5 ? forward.z / fLen : -1;

  // Right-handed Y-up: right vector perpendicular to horizontal forward
  const rx = -fz;
  const rz = fx;

  // Gamepad axes[1] is -1 when pushed forward, +1 when pulled backward
  const forwardInput = -stick.moveY;
  const strafeInput = stick.moveX;

  const dx = (rx * strafeInput + fx * forwardInput) * speedMps * dt;
  const dz = (rz * strafeInput + fz * forwardInput) * speedMps * dt;

  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, pos.x + dx)),
    z: Math.max(bounds.minZ, Math.min(bounds.maxZ, pos.z + dz)),
  };
}

function isGamepadButtonDown(button: GamepadButton | undefined): boolean {
  if (!button) return false;
  return Boolean(button.pressed || button.value > 0.5);
}

/**
 * Polls standard browser Gamepad API (`navigator.getGamepads()`) for left-stick
 * movement and rising-edge primary button presses (buttons[0], buttons[1], buttons[7]).
 */
export class BrowserGamepadPoller {
  private prevActionDown = false;
  private lastConnectedId: string | null = null;

  poll(gamepads: ArrayLike<Gamepad | null> | null | undefined): GamepadInputSnapshot {
    let activePad: Gamepad | null = null;
    if (gamepads) {
      for (let i = 0; i < gamepads.length; i++) {
        const pad = gamepads[i];
        if (pad && pad.connected) {
          activePad = pad;
          break;
        }
      }
    }

    if (!activePad) {
      this.prevActionDown = false;
      this.lastConnectedId = null;
      return {
        connected: false,
        id: null,
        moveX: 0,
        moveY: 0,
        actionJustPressed: false,
      };
    }

    this.lastConnectedId = activePad.id || 'Gamepad';

    const rawX = activePad.axes?.[0] ?? 0;
    const rawY = activePad.axes?.[1] ?? 0;
    const moveX = applyAxisDeadzone(rawX);
    const moveY = applyAxisDeadzone(rawY);

    let anyActionDown = false;
    for (const idx of PRIMARY_ACTION_BUTTON_INDICES) {
      if (isGamepadButtonDown(activePad.buttons?.[idx])) {
        anyActionDown = true;
        break;
      }
    }

    const actionJustPressed = anyActionDown && !this.prevActionDown;
    this.prevActionDown = anyActionDown;

    return {
      connected: true,
      id: this.lastConnectedId,
      moveX,
      moveY,
      actionJustPressed,
    };
  }
}
