import * as THREE from 'three';
import * as xb from 'xrblocks';

import {
  STATIONS,
  STATION_ELEVATION_METERS,
  STATION_LABEL_OFFSET_Y,
  STATION_RADIUS_METERS,
  getStationWorldPosition,
} from '../constants';
import type {StationConfig} from '../types';
import {VoxelBuilder} from './VoxelBuilder';
import {stepHoverTransform} from './gazeState';

export interface StationInstance {
  readonly config: StationConfig;
  readonly root: THREE.Group;
  readonly diorama: THREE.Group;
  readonly hitBox: THREE.Mesh;
  readonly titleCard: xb.UICard;
  readonly statusText: xb.UIText;
  setHovered(hovered: boolean): void;
  setActive(active: boolean): void;
  setCompleted(completed: boolean): void;
  update(elapsedSec: number, deltaSec: number): void;
  dispose(): void;
}

abstract class BaseVoxelStation implements StationInstance {
  readonly root = new THREE.Group();
  readonly diorama = new THREE.Group();
  readonly hitBox: THREE.Mesh;
  readonly titleCard: xb.UICard;
  readonly statusText: xb.UIText;

  protected isHovered = false;
  protected isActive = false;
  protected isCompleted = false;
  protected hoverWeight = 0;
  protected activeTime = 0;

  private readonly hitGeometry: THREE.BoxGeometry;
  private readonly hitMaterial: THREE.MeshBasicMaterial;
  private readonly accentRing: THREE.Mesh;
  private readonly accentMaterial: THREE.MeshLambertMaterial;

  constructor(
    readonly config: StationConfig,
    protected readonly voxels: VoxelBuilder
  ) {
    this.root.name = `Station_${config.id}`;
    const pos = getStationWorldPosition(
      config.angleRad,
      STATION_RADIUS_METERS,
      STATION_ELEVATION_METERS
    );
    this.root.position.set(pos.x, pos.y, pos.z);
    // Face inward toward the center user position (0, y, 0)
    this.root.rotation.y = -config.angleRad;

    this.diorama.name = `Diorama_${config.id}`;
    this.root.add(this.diorama);

    // Subtle glowing accent bar under the diorama
    this.accentMaterial = new THREE.MeshLambertMaterial({
      color: config.accentColor,
      emissive: config.accentColor,
      emissiveIntensity: 0.25,
    });
    this.accentRing = new THREE.Mesh(this.voxels.unitCube, this.accentMaterial);
    this.accentRing.position.set(0, -0.52, 0);
    this.accentRing.scale.set(0.76, 0.04, 0.76);
    this.accentRing.raycast = () => {};
    this.root.add(this.accentRing);

    // Generous invisible hitbox so Cardboard gaze targeting feels effortless
    this.hitGeometry = new THREE.BoxGeometry(1.25, 1.25, 1.25);
    this.hitMaterial = new THREE.MeshBasicMaterial({
      visible: false,
    });
    this.hitBox = new THREE.Mesh(this.hitGeometry, this.hitMaterial);
    this.hitBox.position.set(0, 0.08, 0);
    this.hitBox.userData.stationIndex = config.index;
    this.hitBox.userData.stationId = config.id;
    this.root.add(this.hitBox);

    // Floating clean 3D title label above the station
    this.statusText = new xb.UIText({
      text: config.subtitle,
      pointerEvents: 'none',
      style: {
        fontSize: 25,
        color: '#cbd5e1',
        textAlign: 'center',
      },
    });

    this.titleCard = new xb.UICard({
      size: {width: 1.62, height: 'auto'},
      pixelSize: 0.0028,
      pointerEvents: 'none',
      style: {
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: 20,
        backgroundColor: 'rgba(13, 17, 23, 0.94)',
        borderColor: '#334155',
        borderWidth: 2,
        borderRadius: 20,
      },
      children: [
        new xb.UIText({
          text: config.title,
          pointerEvents: 'none',
          style: {
            fontSize: 38,
            fontWeight: 'bold',
            color: '#f8fafc',
            textAlign: 'center',
          },
        }),
        this.statusText,
      ],
    });
    this.titleCard.position.set(0, STATION_LABEL_OFFSET_Y, 0);
    this.root.add(this.titleCard);
  }

