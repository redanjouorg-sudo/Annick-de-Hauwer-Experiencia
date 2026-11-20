import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BrowserGamepadPoller,
  CABIN_WALK_BOUNDS,
  applyAxisDeadzone,
  stepCabinMovement,
} from './gamepadControl';

function makeMockGamepad(
  overrides: {
    id?: string;
    connected?: boolean;
    axes?: number[];
    downButtons?: number[];
  } = {}
): Gamepad {
  const buttons: GamepadButton[] = Array.from({length: 16}, (_, idx) => {
    const down = overrides.downButtons?.includes(idx) ?? false;
    return {
      pressed: down,
      touched: down,
      value: down ? 1 : 0,
    };
  });
  return {
    id: overrides.id ?? 'Bluetooth Gamepad',
    index: 0,
    connected: overrides.connected ?? true,
    mapping: 'standard',
    axes: overrides.axes ?? [0, 0, 0, 0],
    buttons,
    timestamp: 0,
    hapticActuators: [],
    vibrationActuator: null as unknown as GamepadHapticActuator,
  } as Gamepad;
}

test('applyAxisDeadzone zeroes values inside 0.15 and rescales active range smoothly', () => {
  assert.equal(applyAxisDeadzone(0), 0);
  assert.equal(applyAxisDeadzone(0.14), 0);
  assert.equal(applyAxisDeadzone(-0.15), 0);
  assert.ok(Math.abs(applyAxisDeadzone(1) - 1) < 1e-6);
  assert.ok(Math.abs(applyAxisDeadzone(-1) - -1) < 1e-6);
  const mid = applyAxisDeadzone(0.575); // halfway from 0.15 to 1.0
  assert.ok(Math.abs(mid - 0.5) < 1e-6);
});

test('stepCabinMovement moves relative to camera gaze and clamps inside cabin walls', () => {
  // Looking straight forward (-Z): stick up (-1) moves toward -Z, stick right (+1) moves toward +X
  const movedForward = stepCabinMovement(
    {x: 0, z: 0},
    {x: 0, z: -1},
    {moveX: 0, moveY: -1},
    0.25,
    2.0
  );
  assert.ok(Math.abs(movedForward.x - 0) < 1e-6);
  assert.ok(Math.abs(movedForward.z - -0.5) < 1e-6);

  // Looking right (+X): stick up (-1) moves toward +X
  const movedLookingRight = stepCabinMovement(
    {x: 0, z: 0},
    {x: 1, z: 0},
    {moveX: 0, moveY: -1},
    0.25,
    2.0
  );
  assert.ok(Math.abs(movedLookingRight.x - 0.5) < 1e-6);
  assert.ok(Math.abs(movedLookingRight.z - 0) < 1e-6);

  // Clamps tightly against cabin walls so player cannot walk outside the plane
  const clamped = stepCabinMovement(
    {x: 3.0, z: -5.8},
    {x: 0, z: -1},
    {moveX: 1, moveY: -1},
    0.25,
    5.0
  );
  assert.equal(clamped.x, CABIN_WALK_BOUNDS.maxX);
  assert.equal(clamped.z, CABIN_WALK_BOUNDS.minZ);
});

test('BrowserGamepadPoller detects connection and triggers rising-edge once on buttons 0, 1, or 7', () => {
  const poller = new BrowserGamepadPoller();

  const disconnected = poller.poll([]);
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.actionJustPressed, false);

  const idle = poller.poll([makeMockGamepad({axes: [0.1, -0.1], downButtons: []})]);
  assert.equal(idle.connected, true);
  assert.equal(idle.moveX, 0);
  assert.equal(idle.moveY, 0);
  assert.equal(idle.actionJustPressed, false);

  // Press button 7 (trigger) -> fires once, held frame does not repeat
  const pressed = poller.poll([makeMockGamepad({downButtons: [7]})]);
  assert.equal(pressed.actionJustPressed, true);

  const held = poller.poll([makeMockGamepad({downButtons: [7]})]);
  assert.equal(held.actionJustPressed, false);

  // Release then press button 0 -> fires again
  poller.poll([makeMockGamepad({downButtons: []})]);
  const pressedA = poller.poll([makeMockGamepad({downButtons: [0]})]);
  assert.equal(pressedA.actionJustPressed, true);

  // Release then press button 1 -> fires again
  poller.poll([makeMockGamepad({downButtons: []})]);
  const pressedB = poller.poll([makeMockGamepad({downButtons: [1]})]);
  assert.equal(pressedB.actionJustPressed, true);
});
