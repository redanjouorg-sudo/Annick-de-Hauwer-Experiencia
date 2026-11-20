import * as THREE from 'three';
import * as xb from 'xrblocks';

import {GAZE_DWELL_SECONDS, STATIONS} from '../constants';
import {AudioController} from './AudioController';
import {EnvironmentAndFloor} from './EnvironmentAndFloor';
import {GazeReticle} from './GazeReticle';
import {createVoxelStations, type StationInstance} from './Stations';
import {VoxelBuilder} from './VoxelBuilder';
import {
  BrowserGamepadPoller,
  CABIN_WALK_BOUNDS,
  stepCabinMovement,
} from './gamepadControl';
import {GazeDwellTracker, SequenceController} from './gazeState';

const CENTER_NDC = new THREE.Vector2(0, 0);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _camForward = new THREE.Vector3();

export interface VRExperienceOptions {
  onAudioUnlock?: () => void;
}

export class VRExperienceScript extends xb.Script {
  private readonly voxels = new VoxelBuilder();
  private readonly dwellTracker = new GazeDwellTracker(GAZE_DWELL_SECONDS);
  private readonly sequence = new SequenceController(STATIONS.length);
  private readonly raycaster = new THREE.Raycaster();
  private readonly audio = new AudioController();
  private readonly gamepadPoller = new BrowserGamepadPoller();

  private environment!: EnvironmentAndFloor;
  private stations: StationInstance[] = [];
  private hitBoxes: THREE.Mesh[] = [];
  private reticle!: GazeReticle;
  private gamepadStatusEl: HTMLDivElement | null = null;

  private elapsedSec = 0;
  private lastHoveredIndex: number | null = null;
  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private readonly heldKeys = new Set<string>();
  private yaw = 0;
  private pitch = -0.06; // slightly below horizon toward eye-level stations
  private lookInitialized = false;
  private playerPos = {x: 0, z: 0};
  private baseReferenceSpace: XRReferenceSpace | null = null;
  private lastGamepadConnected = false;
  private instantTriggerCount = 0;

  constructor(private readonly opts: VRExperienceOptions = {}) {
    super();
  }

  init(): void {
    this.environment = new EnvironmentAndFloor(this.voxels);
    this.environment.applySceneAtmosphere(xb.core.scene);
    this.add(this.environment);

    this.stations = createVoxelStations(this.voxels);
    this.hitBoxes = this.stations.map((s) => s.hitBox);
    for (const station of this.stations) {
      this.add(station.root);
    }

    this.reticle = new GazeReticle();
    this.add(this.reticle);

    this.audio.setListener((event, stationIndex) => {
      if (event === 'ended') {
        const nextState = this.sequence.finishAudio(stationIndex);
        this.stations[stationIndex]?.setActive(false);
        this.stations[stationIndex]?.setCompleted(true);
        this.environment.setNextStationTarget(nextState.nextStationIndex);
        this.syncDomState();
      }
    });

    // Position camera at center of the cabin at comfortable seated/standing eye height
    xb.core.camera.position.set(this.playerPos.x, 1.45, this.playerPos.z);
    _euler.set(this.pitch, this.yaw, 0, 'YXZ');
    xb.core.camera.quaternion.setFromEuler(_euler);
    this.lookInitialized = true;

    this.mountGamepadStatusBadge();
    this.bindDesktopLookControls();
    this.syncDomState();
  }

  onSimulatorStarted(): void {
    this.environment?.applySceneAtmosphere(xb.core.scene);
    xb.core.camera.position.set(this.playerPos.x, 1.45, this.playerPos.z);
    _euler.set(this.pitch, this.yaw, 0, 'YXZ');
    xb.core.camera.quaternion.setFromEuler(_euler);
  }

  onXRSessionStarted(): void {
    this.audio.unlock();
    this.environment?.applySceneAtmosphere(xb.core.scene);
    this.baseReferenceSpace =
      xb.core.renderer?.xr?.getReferenceSpace?.() ?? null;
    this.applyXRReferenceOffset();
  }