  setHovered(hovered: boolean): void {
    this.isHovered = hovered;
    this.refreshLabelAppearance();
  }

  setActive(active: boolean): void {
    if (active && !this.isActive) {
      this.activeTime = 0;
      this.onActivated();
    }
    this.isActive = active;
    this.refreshLabelAppearance();
  }

  setCompleted(completed: boolean): void {
    this.isCompleted = completed;
    this.refreshLabelAppearance();
  }

  private refreshLabelAppearance(): void {
    if (this.isActive) {
      this.statusText.text = 'Reproduciendo audio...';
      this.statusText.style.color = '#fbbf24';
      this.titleCard.style.borderColor = '#fbbf24';
      this.accentMaterial.emissiveIntensity = 0.85;
    } else if (this.isHovered) {
      this.statusText.text = 'Mantén la mirada (2s)';
      this.statusText.style.color = '#38bdf8';
      this.titleCard.style.borderColor = '#38bdf8';
      this.accentMaterial.emissiveIntensity = 0.6;
    } else if (this.isCompleted) {
      this.statusText.text = `${this.config.subtitle} · Escuchado`;
      this.statusText.style.color = '#34d399';
      this.titleCard.style.borderColor = '#34d399';
      this.accentMaterial.emissiveIntensity = 0.4;
    } else {
      this.statusText.text = this.config.subtitle;
      this.statusText.style.color = '#94a3b8';
      this.titleCard.style.borderColor = '#334155';
      this.accentMaterial.emissiveIntensity = 0.2;
    }
  }

  protected onActivated(): void {}

  update(elapsedSec: number, deltaSec: number): void {
    // Minecraft dropped-item hover bob and slow rotation
    const step = stepHoverTransform(
      this.hoverWeight,
      this.isHovered,
      elapsedSec,
      deltaSec
    );
    this.hoverWeight = step.hoverWeight;
    this.diorama.position.y = step.bobOffsetY;
    if (step.spinSpeedRadPerSec > 0.001) {
      this.diorama.rotation.y += step.spinSpeedRadPerSec * deltaSec;
    } else {
      // Smoothly ease diorama back toward front-facing angle when not hovered
      const deltaAngle = Math.atan2(
        Math.sin(-this.diorama.rotation.y),
        Math.cos(-this.diorama.rotation.y)
      );
      this.diorama.rotation.y +=
        deltaAngle * (1 - Math.exp(-3.5 * Math.min(deltaSec, 0.1)));
    }

    if (this.isActive) {
      this.activeTime += deltaSec;
    }
    this.updateAnimation(elapsedSec, deltaSec);
  }

  protected abstract updateAnimation(elapsedSec: number, deltaSec: number): void;

  dispose(): void {
    this.hitGeometry.dispose();
    this.hitMaterial.dispose();
    this.accentMaterial.dispose();
  }
}

/**
 * Station 1 (Front - 0°): "Las Lenguas y la Teoría"
 * Open brown & beige voxel book with white feather quill and 5 floating colored language cubes.
 */
class StationLenguas extends BaseVoxelStation {
  private readonly languageCubes: THREE.Mesh[] = [];
  private orbitPhase = 0;

