import * as THREE from 'three';

import {
  SCENE_BACKGROUND_HEX,
  STATIONS,
  STATION_RADIUS_METERS,
  getStationWorldPosition,
} from '../constants';
import {VoxelBuilder} from './VoxelBuilder';
import {wrapCloudZ} from './gazeState';

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

interface CloudCluster {
  group: THREE.Group;
  x: number;
  y: number;
  z: number;
  speed: number;
}

/**
 * Cozy, stylized voxel airplane cabin interior surrounding the user:
 * - Central carpeted aisle floor + side cabin flooring + central user seat pod
 * - Rows of blocky teal-blue passenger seats with white headrests & armrests
 * - Curved white/light-grey fuselage walls with rectangular airplane windows on both sides
 * - Overhead luggage compartments with warm recessed cove lighting strips
 * - Forward cockpit bulkhead & aft galley bulkhead
 * - Bright blue daytime sky dome with drifting blocky white clouds outside both windows
 */
export class EnvironmentAndFloor extends THREE.Group {
  private readonly skyGeometry: THREE.SphereGeometry;
  private readonly skyMaterial: THREE.MeshBasicMaterial;
  private readonly skyDome: THREE.Mesh;
  private readonly floorTiles: THREE.InstancedMesh;
  private readonly floorMaterial: THREE.MeshLambertMaterial;
  private readonly indicatorGroup = new THREE.Group();
  private readonly indicatorBlocks: THREE.Mesh[] = [];
  private readonly indicatorMaterial: THREE.MeshLambertMaterial;
  private readonly clouds: CloudCluster[] = [];
  private targetAngleRad: number | null = null;
  private pulseTime = 0;