  unlockAudio(): void {
    this.audio.unlock();
    this.opts.onAudioUnlock?.();
  }

  private mountGamepadStatusBadge(): void {
    if (typeof document === 'undefined' || this.gamepadStatusEl) return;
    const pill = document.createElement('div');
    pill.id = 'vr-gamepad-pill';
    pill.dataset.visible = 'false';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path1 = document.createElementNS(svgNS, 'path');
    path1.setAttribute(
      'd',
      'M6 11h4M8 9v4M15 12h.01M18 10h.01M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z'
    );
    svg.appendChild(path1);

    const label = document.createElement('span');
    label.textContent = 'Gamepad conectado';

    pill.append(svg, label);
    document.body.appendChild(pill);
    this.gamepadStatusEl = pill;
  }

  private applyXRReferenceOffset(): void {
    if (
      !this.baseReferenceSpace ||
      typeof XRRigidTransform === 'undefined' ||
      !xb.core.renderer?.xr?.isPresenting
    ) {
      return;
    }
    try {
      const offset = new XRRigidTransform({
        x: -this.playerPos.x,
        y: 0,
        z: -this.playerPos.z,
        w: 1,
      });
      const offsetSpace = this.baseReferenceSpace.getOffsetReferenceSpace(offset);
      const xr = xb.core.renderer?.xr as
        | {setReferenceSpace?: (space: XRReferenceSpace) => void}
        | undefined;
      xr?.setReferenceSpace?.(offsetSpace);
    } catch {
      // Ignore unsupported reference-space offsets on constrained runtimes
    }
  }

  private updateGamepadConnectionUI(connected: boolean, id: string | null): void {
    if (connected !== this.lastGamepadConnected) {
      this.lastGamepadConnected = connected;
      if (connected) {
        console.info(`[Gamepad] Connected: ${id ?? 'Bluetooth/USB Joystick'}`);
      } else {
        console.info('[Gamepad] Disconnected');
      }
    }
    if (this.gamepadStatusEl) {
      this.gamepadStatusEl.dataset.visible = connected ? 'true' : 'false';
      this.gamepadStatusEl.title = id ?? 'Gamepad';
    }
  }

  private onGamepadConnectedEvent = (event: GamepadEvent): void => {
    this.updateGamepadConnectionUI(true, event.gamepad?.id ?? null);
  };

  private onGamepadDisconnectedEvent = (): void => {
    const pads = typeof navigator !== 'undefined' ? navigator.getGamepads?.() : [];
    const anyLeft = Boolean(
      pads && Array.from(pads).some((p) => p && p.connected)
    );
    if (!anyLeft) {
      this.updateGamepadConnectionUI(false, null);
    }
  };

  private bindDesktopLookControls(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('pointerdown', this.onPointerDown, {passive: true});
    window.addEventListener('pointermove', this.onPointerMove, {passive: true});
    window.addEventListener('pointerup', this.onPointerUp, {passive: true});
    window.addEventListener('pointercancel', this.onPointerUp, {passive: true});
    window.addEventListener('keydown', this.handleWindowKeyDown);
    window.addEventListener('keyup', this.handleWindowKeyUp);
    window.addEventListener('gamepadconnected', this.onGamepadConnectedEvent);
    window.addEventListener(
      'gamepaddisconnected',
      this.onGamepadDisconnectedEvent
    );
  }