  constructor(config: StationConfig, voxels: VoxelBuilder) {
    super(config, voxels);

    const book = new THREE.Group();
    book.position.set(0, -0.08, 0.02);
    book.rotation.x = 0.28; // tilted gently toward viewer

    // Spine
    voxels.addBox(book, {
      x: 0,
      y: 0,
      z: 0,
      sx: 0.08,
      sy: 0.07,
      sz: 0.52,
      color: 0x4a2c18,
    });
    // Left brown leather cover + beige page block
    const leftWing = new THREE.Group();
    leftWing.position.set(-0.03, 0, 0);
    leftWing.rotation.z = -0.22;
    voxels.addBox(leftWing, {
      x: -0.2,
      y: -0.015,
      z: 0,
      sx: 0.4,
      sy: 0.035,
      sz: 0.52,
      color: 0x7c4a26,
    });
    voxels.addBox(leftWing, {
      x: -0.19,
      y: 0.025,
      z: 0,
      sx: 0.36,
      sy: 0.048,
      sz: 0.46,
      color: 0xf3e5c8,
    });
    // Voxel ink lines on left page
    for (let r = 0; r < 4; r++) {
      voxels.addBox(leftWing, {
        x: -0.19,
        y: 0.052,
        z: -0.14 + r * 0.09,
        sx: 0.24,
        sy: 0.008,
        sz: 0.025,
        color: 0x948270,
      });
    }
    book.add(leftWing);

    // Right brown leather cover + beige page block
    const rightWing = new THREE.Group();
    rightWing.position.set(0.03, 0, 0);
    rightWing.rotation.z = 0.22;
    voxels.addBox(rightWing, {
      x: 0.2,
      y: -0.015,
      z: 0,
      sx: 0.4,
      sy: 0.035,
      sz: 0.52,
      color: 0x7c4a26,
    });
    voxels.addBox(rightWing, {
      x: 0.19,
      y: 0.025,
      z: 0,
      sx: 0.36,
      sy: 0.048,
      sz: 0.46,
      color: 0xead8b5,
    });
    for (let r = 0; r < 3; r++) {
      voxels.addBox(rightWing, {
        x: 0.19,
        y: 0.052,
        z: -0.14 + r * 0.09,
        sx: 0.22,
        sy: 0.008,
        sz: 0.025,
        color: 0x948270,
      });
    }
    book.add(rightWing);

    // White voxel feather quill resting diagonally across the right page
    const quill = new THREE.Group();
    quill.position.set(0.18, 0.08, 0.05);
    quill.rotation.set(-0.35, 0.35, -0.45);
    // Dark ink nib
    voxels.addBox(quill, {
      x: 0,
      y: 0,
      z: 0,
      sx: 0.025,
      sy: 0.05,
      sz: 0.025,
      color: 0x334155,
    });
    // Shaft + stepped white feather plume blocks
    voxels.addBox(quill, {
      x: 0,
      y: 0.08,
      z: 0,
      sx: 0.022,
      sy: 0.14,
      sz: 0.022,
      color: 0xe2e8f0,
    });
    voxels.addBox(quill, {
      x: 0.018,
      y: 0.19,
      z: 0,
      sx: 0.068,
      sy: 0.12,
      sz: 0.024,
      color: 0xf8fafc,
    });
    voxels.addBox(quill, {
      x: 0.032,
      y: 0.3,
      z: 0,
      sx: 0.082,
      sy: 0.12,
      sz: 0.024,
      color: 0xffffff,
    });
    voxels.addBox(quill, {
      x: 0.042,
      y: 0.4,
      z: 0,
      sx: 0.045,
      sy: 0.08,
      sz: 0.022,
      color: 0xf1f5f9,
    });
    book.add(quill);

    this.diorama.add(book);

    // 5 small floating colored cubes representing different languages
    const langColors = [0xef4444, 0x3b82f6, 0x10b981, 0xf59e0b, 0xa855f7];
    for (let i = 0; i < langColors.length; i++) {
      const cube = voxels.addBox(this.diorama, {
        sx: 0.095,
        sy: 0.095,
        sz: 0.095,
        color: langColors[i],
        emissive: langColors[i],
        emissiveIntensity: 0.25,
      });
      this.languageCubes.push(cube);
    }

    this.diorama.traverse((obj) => {
      obj.raycast = () => {};
    });
  }

