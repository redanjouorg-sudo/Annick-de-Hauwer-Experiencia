import * as THREE from 'three';

const RETICLE_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RETICLE_FRAGMENT_SHADER = `
  uniform float uProgress;
  uniform float uHovering;
  uniform float uCompleted;
  uniform vec3 uBaseColor;
  uniform vec3 uProgressColor;
  uniform vec3 uCompleteColor;
  varying vec2 vUv;

  const float PI = 3.14159265359;
  const float TWO_PI = 6.28318530718;

  void main() {
    vec2 p = vUv - vec2(0.5);
    float r = length(p);

    // Center dot (grows gently when hovering a station)
    float dotRadius = mix(0.065, 0.088, uHovering);
    float dotMask = 1.0 - smoothstep(dotRadius - 0.015, dotRadius + 0.015, r);

    // Subtle track ring shown during hover/dwell
    float ringInner = 0.25;
    float ringOuter = 0.36;
    float ringDist = max(ringInner - r, r - ringOuter);
    float trackMask = (1.0 - smoothstep(-0.015, 0.015, ringDist)) * mix(0.22, 0.55, uHovering);

    // Clockwise angular progress starting at 12 o'clock (top: +Y)
    float angle = atan(p.x, p.y); // -PI..PI, 0 at top, positive clockwise
    if (angle < 0.0) angle += TWO_PI;
    float normAngle = angle / TWO_PI;

    float arcSpan = clamp(uProgress, 0.0, 1.0);
    float progressArc = step(normAngle, arcSpan) * step(0.001, arcSpan);
    float progressRingMask = (1.0 - smoothstep(-0.018, 0.018, ringDist)) * progressArc;

    vec3 ringColor = mix(uProgressColor, uCompleteColor, uCompleted);

    vec3 color = uBaseColor * dotMask;
    float alpha = dotMask * 0.96;

    // Dark subtle backing halo for readability against bright cabin walls and windows
    float haloAlpha = mix(0.32, 0.72, max(trackMask, uHovering * 0.6));
    color = mix(color, vec3(0.05, 0.08, 0.14), haloAlpha * (1.0 - dotMask));
    alpha = max(alpha, haloAlpha * (trackMask + 0.35 * dotMask));

    // Crisp subtle white track outline
    color = mix(color, uBaseColor, trackMask * 0.55);
    alpha = max(alpha, trackMask * 0.58);

    // Active progress fill arc
    if (progressRingMask > 0.001) {
      color = mix(color, ringColor, progressRingMask);
      alpha = max(alpha, progressRingMask * 0.96);
    }

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();

/**
 * Central Cardboard-style Gaze Reticle with a 2-second circular progress ring.
 * Converges at the intersected station's depth in stereo VR to eliminate eye strain.
 */
export class GazeReticle extends THREE.Group {
  private readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    super();
    this.name = 'GazeReticle';

    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: {value: 0},
        uHovering: {value: 0},
        uCompleted: {value: 0},
        uBaseColor: {value: new THREE.Color(0xf8fafc)},
        uProgressColor: {value: new THREE.Color(0x38bdf8)},
        uCompleteColor: {value: new THREE.Color(0xfbbf24)},
      },
      vertexShader: RETICLE_VERTEX_SHADER,
      fragmentShader: RETICLE_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 9999;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    this.add(this.mesh);
  }

  updateFromGaze(
    camera: THREE.Camera,
    hitDistance: number | null,
    progress: number,
    isHovering: boolean,
    isCompleted: boolean
  ): void {
    camera.getWorldPosition(_rayOrigin);
    camera.getWorldDirection(_rayDir);

    const dist = hitDistance !== null ? Math.max(0.7, hitDistance - 0.08) : 2.4;
    this.position.copy(_rayOrigin).addScaledVector(_rayDir, dist);
    this.quaternion.copy(camera.quaternion);

    // Keep angular size consistent regardless of depth
    const angularScale = dist * 0.085;
    this.mesh.scale.setScalar(angularScale);

    this.material.uniforms.uProgress.value = THREE.MathUtils.clamp(progress, 0, 1);
    this.material.uniforms.uHovering.value = isHovering ? 1 : 0;
    this.material.uniforms.uCompleted.value = isCompleted ? 1 : 0;
  }

  dispose(): void {
    this.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
