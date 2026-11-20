import * as THREE from 'three';

export interface VoxelSpec {
  x?: number;
  y?: number;
  z?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  color: number;
  emissive?: number;
  emissiveIntensity?: number;
}

/**
 * Lightweight flyweight factory sharing a single unit BoxGeometry and cached
 * flat-shaded MeshLambertMaterials for low-end mobile WebXR performance.
 */
export class VoxelBuilder {
  readonly unitCube = new THREE.BoxGeometry(1, 1, 1);
  private readonly materials = new Map<string, THREE.MeshLambertMaterial>();

  getMaterial(
    color: number,
    emissive = 0x000000,
    emissiveIntensity = 0
  ): THREE.MeshLambertMaterial {
    const key = `${color}_${emissive}_${emissiveIntensity.toFixed(2)}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshLambertMaterial({
        color,
        emissive,
        emissiveIntensity,
      });
      this.materials.set(key, material);
    }
    return material;
  }

  addBox(parent: THREE.Object3D, spec: VoxelSpec): THREE.Mesh {
    const material = this.getMaterial(
      spec.color,
      spec.emissive ?? 0x000000,
      spec.emissiveIntensity ?? 0
    );
    const mesh = new THREE.Mesh(this.unitCube, material);
    mesh.position.set(spec.x ?? 0, spec.y ?? 0, spec.z ?? 0);
    mesh.scale.set(spec.sx ?? 1, spec.sy ?? 1, spec.sz ?? 1);
    if (spec.rx || spec.ry || spec.rz) {
      mesh.rotation.set(spec.rx ?? 0, spec.ry ?? 0, spec.rz ?? 0);
    }
    parent.add(mesh);
    return mesh;
  }

  dispose(): void {
    this.unitCube.dispose();
    for (const material of this.materials.values()) {
      material.dispose();
    }
    this.materials.clear();
  }
}