  protected updateAnimation(elapsedSec: number, deltaSec: number): void {
    const orbitSpeed = this.isActive ? 1.55 : 0.28;
    this.orbitPhase += orbitSpeed * deltaSec;
    const radius = this.isActive ? 0.56 : 0.48;

    for (let i = 0; i < this.languageCubes.length; i++) {
      const cube = this.languageCubes[i];
      const angle = this.orbitPhase + (i * Math.PI * 2) / this.languageCubes.length;
      cube.position.set(
        Math.cos(angle) * radius,
        0.24 + Math.sin(elapsedSec * 2.2 + i * 1.1) * (this.isActive ? 0.11 : 0.05),
        Math.sin(angle) * radius * 0.65
      );
      cube.rotation.x = elapsedSec * (this.isActive ? 1.4 : 0.4) + i;
      cube.rotation.y = elapsedSec * (this.isActive ? 1.8 : 0.5) + i;
    }
  }
}

/**
 * Station 2 (Right - 90°): "El Correo y las TIC"
 * Retro blocky desktop monitor + white voxel envelope with red/blue trim.
 * On activation: envelope opens upward and emits glowing yellow voxel particles.
 */
class StationCorreo extends BaseVoxelStation {
  private readonly flapPivot = new THREE.Group();
  private readonly particles: Array<{
    mesh: THREE.Mesh;
    phase: number;
    speed: number;
    driftX: number;
    driftZ: number;
  }> = [];

  constructor(config: StationConfig, voxels: VoxelBuilder) {
    super(config, voxels);

    // Retro blocky desktop monitor (left side)
    const monitor = new THREE.Group();
    monitor.position.set(-0.24, -0.1, 0);

    // Grey base & neck stand
    voxels.addBox(monitor, {
      x: 0,
      y: -0.22,
      z: 0,
      sx: 0.36,
      sy: 0.05,
      sz: 0.28,
      color: 0x94a3b8,
    });
    voxels.addBox(monitor, {
      x: 0,
      y: -0.14,
      z: -0.02,
      sx: 0.14,
      sy: 0.11,
      sz: 0.14,
      color: 0x64748b,
    });
    // Dark frame bezel + CRT rear body
    voxels.addBox(monitor, {
      x: 0,
      y: 0.08,
      z: -0.06,
      sx: 0.44,
      sy: 0.36,
      sz: 0.24,
      color: 0x334155,
    });
    voxels.addBox(monitor, {
      x: 0,
      y: 0.08,
      z: 0.07,
      sx: 0.48,
      sy: 0.4,
      sz: 0.06,
      color: 0x1e293b,
    });
    // Glowing blue screen
    voxels.addBox(monitor, {
      x: 0,
      y: 0.08,
      z: 0.098,
      sx: 0.37,
      sy: 0.29,
      sz: 0.02,
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.95,
    });
    // Tiny retro pixel bars inside screen
    voxels.addBox(monitor, {
      x: -0.06,
      y: 0.13,
      z: 0.112,
      sx: 0.18,
      sy: 0.028,
      sz: 0.01,
      color: 0xe0f2fe,
      emissive: 0xbae6fd,
      emissiveIntensity: 0.8,
    });
    voxels.addBox(monitor, {
      x: -0.02,
      y: 0.07,
      z: 0.112,
      sx: 0.24,
      sy: 0.024,
      sz: 0.01,
      color: 0x7dd3fc,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.7,
    });
    this.diorama.add(monitor);

    // White voxel envelope with red/blue airmail trim (right side)
    const envelope = new THREE.Group();
    envelope.position.set(0.3, -0.08, 0.04);
    envelope.rotation.y = -0.25;

    // Envelope main body
    voxels.addBox(envelope, {
      x: 0,
      y: 0,
      z: 0,
      sx: 0.44,
      sy: 0.28,
      sz: 0.1,
      color: 0xf8fafc,
    });
    // Alternating red & blue trim blocks along left/right edges
    const trimColors = [0xef4444, 0x2563eb];
    for (let i = 0; i < 4; i++) {
      const y = -0.105 + i * 0.07;
      voxels.addBox(envelope, {
        x: -0.215,
        y,
        z: 0.005,
        sx: 0.025,
        sy: 0.05,
        sz: 0.108,
        color: trimColors[i % 2],
      });
      voxels.addBox(envelope, {
        x: 0.215,
        y,
        z: 0.005,
        sx: 0.025,
        sy: 0.05,
        sz: 0.108,
        color: trimColors[(i + 1) % 2],
      });
    }

    // Hinged top flap pivoted along top edge (y = +0.14)
    this.flapPivot.position.set(0, 0.14, 0.04);
    voxels.addBox(this.flapPivot, {
      x: 0,
      y: -0.07,
      z: 0.015,
      sx: 0.42,
      sy: 0.13,
      sz: 0.024,
      color: 0xe2e8f0,
    });
    voxels.addBox(this.flapPivot, {
      x: 0,
      y: -0.13,
      z: 0.016,
      sx: 0.24,
      sy: 0.05,
      sz: 0.026,
      color: 0xcbd5e1,
    });
    // Small red wax seal / stamp block on the flap tip
    voxels.addBox(this.flapPivot, {
      x: 0,
      y: -0.135,
      z: 0.03,
      sx: 0.06,
      sy: 0.05,
      sz: 0.018,
      color: 0xef4444,
    });
    envelope.add(this.flapPivot);

    // Pool of glowing yellow voxel particles rising out of the envelope
    for (let i = 0; i < 10; i++) {
      const particle = voxels.addBox(envelope, {
        x: 0,
        y: 0.14,
        z: 0,
        sx: 0.048,
        sy: 0.048,
        sz: 0.048,
        color: 0xfde047,
        emissive: 0xfacc15,
        emissiveIntensity: 1.1,
      });
      particle.visible = false;
      this.particles.push({
        mesh: particle,
        phase: i / 10,
        speed: 0.45 + (i % 3) * 0.12,
        driftX: ((i % 5) - 2) * 0.08,
        driftZ: (((i * 3) % 5) - 2) * 0.05,
      });
    }

    this.diorama.add(envelope);
    this.diorama.traverse((obj) => {
      obj.raycast = () => {};
    });
  }