  private unbindDesktopLookControls(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.handleWindowKeyDown);
    window.removeEventListener('keyup', this.handleWindowKeyUp);
    window.removeEventListener('gamepadconnected', this.onGamepadConnectedEvent);
    window.removeEventListener(
      'gamepaddisconnected',
      this.onGamepadDisconnectedEvent
    );
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.audio.unlock();
    const target = event.target as HTMLElement | null;
    if (target && target.closest('button, a, input, #XRButtonWrapper, #vr-bottom-dock')) {
      return;
    }
    this.isDragging = true;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isDragging || xb.core.renderer?.xr?.isPresenting) return;
    const dx = event.clientX - this.lastPointerX;
    const dy = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;

    this.yaw += dx * 0.0045;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + dy * 0.0045,
      -Math.PI * 0.42,
      Math.PI * 0.42
    );
    _euler.set(this.pitch, this.yaw, 0, 'YXZ');
    xb.core.camera.quaternion.setFromEuler(_euler);
  };

  private onPointerUp = (): void => {
    this.isDragging = false;
  };

  private handleWindowKeyDown = (event: KeyboardEvent): void => {
    this.audio.unlock();
    this.heldKeys.add(event.code);
  };

  private handleWindowKeyUp = (event: KeyboardEvent): void => {
    this.heldKeys.delete(event.code);
  };

  private updateKeyboardLook(deltaSec: number): void {
    if (xb.core.renderer?.xr?.isPresenting || !this.lookInitialized) return;
    const turnSpeed = 1.65;
    let yawDelta = 0;
    let pitchDelta = 0;

    if (this.heldKeys.has('ArrowLeft')) yawDelta += turnSpeed * deltaSec;
    if (this.heldKeys.has('ArrowRight')) yawDelta -= turnSpeed * deltaSec;
    if (this.heldKeys.has('ArrowUp')) pitchDelta += turnSpeed * 0.7 * deltaSec;
    if (this.heldKeys.has('ArrowDown')) pitchDelta -= turnSpeed * 0.7 * deltaSec;

    if (yawDelta !== 0 || pitchDelta !== 0) {
      this.yaw += yawDelta;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch + pitchDelta,
        -Math.PI * 0.42,
        Math.PI * 0.42
      );
      _euler.set(this.pitch, this.yaw, 0, 'YXZ');
      xb.core.camera.quaternion.setFromEuler(_euler);
    } else if (!this.isDragging) {
      // Sync yaw/pitch from external camera rotation (e.g., simulator right-drag)
      _euler.setFromQuaternion(xb.core.camera.quaternion, 'YXZ');
      this.yaw = _euler.y;
      this.pitch = _euler.x;
    }
  }

  update(): void {
    const rawDelta = xb.getDeltaTime();
    const deltaSec = Number.isFinite(rawDelta)
      ? Math.max(0.001, Math.min(rawDelta, 0.1))
      : 0.016;
    this.elapsedSec += deltaSec;

    this.updateKeyboardLook(deltaSec);

    const isPresenting = Boolean(xb.core.renderer?.xr?.isPresenting);
    if (!isPresenting) {
      this.baseReferenceSpace = null;
      // Clamp desktop WASD movement cleanly inside the airplane cabin walls
      this.playerPos.x = THREE.MathUtils.clamp(
        xb.core.camera.position.x,
        CABIN_WALK_BOUNDS.minX,
        CABIN_WALK_BOUNDS.maxX
      );
      this.playerPos.z = THREE.MathUtils.clamp(
        xb.core.camera.position.z,
        CABIN_WALK_BOUNDS.minZ,
        CABIN_WALK_BOUNDS.maxZ
      );
      xb.core.camera.position.x = this.playerPos.x;
      xb.core.camera.position.z = this.playerPos.z;
    } else if (!this.baseReferenceSpace) {
      this.baseReferenceSpace =
        xb.core.renderer?.xr?.getReferenceSpace?.() ?? null;
    }

    const activeCamera =
      xb.core.simulator?.getRenderCamera() ?? xb.core.camera;
    activeCamera.updateMatrixWorld();

    // Standard browser Gamepad API polling (Android Bluetooth/USB joysticks)
    const gamepad = this.gamepadPoller.poll(
      typeof navigator !== 'undefined' ? navigator.getGamepads?.() : undefined
    );
    this.updateGamepadConnectionUI(gamepad.connected, gamepad.id);

    if (gamepad.connected && (gamepad.moveX !== 0 || gamepad.moveY !== 0)) {
      activeCamera.getWorldDirection(_camForward);
      this.playerPos = stepCabinMovement(
        this.playerPos,
        {x: _camForward.x, z: _camForward.z},
        {moveX: gamepad.moveX, moveY: gamepad.moveY},
        deltaSec
      );
      if (!isPresenting) {
        xb.core.camera.position.set(this.playerPos.x, 1.45, this.playerPos.z);
        xb.core.camera.updateMatrixWorld();
      } else {
        this.applyXRReferenceOffset();
      }
    }

    // Central Gaze Raycast (Cardboard style: center of FOV)
    this.raycaster.setFromCamera(CENTER_NDC, activeCamera);
    const hits = this.raycaster.intersectObjects(this.hitBoxes, false);

    let hoveredIndex: number | null = null;
    let hitDistance: number | null = null;
    if (hits.length > 0) {
      const hitObj = hits[0].object;
      const idx = hitObj.userData.stationIndex;
      if (typeof idx === 'number' && this.stations[idx]) {
        hoveredIndex = idx;
        hitDistance = hits[0].distance;
      }
    }

    if (hoveredIndex !== this.lastHoveredIndex) {
      if (this.lastHoveredIndex !== null) {
        this.stations[this.lastHoveredIndex]?.setHovered(false);
      }
      if (hoveredIndex !== null) {
        this.stations[hoveredIndex]?.setHovered(true);
      }
      this.lastHoveredIndex = hoveredIndex;
    }

    const hoveredId =
      hoveredIndex !== null ? STATIONS[hoveredIndex].id : null;
    let dwell = this.dwellTracker.update(hoveredId, deltaSec);

    // Instant station trigger on gamepad primary buttons (0, 1, or 7)
    if (gamepad.actionJustPressed && hoveredIndex !== null && hoveredId !== null) {
      this.audio.unlock();
      this.dwellTracker.completeCurrent();
      this.instantTriggerCount++;
      this.activateStation(hoveredIndex);
      dwell = {
        hoveredId,
        progress: 1,
        triggeredId: hoveredId,
        completed: true,
      };
    } else if (dwell.triggeredId !== null) {
      const triggeredIdx = STATIONS.findIndex((s) => s.id === dwell.triggeredId);
      if (triggeredIdx !== -1) {
        this.activateStation(triggeredIdx);
      }
    }

    this.reticle.updateFromGaze(
      activeCamera,
      hitDistance,
      dwell.progress,
      hoveredIndex !== null,
      dwell.completed
    );

    for (const station of this.stations) {
      station.update(this.elapsedSec, deltaSec);
    }
    this.environment.update(deltaSec);
    this.syncDomState(dwell.progress);
  }

  private activateStation(stationIndex: number): void {
    this.sequence.selectStation(stationIndex);
    this.environment.setNextStationTarget(null);

    for (let i = 0; i < this.stations.length; i++) {
      this.stations[i].setActive(i === stationIndex);
    }

    this.audio.playStation(stationIndex);
    this.syncDomState(1);
  }

  private syncDomState(progress = 0): void {
    if (typeof document === 'undefined') return;
    const body = document.body;
    const seq = this.sequence.getState();
    body.dataset.hoveredStation =
      this.lastHoveredIndex !== null ? STATIONS[this.lastHoveredIndex].id : 'none';
    body.dataset.activeStation =
      seq.activeStationIndex !== null ? STATIONS[seq.activeStationIndex].id : 'none';
    body.dataset.playingStation =
      seq.playingStationIndex !== null ? STATIONS[seq.playingStationIndex].id : 'none';
    body.dataset.nextStation =
      seq.nextStationIndex !== null ? STATIONS[seq.nextStationIndex].id : 'none';
    body.dataset.gazeProgress = progress.toFixed(2);
    body.dataset.gamepadConnected = String(this.lastGamepadConnected);
    body.dataset.instantTriggerCount = String(this.instantTriggerCount);
    body.dataset.playerX = this.playerPos.x.toFixed(2);
    body.dataset.playerZ = this.playerPos.z.toFixed(2);
  }

  dispose(): void {
    this.unbindDesktopLookControls();
    this.gamepadStatusEl?.remove();
    this.gamepadStatusEl = null;
    this.audio.dispose();
    this.reticle?.dispose();
    for (const station of this.stations) {
      station.dispose();
    }
    this.environment?.dispose();
    this.voxels.dispose();
  }
}