  constructor(private readonly voxels: VoxelBuilder) {
    super();
    this.name = 'VoxelAirplaneCabin';

    // Opaque daytime sky dome surrounding the aircraft exterior
    this.skyGeometry = new THREE.SphereGeometry(46, 24, 16);
    this.skyMaterial = new THREE.MeshBasicMaterial({
      color: SCENE_BACKGROUND_HEX,
      side: THREE.BackSide,
      fog: false,
    });
    this.skyDome = new THREE.Mesh(this.skyGeometry, this.skyMaterial);
    this.skyDome.name = 'DaySkyDome';
    this.skyDome.raycast = () => {};
    this.add(this.skyDome);

    this.floorMaterial = new THREE.MeshLambertMaterial({color: 0xffffff});
    this.indicatorMaterial = new THREE.MeshLambertMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.95,
      transparent: true,
      opacity: 0.94,
    });

    this.buildCloudsAndHorizon();
    this.buildCabinLighting();
    this.floorTiles = this.buildCabinFloor();
    this.buildFuselageWallsAndBins();
    this.buildEndBulkheads();
    this.buildPassengerSeats();
    this.buildStationPedestals();
    this.buildFloorIndicator();
  }

  private buildCloudsAndHorizon(): void {

    // Subtle sunlit horizon mist band outside the lower sky hemisphere
    this.voxels.addBox(this, {
      x: 0,
      y: -14,
      z: 0,
      sx: 72,
      sy: 0.5,
      sz: 72,
      color: 0xbae6fd,
      emissive: 0x7dd3fc,
      emissiveIntensity: 0.45,
    }).raycast = () => {};

    // Blocky white clouds floating past both left and right airplane windows
    const cloudConfigs: Array<{
      side: -1 | 1;
      distX: number;
      y: number;
      z: number;
      scale: number;
      speed: number;
    }> = [
      {side: -1, distX: 11.5, y: 1.4, z: -18, scale: 1.15, speed: 1.15},
      {side: -1, distX: 15.0, y: 2.3, z: -10, scale: 1.35, speed: 0.95},
      {side: -1, distX: 12.2, y: 0.7, z: -2.5, scale: 1.05, speed: 1.25},
      {side: -1, distX: 16.5, y: 2.8, z: 4.5, scale: 1.4, speed: 0.85},
      {side: -1, distX: 13.0, y: 1.1, z: 12.0, scale: 1.2, speed: 1.1},
      {side: -1, distX: 18.0, y: 0.3, z: 19.5, scale: 1.45, speed: 0.78},
      {side: 1, distX: 12.0, y: 1.6, z: -16, scale: 1.2, speed: 1.05},
      {side: 1, distX: 16.0, y: 2.5, z: -7.5, scale: 1.4, speed: 0.88},
      {side: 1, distX: 11.8, y: 0.9, z: 0.5, scale: 1.05, speed: 1.22},
      {side: 1, distX: 15.2, y: 2.1, z: 8.5, scale: 1.3, speed: 0.92},
      {side: 1, distX: 12.8, y: 0.5, z: 16.0, scale: 1.15, speed: 1.12},
      {side: 1, distX: 18.5, y: 2.9, z: 22.0, scale: 1.5, speed: 0.75},
    ];

    const puffs = [
      {x: 0, y: 0, z: 0, sx: 2.6, sy: 0.85, sz: 1.6, color: 0xffffff},
      {x: 0.1, y: 0.55, z: -0.25, sx: 1.6, sy: 0.75, sz: 1.25, color: 0xf8fafc},
      {x: -0.2, y: 0.35, z: 0.75, sx: 1.5, sy: 0.65, sz: 1.15, color: 0xffffff},
      {x: 0.25, y: -0.25, z: 0.5, sx: 1.9, sy: 0.55, sz: 1.4, color: 0xe0f2fe},
    ];

    for (const cfg of cloudConfigs) {
      const group = new THREE.Group();
      const x = cfg.side * cfg.distX;
      group.position.set(x, cfg.y, cfg.z);
      group.scale.setScalar(cfg.scale);
      for (const puff of puffs) {
        const mesh = this.voxels.addBox(group, {
          ...puff,
          emissive: 0xe0f2fe,
          emissiveIntensity: 0.35,
        });
        mesh.raycast = () => {};
      }
      this.add(group);
      this.clouds.push({
        group,
        x,
        y: cfg.y,
        z: cfg.z,
        speed: cfg.speed,
      });
    }
  }

  private buildCabinLighting(): void {
    // Bright, warm interior cabin lighting so every voxel detail pops on mobile screens
    this.add(new THREE.AmbientLight(0xfff7ed, 1.1));
    this.add(new THREE.HemisphereLight(0xfffbeb, 0xcbd5e1, 1.05));

    const overheadDir = new THREE.DirectionalLight(0xfff5e4, 0.95);
    overheadDir.position.set(2.0, 5.5, 1.5);
    this.add(overheadDir);

    const fillDir = new THREE.DirectionalLight(0xe0f2fe, 0.45);
    fillDir.position.set(-3.0, 2.5, -2.0);
    this.add(fillDir);

    // Two soft warm overhead cabin point lights along the central ceiling
    const foreLight = new THREE.PointLight(0xffe7c2, 2.4, 12, 1.2);
    foreLight.position.set(0, 2.85, -2.4);
    this.add(foreLight);

    const aftLight = new THREE.PointLight(0xffe7c2, 2.4, 12, 1.2);
    aftLight.position.set(0, 2.85, 2.4);
    this.add(aftLight);
  }

  private buildCabinFloor(): THREE.InstancedMesh {
    // Solid structural sub-deck beneath tiles so exterior sky never shows through floor seams
    const subDeck = this.voxels.addBox(this, {
      x: 0,
      y: -0.09,
      z: 0,
      sx: 7.7,
      sy: 0.14,
      sz: 13.6,
      color: 0x1e293b,
    });
    subDeck.raycast = () => {};

    // Instanced voxel floor tiles: cozy navy carpeted central aisle + slate side decking
    const tiles: Array<{x: number; z: number; tint: number}> = [];
    const tileSize = 0.56;
    for (let gx = -6; gx <= 6; gx++) {
      for (let gz = -11; gz <= 11; gz++) {
        const x = gx * tileSize;
        const z = gz * tileSize;
        const isAisle = Math.abs(gx) <= 1 || Math.abs(gz) <= 1;
        const checker = (gx + gz) & 1;
        let tint: number;
        if (Math.abs(gx) <= 1) {
          tint = checker === 0 ? 0x1e3a5f : 0x254773; // deep cozy airline aisle carpet
        } else if (isAisle) {
          tint = checker === 0 ? 0x284b76 : 0x2f5584; // mid-cabin cross-aisle lounge
        } else {
          tint = checker === 0 ? 0x475569 : 0x526175; // side seat floor decking
        }
        tiles.push({x, z, tint});
      }
    }

    const instanced = new THREE.InstancedMesh(
      this.voxels.unitCube,
      this.floorMaterial,
      tiles.length
    );
    instanced.name = 'CabinFloorTiles';
    tiles.forEach((tile, i) => {
      _pos.set(tile.x, -0.015, tile.z);
      _quat.identity();
      _scale.set(tileSize * 0.96, 0.04, tileSize * 0.96);
      _mat4.compose(_pos, _quat, _scale);
      instanced.setMatrixAt(i, _mat4);
      instanced.setColorAt(i, _color.setHex(tile.tint));
    });
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) {
      instanced.instanceColor.needsUpdate = true;
    }
    instanced.computeBoundingSphere();
    instanced.raycast = () => {};
    this.add(instanced);

    // Subtle warm aisle guide strips flanking the main aisle (interrupted around mid cross-aisle)
    for (const side of [-1, 1] as const) {
      for (const zCenter of [-4.15, 4.15]) {
        const strip = this.voxels.addBox(this, {
          x: side * 0.88,
          y: 0.012,
          z: zCenter,
          sx: 0.06,
          sy: 0.018,
          sz: 4.5,
          color: 0xfbbf24,
          emissive: 0xf59e0b,
          emissiveIntensity: 0.35,
        });
        strip.raycast = () => {};
      }
    }

    return instanced;
  }

  private buildFuselageWallsAndBins(): void {
    const wallX = 3.76;
    const bayWidth = 1.7;
    const bayCentersZ = [-5.1, -3.4, -1.7, 0.0, 1.7, 3.4, 5.1];

    for (const side of [-1, 1] as const) {
      const wx = side * wallX;

      // Continuous lower cabin wall dado + warm sky-blue trim line
      const lowerWall = this.voxels.addBox(this, {
        x: wx,
        y: 0.36,
        z: 0,
        sx: 0.24,
        sy: 0.72,
        sz: 13.4,
        color: 0xdbe3ec,
      });
      lowerWall.raycast = () => {};

      const trimLine = this.voxels.addBox(this, {
        x: wx - side * 0.13,
        y: 0.7,
        z: 0,
        sx: 0.04,
        sy: 0.06,
        sz: 13.3,
        color: 0x0ea5e9,
      });
      trimLine.raycast = () => {};

      // Continuous upper header above rectangular windows
      const upperHeader = this.voxels.addBox(this, {
        x: wx,
        y: 1.84,
        z: 0,
        sx: 0.24,
        sy: 0.28,
        sz: 13.4,
        color: 0xf1f5f9,
      });
      upperHeader.raycast = () => {};

      // Curved white/light-grey upper cabin wall bevels
      const curve1 = this.voxels.addBox(this, {
        x: side * 3.5,
        y: 2.15,
        z: 0,
        sx: 0.22,
        sy: 0.5,
        sz: 13.4,
        rz: side * 0.44,
        color: 0xf1f5f9,
      });
      curve1.raycast = () => {};

      // Overhead luggage compartments (bins) with seam dividers, handles, and warm LED cove
      const binBody = this.voxels.addBox(this, {
        x: side * 2.9,
        y: 2.66,
        z: 0,
        sx: 0.96,
        sy: 0.56,
        sz: 13.2,
        color: 0xe2e8f0,
      });
      binBody.raycast = () => {};

      const binFace = this.voxels.addBox(this, {
        x: side * 2.42,
        y: 2.64,
        z: 0,
        sx: 0.08,
        sy: 0.46,
        sz: 13.1,
        rz: side * -0.18,
        color: 0xf8fafc,
      });
      binFace.raycast = () => {};

      const coveLight = this.voxels.addBox(this, {
        x: side * 2.86,
        y: 2.36,
        z: 0,
        sx: 0.22,
        sy: 0.05,
        sz: 13.0,
        color: 0xfef3c7,
        emissive: 0xfde68a,
        emissiveIntensity: 0.85,
      });
      coveLight.raycast = () => {};

      // Window pillars + rectangular airplane window frames + bin latches per bay
      for (let i = 0; i < bayCentersZ.length; i++) {
        const zCenter = bayCentersZ[i];

        // Wall pillar on the -Z edge of each bay (leaving center open as rectangular window!)
        const pillarZ = zCenter - bayWidth * 0.5;
        const pillar = this.voxels.addBox(this, {
          x: wx,
          y: 1.21,
          z: pillarZ,
          sx: 0.24,
          sy: 0.98,
          sz: 0.78,
          color: 0xf1f5f9,
        });
        pillar.raycast = () => {};

        // Structural curved rib accent between bays
        const rib = this.voxels.addBox(this, {
          x: side * 3.58,
          y: 1.35,
          z: pillarZ,
          sx: 0.08,
          sy: 1.45,
          sz: 0.12,
          color: 0xcbd5e1,
        });
        rib.raycast = () => {};

        // Overhead bin divider seam + latch handle
        const binSeam = this.voxels.addBox(this, {
          x: side * 2.37,
          y: 2.64,
          z: pillarZ,
          sx: 0.04,
          sy: 0.44,
          sz: 0.04,
          color: 0x94a3b8,
        });
        binSeam.raycast = () => {};

        const latch = this.voxels.addBox(this, {
          x: side * 2.36,
          y: 2.48,
          z: zCenter,
          sx: 0.05,
          sy: 0.06,
          sz: 0.24,
          color: 0x475569,
        });
        latch.raycast = () => {};

        // Rectangular window bezel (top, bottom sill, left & right trim)
        const sill = this.voxels.addBox(this, {
          x: wx - side * 0.03,
          y: 0.74,
          z: zCenter,
          sx: 0.28,
          sy: 0.06,
          sz: 0.94,
          color: 0xcbd5e1,
        });
        sill.raycast = () => {};

        const topFrame = this.voxels.addBox(this, {
          x: wx - side * 0.03,
          y: 1.68,
          z: zCenter,
          sx: 0.26,
          sy: 0.06,
          sz: 0.94,
          color: 0x94a3b8,
        });
        topFrame.raycast = () => {};

        for (const dz of [-0.45, 0.45]) {
          const sideFrame = this.voxels.addBox(this, {
            x: wx - side * 0.02,
            y: 1.21,
            z: zCenter + dz,
            sx: 0.25,
            sy: 0.9,
            sz: 0.07,
            color: 0x94a3b8,
          });
          sideFrame.raycast = () => {};
        }
      }

      // Final closing pillar at +Z end
      const endPillar = this.voxels.addBox(this, {
        x: wx,
        y: 1.21,
        z: 6.1,
        sx: 0.24,
        sy: 0.98,
        sz: 1.1,
        color: 0xf1f5f9,
      });
      endPillar.raycast = () => {};
    }

    // Arched cabin ceiling panels + dual warm recessed overhead light strips
    const ceilingMain = this.voxels.addBox(this, {
      x: 0,
      y: 3.16,
      z: 0,
      sx: 5.0,
      sy: 0.22,
      sz: 13.6,
      color: 0xf8fafc,
    });
    ceilingMain.raycast = () => {};

    for (const side of [-1, 1] as const) {
      const ceilingLight = this.voxels.addBox(this, {
        x: side * 0.72,
        y: 3.04,
        z: 0,
        sx: 0.22,
        sy: 0.04,
        sz: 12.6,
        color: 0xfffbeb,
        emissive: 0xfef08a,
        emissiveIntensity: 0.9,
      });
      ceilingLight.raycast = () => {};
    }
  }

  private buildEndBulkheads(): void {
    for (const endSign of [-1, 1] as const) {
      const bz = endSign * 6.65;
      // Full-width light-grey/white bulkhead wall closing the fuselage
      const wall = this.voxels.addBox(this, {
        x: 0,
        y: 1.65,
        z: bz,
        sx: 7.7,
        sy: 3.3,
        sz: 0.28,
        color: 0xe2e8f0,
      });
      wall.raycast = () => {};

      // Warm cabin accent stripe across bulkhead
      const stripe = this.voxels.addBox(this, {
        x: 0,
        y: 0.7,
        z: bz - endSign * 0.15,
        sx: 7.4,
        sy: 0.08,
        sz: 0.04,
        color: 0x0284c7,
      });
      stripe.raycast = () => {};

      // Stylized cockpit (front) or galley/exit (aft) cabin door
      const doorFrame = this.voxels.addBox(this, {
        x: 0,
        y: 1.15,
        z: bz - endSign * 0.15,
        sx: 1.12,
        sy: 2.26,
        sz: 0.06,
        color: 0x94a3b8,
      });
      doorFrame.raycast = () => {};

      const doorPanel = this.voxels.addBox(this, {
        x: 0,
        y: 1.12,
        z: bz - endSign * 0.18,
        sx: 0.94,
        sy: 2.1,
        sz: 0.05,
        color: 0xcbd5e1,
      });
      doorPanel.raycast = () => {};

      // Small tinted porthole + handle
      const porthole = this.voxels.addBox(this, {
        x: 0,
        y: 1.62,
        z: bz - endSign * 0.21,
        sx: 0.3,
        sy: 0.34,
        sz: 0.03,
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.35,
      });
      porthole.raycast = () => {};

      const handle = this.voxels.addBox(this, {
        x: 0.34,
        y: 1.05,
        z: bz - endSign * 0.22,
        sx: 0.12,
        sy: 0.05,
        sz: 0.05,
        color: 0x475569,
      });
      handle.raycast = () => {};

      // Glowing green EXIT sign above aft door, warm cabin light sign above front cockpit door
      const sign = this.voxels.addBox(this, {
        x: 0,
        y: 2.46,
        z: bz - endSign * 0.18,
        sx: 0.42,
        sy: 0.14,
        sz: 0.05,
        color: endSign > 0 ? 0x22c55e : 0x38bdf8,
        emissive: endSign > 0 ? 0x16a34a : 0x0284c7,
        emissiveIntensity: 0.85,
      });
      sign.raycast = () => {};
    }
  }

  private buildPassengerSeats(): void {
    const createSeat = (x: number, z: number, facingRad = 0) => {
      const seat = new THREE.Group();
      seat.position.set(x, 0, z);
      seat.rotation.y = facingRad;

      // Brushed metal base legs
      this.voxels.addBox(seat, {
        x: 0,
        y: 0.14,
        z: 0,
        sx: 0.42,
        sy: 0.24,
        sz: 0.44,
        color: 0x64748b,
      });
      // Teal-blue seat cushion
      this.voxels.addBox(seat, {
        x: 0,
        y: 0.33,
        z: -0.02,
        sx: 0.52,
        sy: 0.14,
        sz: 0.54,
        color: 0x0284c7,
      });
      // Backrest (kept below eye level 1.45m)
      this.voxels.addBox(seat, {
        x: 0,
        y: 0.66,
        z: 0.2,
        sx: 0.5,
        sy: 0.58,
        sz: 0.14,
        color: 0x0369a1,
      });
      // Crisp white airline headrest cover
      this.voxels.addBox(seat, {
        x: 0,
        y: 0.88,
        z: 0.18,
        sx: 0.36,
        sy: 0.18,
        sz: 0.16,
        color: 0xf8fafc,
      });
      // Left & right armrests
      for (const armX of [-0.28, 0.28]) {
        this.voxels.addBox(seat, {
          x: armX,
          y: 0.48,
          z: 0.02,
          sx: 0.07,
          sy: 0.08,
          sz: 0.46,
          color: 0xcbd5e1,
        });
      }
      seat.traverse((c) => {
        c.raycast = () => {};
      });
      this.add(seat);
    };

    // 4 rows of voxel passenger seats arranged symmetrically around the cabin lounge
    // Positioned diagonally/behind stations so all 4 cardinal gaze directions stay wide open
    const seatLayout: Array<{x: number; z: number}> = [
      // Fore row (behind Station 1)
      {x: -2.45, z: -4.7},
      {x: -1.72, z: -4.7},
      {x: 1.72, z: -4.7},
      {x: 2.45, z: -4.7},
      // Mid-fore diagonal row
      {x: -2.65, z: -1.85},
      {x: -1.92, z: -1.85},
      {x: 1.92, z: -1.85},
      {x: 2.65, z: -1.85},
      // Mid-aft diagonal row
      {x: -2.65, z: 1.85},
      {x: -1.92, z: 1.85},
      {x: 1.92, z: 1.85},
      {x: 2.65, z: 1.85},
      // Aft row (behind Station 3)
      {x: -2.45, z: 4.7},
      {x: -1.72, z: 4.7},
      {x: 1.72, z: 4.7},
      {x: 2.45, z: 4.7},
    ];

    for (const s of seatLayout) {
      createSeat(s.x, s.z, 0);
    }

    // Cozy central user seat pod right beneath the camera (0, 1.45, 0), low profile so 180° view is unobstructed
    const userPod = new THREE.Group();
    this.voxels.addBox(userPod, {
      x: 0,
      y: 0.12,
      z: 0,
      sx: 0.62,
      sy: 0.22,
      sz: 0.62,
      color: 0x475569,
    });
    this.voxels.addBox(userPod, {
      x: 0,
      y: 0.3,
      z: 0,
      sx: 0.68,
      sy: 0.14,
      sz: 0.68,
      color: 0x0284c7,
    });
    for (const armX of [-0.36, 0.36]) {
      this.voxels.addBox(userPod, {
        x: armX,
        y: 0.44,
        z: 0,
        sx: 0.08,
        sy: 0.12,
        sz: 0.56,
        color: 0xe2e8f0,
      });
    }
    userPod.traverse((c) => {
      c.raycast = () => {};
    });
    this.add(userPod);
  }

  private buildStationPedestals(): void {
    // Sleek cozy cabin display pedestals beneath each of the 4 interactive stations
    for (const station of STATIONS) {
      const pos = getStationWorldPosition(
        station.angleRad,
        STATION_RADIUS_METERS,
        0
      );
      const ped = new THREE.Group();
      ped.position.set(pos.x, 0, pos.z);
      ped.rotation.y = -station.angleRad;
      this.voxels.addBox(ped, {
        x: 0,
        y: 0.08,
        z: 0,
        sx: 0.9,
        sy: 0.16,
        sz: 0.9,
        color: 0x94a3b8,
      });
      this.voxels.addBox(ped, {
        x: 0,
        y: 0.3,
        z: 0,
        sx: 0.48,
        sy: 0.34,
        sz: 0.48,
        color: 0x475569,
      });
      this.voxels.addBox(ped, {
        x: 0,
        y: 0.51,
        z: 0,
        sx: 0.72,
        sy: 0.08,
        sz: 0.72,
        color: 0xe2e8f0,
      });
      ped.traverse((child) => {
        child.raycast = () => {};
      });
      this.add(ped);
    }
  }

  private buildFloorIndicator(): void {
    this.indicatorGroup.name = 'NextStationFloorIndicator';
    this.indicatorGroup.visible = false;

    const arrowBlocks: Array<{x: number; z: number; sx: number; sz: number}> = [
      {x: 0, z: -0.95, sx: 0.12, sz: 0.12},
      {x: 0, z: -1.3, sx: 0.14, sz: 0.14},
      {x: 0, z: -1.65, sx: 0.16, sz: 0.16},
      {x: 0, z: -2.05, sx: 0.22, sz: 0.16},
      {x: -0.17, z: -1.89, sx: 0.15, sz: 0.14},
      {x: 0.17, z: -1.89, sx: 0.15, sz: 0.14},
    ];
    for (const b of arrowBlocks) {
      const m = new THREE.Mesh(this.voxels.unitCube, this.indicatorMaterial);
      m.position.set(b.x, 0.035, b.z);
      m.scale.set(b.sx, 0.05, b.sz);
      m.raycast = () => {};
      this.indicatorBlocks.push(m);
      this.indicatorGroup.add(m);
    }
    this.add(this.indicatorGroup);
  }

  applySceneAtmosphere(scene: THREE.Scene): void {
    scene.background = new THREE.Color(SCENE_BACKGROUND_HEX);
    scene.fog = null;
  }

  setNextStationTarget(stationIndex: number | null): void {
    if (stationIndex === null || !STATIONS[stationIndex]) {
      this.targetAngleRad = null;
      this.indicatorGroup.visible = false;
      return;
    }
    this.targetAngleRad = STATIONS[stationIndex].angleRad;
    this.indicatorGroup.rotation.y = -this.targetAngleRad;
    this.indicatorGroup.visible = true;
  }

  update(deltaSec: number): void {
    // Drift blocky white clouds gently past the cabin windows
    for (const cloud of this.clouds) {
      cloud.z = wrapCloudZ(cloud.z, cloud.speed, deltaSec, 24);
      cloud.group.position.z = cloud.z;
    }

    if (!this.indicatorGroup.visible) return;
    this.pulseTime += deltaSec;
    for (let i = 0; i < this.indicatorBlocks.length; i++) {
      const wave = Math.sin(this.pulseTime * 4.2 - i * 0.55) * 0.5 + 0.5;
      this.indicatorBlocks[i].position.y = 0.03 + wave * 0.025;
    }
    this.indicatorMaterial.emissiveIntensity =
      0.7 + (Math.sin(this.pulseTime * 3.5) * 0.5 + 0.5) * 0.65;
  }

  dispose(): void {
    this.skyGeometry.dispose();
    this.skyMaterial.dispose();
    this.floorMaterial.dispose();
    this.indicatorMaterial.dispose();
  }
}