  protected updateAnimation(_elapsedSec: number, deltaSec: number): void {
    const targetFlapAngle = this.isActive ? -Math.PI * 0.68 : 0;
    const flapLerp = 1 - Math.exp(-5.5 * Math.min(deltaSec, 0.1));
    this.flapPivot.rotation.x +=
      (targetFlapAngle - this.flapPivot.rotation.x) * flapLerp;

    for (const p of this.particles) {
      if (!this.isActive) {
        p.mesh.visible = false;
        continue;
      }
      p.mesh.visible = true;
      p.phase = (p.phase + p.speed * deltaSec) % 1;
      const t = p.phase;
      p.mesh.position.set(
        p.driftX * t + Math.sin(t * 6.0) * 0.03,
        0.15 + t * 0.58,
        p.driftZ * t
      );
      const scale = Math.sin(t * Math.PI);
      p.mesh.scale.setScalar(0.05 * Math.max(0.15, scale));
      p.mesh.rotation.y += deltaSec * 2.2;
      p.mesh.rotation.x += deltaSec * 1.5;
    }
  }
}

/**
 * Station 3 (Back - 180°): "La Feria y la Conexión"
 * Two blocky Minecraft-style character busts standing apart.
 * On activation: glowing golden voxel bridge builds block-by-block in mid-air connecting both.
 */
class StationFeria extends BaseVoxelStation {
  private readonly bridgeBlocks: THREE.Mesh[] = [];

