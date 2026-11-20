import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GazeDwellTracker,
  SequenceController,
  isInsideCabinBounds,
  stepHoverTransform,
  wrapCloudZ,
} from './gazeState';
import {STATIONS, getStationWorldPosition} from '../constants';

test('GazeDwellTracker fills linearly over 2.0 seconds and fires once', () => {
  const tracker = new GazeDwellTracker(2.0);

  let snap = tracker.update('lenguas', 0.25);
  assert.equal(snap.hoveredId, 'lenguas');
  assert.equal(snap.progress, 0.125);
  assert.equal(snap.triggeredId, null);
  assert.equal(snap.completed, false);

  // Advance 7 more frames of 0.25s -> total 2.0s
  for (let i = 0; i < 6; i++) {
    snap = tracker.update('lenguas', 0.25);
    assert.equal(snap.triggeredId, null);
  }
  assert.equal(snap.progress, 0.875);

  snap = tracker.update('lenguas', 0.25);
  assert.equal(snap.progress, 1);
  assert.equal(snap.triggeredId, 'lenguas');
  assert.equal(snap.completed, true);

  // Subsequent frames while still staring do not re-trigger until gaze leaves
  snap = tracker.update('lenguas', 0.2);
  assert.equal(snap.triggeredId, null);
  assert.equal(snap.completed, true);

  // Looking away resets and re-arms
  snap = tracker.update(null, 0.016);
  assert.equal(snap.progress, 0);
  assert.equal(snap.hoveredId, null);

  snap = tracker.update('correo', 0.25);
  assert.equal(snap.hoveredId, 'correo');
  assert.equal(snap.progress, 0.125);
});

test('GazeDwellTracker resets elapsed progress when switching directly between stations', () => {
  const tracker = new GazeDwellTracker(2.0);
  tracker.update('lenguas', 0.25);
  tracker.update('lenguas', 0.25);
  const switched = tracker.update('feria', 0.2);
  assert.equal(switched.hoveredId, 'feria');
  assert.equal(switched.progress, 0.1);
  assert.equal(switched.triggeredId, null);

  // Instant gamepad selection disarms current hover so 2s timer does not double-fire
  tracker.completeCurrent();
  for (let i = 0; i < 10; i++) {
    const afterInstant = tracker.update('feria', 0.25);
    assert.equal(afterInstant.progress, 1);
    assert.equal(afterInstant.completed, true);
    assert.equal(afterInstant.triggeredId, null);
  }
});

test('SequenceController advances glowing floor guide in order 1 -> 2 -> 3 -> 4 -> 1', () => {
  const seq = new SequenceController(4);
  assert.equal(seq.getState().nextStationIndex, null);

  seq.selectStation(0);
  assert.equal(seq.getState().playingStationIndex, 0);
  assert.equal(seq.getState().nextStationIndex, null);

  seq.finishAudio(0);
  assert.equal(seq.getState().playingStationIndex, null);
  assert.equal(seq.getState().nextStationIndex, 1);

  // Selecting station 2 while or after clears previous indicator until station 2 finishes
  seq.selectStation(1);
  assert.equal(seq.getState().nextStationIndex, null);
  seq.finishAudio(1);
  assert.equal(seq.getState().nextStationIndex, 2);

  seq.selectStation(3);
  seq.finishAudio(3);
  assert.equal(seq.getState().nextStationIndex, 0);
  assert.equal(seq.getState().visitedCount, 3);
});

test('Station circular placement places 4 stations at 3m radius on cardinal angles', () => {
  assert.equal(STATIONS.length, 4);
  const p0 = getStationWorldPosition(STATIONS[0].angleRad);
  const p1 = getStationWorldPosition(STATIONS[1].angleRad);
  const p2 = getStationWorldPosition(STATIONS[2].angleRad);
  const p3 = getStationWorldPosition(STATIONS[3].angleRad);

  assert.ok(Math.abs(p0.x - 0) < 1e-6 && Math.abs(p0.z - -3) < 1e-6);
  assert.ok(Math.abs(p1.x - 3) < 1e-6 && Math.abs(p1.z - 0) < 1e-6);
  assert.ok(Math.abs(p2.x - 0) < 1e-6 && Math.abs(p2.z - 3) < 1e-6);
  assert.ok(Math.abs(p3.x - -3) < 1e-6 && Math.abs(p3.z - 0) < 1e-6);

  for (const station of STATIONS) {
    const pos = getStationWorldPosition(station.angleRad);
    assert.equal(isInsideCabinBounds(pos), true);
  }
});

test('stepHoverTransform smoothly ramps hover weight and bobbing', () => {
  const hovered = stepHoverTransform(0, true, Math.PI / (2 * 2.8), 0.25);
  assert.ok(hovered.hoverWeight > 0.5);
  assert.ok(hovered.bobOffsetY > 0);
  assert.ok(hovered.spinSpeedRadPerSec > 0);

  const unhovered = stepHoverTransform(1, false, 1.0, 0.25);
  assert.ok(unhovered.hoverWeight < 0.25);
});

test('wrapCloudZ loops drifting clouds cleanly along cabin windows', () => {
  const advanced = wrapCloudZ(10, 4, 0.25, 24);
  assert.equal(advanced, 11);

  const wrapped = wrapCloudZ(23.8, 4, 0.25, 24);
  assert.ok(wrapped < -23 && wrapped > -24);
});