  constructor(config: StationConfig, voxels: VoxelBuilder) {
    super(config, voxels);

    const buildBust = (
      x: number,
      facingSign: number,
      skinColor: number,
      hairColor: number,
      shirtColor: number
    ) => {
      const bust = new THREE.Group();
      bust.position.set(x, -0.1, 0);
      bust.rotation.y = facingSign * 0.45;

      // Torso
      voxels.addBox(bust, {
        x: 0,
        y: -0.06,
        z: 0,
        sx: 0.22,
        sy: 0.24,
        sz: 0.13,
        color: shirtColor,
      });
      // Arms
      voxels.addBox(bust, {
        x: -0.15,
        y: -0.06,
        z: 0,
        sx: 0.075,
        sy: 0.22,
        sz: 0.1,
        color: shirtColor,
      });
      voxels.addBox(bust, {
        x: 0.15,
        y: -0.06,
        z: 0,
        sx: 0.075,
        sy: 0.22,
        sz: 0.1,
        color: shirtColor,
      });
      // Head
      voxels.addBox(bust, {
        x: 0,
        y: 0.17,
        z: 0,
        sx: 0.21,
        sy: 0.21,
        sz: 0.21,
        color: skinColor,
      });
      // Hair cap
      voxels.addBox(bust, {
        x: 0,
        y: 0.26,
        z: -0.01,
        sx: 0.225,
        sy: 0.075,
        sz: 0.225,
        color: hairColor,
      });
      // Eyes
      voxels.addBox(bust, {
        x: -0.048,
        y: 0.175,
        z: 0.106,
        sx: 0.032,
        sy: 0.032,
        sz: 0.012,
        color: 0x0f172a,
      });
      voxels.addBox(bust, {
        x: 0.048,
        y: 0.175,
        z: 0.106,
        sx: 0.032,
        sy: 0.032,
        sz: 0.012,
        color: 0x0f172a,
      });

      this.diorama.add(bust);
    };

    buildBust(-0.42, 1, 0xf1c27d, 0x3b2314, 0x0d9488);
    buildBust(0.42, -1, 0xe0ac69, 0x7c2d12, 0x4f46e5);

    // 7 glowing golden voxel bridge blocks in mid-air spanning between both busts
    const blockCount = 7;
    for (let i = 0; i < blockCount; i++) {
      const t = i / (blockCount - 1); // 0..1
      const x = THREE.MathUtils.lerp(-0.24, 0.24, t);
      const archY = 0.06 + Math.sin(t * Math.PI) * 0.08;
      const block = voxels.addBox(this.diorama, {
        x,
        y: archY,
        z: 0,
        sx: 0.068,
        sy: 0.055,
        sz: 0.09,
        color: 0xfbbf24,
        emissive: 0xd97706,
        emissiveIntensity: 0.95,
      });
      block.visible = false;
      this.bridgeBlocks.push(block);
    }

    this.diorama.traverse((obj) => {
      obj.raycast = () => {};
    });
  }

  protected updateAnimation(elapsedSec: number): void {
    if (!this.isActive) {
      for (const b of this.bridgeBlocks) {
        b.visible = false;
      }
      return;
    }

    const stepSec = 0.34;
    for (let i = 0; i < this.bridgeBlocks.length; i++) {
      const b = this.bridgeBlocks[i];
      const blockAge = this.activeTime - i * stepSec;
      if (blockAge <= 0) {
        b.visible = false;
        continue;
      }
      b.visible = true;
      const grow = Math.min(1, blockAge / 0.22);
      const pulse =
        grow >= 1 ? 1 + Math.sin(elapsedSec * 3.5 - i * 0.45) * 0.06 : grow;
      b.scale.set(0.068 * pulse, 0.055 * pulse, 0.09 * pulse);
    }
  }
}

/**
 * Station 4 (Left - 270°): "El Puente hasta Bélgica"
 * Blocky blue & green Earth cube + brown voxel parcel box tied with yellow ribbon.
 * On activation: parcel box flies in a gentle parabolic arc from one side of the globe to the other.
 */
class StationBelgica extends BaseVoxelStation {
  private readonly parcelGroup = new THREE.Group();

  constructor(config: StationConfig, voxels: VoxelBuilder) {
    super(config, voxels);

    // Blocky blue & green Earth voxel globe
    const earth = new THREE.Group();
    earth.position.set(0, -0.05, 0);

    // Core ocean blue cube
    voxels.addBox(earth, {
      x: 0,
      y: 0,
      z: 0,
      sx: 0.42,
      sy: 0.42,
      sz: 0.42,
      color: 0x2563eb,
    });
    // Subtle polar ice caps
    voxels.addBox(earth, {
      x: 0,
      y: 0.212,
      z: 0,
      sx: 0.28,
      sy: 0.025,
      sz: 0.28,
      color: 0xe2e8f0,
    });
    // Green voxel continent clusters on front, sides, and top
    const continents = [
      {x: -0.09, y: 0.04, z: 0.215, sx: 0.14, sy: 0.18, sz: 0.028},
      {x: 0.1, y: 0.08, z: 0.215, sx: 0.12, sy: 0.12, sz: 0.028},
      {x: 0.08, y: -0.07, z: 0.215, sx: 0.1, sy: 0.12, sz: 0.028},
      {x: 0.215, y: 0.03, z: 0.02, sx: 0.028, sy: 0.18, sz: 0.16},
      {x: -0.215, y: -0.02, z: -0.03, sx: 0.028, sy: 0.16, sz: 0.16},
      {x: 0.02, y: 0.05, z: -0.215, sx: 0.2, sy: 0.15, sz: 0.028},
    ];
    for (const c of continents) {
      voxels.addBox(earth, {
        ...c,
        color: 0x22c55e,
      });
    }
    this.diorama.add(earth);

    // Brown voxel parcel box tied with a yellow ribbon
    this.parcelGroup.position.set(-0.46, -0.14, 0.12);
    // Brown cardboard box
    voxels.addBox(this.parcelGroup, {
      x: 0,
      y: 0,
      z: 0,
      sx: 0.18,
      sy: 0.16,
      sz: 0.18,
      color: 0xa16207,
    });
    // Yellow ribbon bands wrapping crosswise
    voxels.addBox(this.parcelGroup, {
      x: 0,
      y: 0,
      z: 0,
      sx: 0.19,
      sy: 0.17,
      sz: 0.038,
      color: 0xfacc15,
      emissive: 0xeab308,
      emissiveIntensity: 0.25,
    });
    voxels.addBox(this.parcelGroup, {
      x: 0,
      y: 0,
      z: 0,
      sx: 0.038,
      sy: 0.17,
      sz: 0.19,
      color: 0xfacc15,
      emissive: 0xeab308,
      emissiveIntensity: 0.25,
    });
    // Ribbon bow on top
    voxels.addBox(this.parcelGroup, {
      x: -0.035,
      y: 0.105,
      z: 0,
      sx: 0.05,
      sy: 0.035,
      sz: 0.04,
      color: 0xfde047,
    });
    voxels.addBox(this.parcelGroup, {
      x: 0.035,
      y: 0.105,
      z: 0,
      sx: 0.05,
      sy: 0.035,
      sz: 0.04,
      color: 0xfde047,
    });
    this.diorama.add(this.parcelGroup);

    this.diorama.traverse((obj) => {
      obj.raycast = () => {};
    });
  }

  protected updateAnimation(elapsedSec: number): void {
    if (!this.isActive) {
      this.parcelGroup.position.set(-0.46, -0.14, 0.12);
      this.parcelGroup.rotation.set(0, 0.2, 0);
      return;
    }

    // Gentle parabolic arc from left side (-0.48) over the globe to right side (+0.48)
    const cycleSec = 3.2;
    const t = (this.activeTime % cycleSec) / cycleSec; // 0..1
    const smoothT = t < 0.85 ? t / 0.85 : 1; // pause briefly on landing
    const x = THREE.MathUtils.lerp(-0.48, 0.48, smoothT);
    const arcY = -0.12 + Math.sin(smoothT * Math.PI) * 0.56;
    const z = 0.14 + Math.sin(smoothT * Math.PI) * 0.18;

    this.parcelGroup.position.set(x, arcY, z);
    this.parcelGroup.rotation.set(
      Math.sin(smoothT * Math.PI) * 0.25,
      elapsedSec * 0.8,
      Math.cos(smoothT * Math.PI) * 0.18
    );
  }
}

export function createVoxelStations(voxels: VoxelBuilder): StationInstance[] {
  return [
    new StationLenguas(STATIONS[0], voxels),
    new StationCorreo(STATIONS[1], voxels),
    new StationFeria(STATIONS[2], voxels),
    new StationBelgica(STATIONS[3], voxels),
  ];
}
