import * as THREE from 'three';
import { samplePose, enGardePose } from './poseBuffer';
import type { FencerSnapshot, Side, Weapon, ViewMode } from './types';

type ScoreLightColor = 'green' | 'red' | 'white' | 'off';

interface ScoreLamp {
  material: THREE.MeshStandardMaterial;
  light: THREE.PointLight;
}

interface ScoreRig {
  player: ScoreLamp;
  ai: ScoreLamp;
}

interface Limb {
  upper: THREE.Mesh;
  lower: THREE.Mesh;
  joint: THREE.Mesh;
  cuff?: THREE.Mesh;
  upperRadius: number;
  lowerRadius: number;
  jointRadius: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const BLADE_AXIS = new THREE.Vector3(0, 0, 1);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function smooth01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function actionProgress(action: FencerSnapshot['action']): number {
  return action.duration > 0 ? clamp01(action.elapsed / action.duration) : 1;
}

function actionPeak(action: FencerSnapshot['action']): number {
  if (action.hitAt <= 0 || action.duration <= 0) return 0.42;
  const normalized = action.hitAt <= 1 && action.duration > 1
    ? action.hitAt
    : action.hitAt / action.duration;
  return Math.max(0.18, Math.min(0.78, normalized));
}

function attackEnvelope(progress: number, peak: number): number {
  if (progress <= peak) return 1 - Math.pow(1 - clamp01(progress / peak), 3);
  return 1 - smooth01((progress - peak) / (1 - peak));
}

function createFabricTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const weave = ((x % 4 === 0) ? 10 : 0) + ((y % 4 === 0) ? 8 : 0);
      const grain = ((x * 17 + y * 31) % 11) - 5;
      const value = Math.max(0, Math.min(255, 128 + weave + grain));
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createBrushedMetalTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const brush = ((x * 13 + y * 3) % 17) - 8;
      const fineLine = y % 9 === 0 ? 15 : 0;
      const value = Math.max(0, Math.min(255, 126 + brush + fineLine));
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 16);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function setLamp(lamp: ScoreLamp, state: ScoreLightColor): void {
  const on = state !== 'off';
  const color = state === 'green' ? 0x35ff91 : state === 'red' ? 0xff334b : 0xf4f6e9;
  lamp.material.color.setHex(on ? color : 0x192022);
  lamp.material.emissive.setHex(on ? color : 0x000000);
  lamp.material.emissiveIntensity = on ? 3.4 : 0;
  lamp.light.color.setHex(on ? color : 0x000000);
  lamp.light.intensity = on ? (state === 'white' ? 6 : 9) : 0;
  lamp.light.visible = on;
}

function setSegment(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3, radius: number): void {
  const delta = new THREE.Vector3().subVectors(end, start);
  const length = Math.max(0.0001, delta.length());
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, delta.multiplyScalar(1 / length));
  mesh.scale.set(radius, length, radius);
}

function solveElbow(
  shoulder: THREE.Vector3,
  hand: THREE.Vector3,
  upperLength: number,
  lowerLength: number,
  bendHint: THREE.Vector3,
): THREE.Vector3 {
  const direction = new THREE.Vector3().subVectors(hand, shoulder);
  const actualDistance = Math.max(0.0001, direction.length());
  direction.multiplyScalar(1 / actualDistance);
  const distance = Math.min(actualDistance, (upperLength + lowerLength) * 0.985);
  const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const bend = bendHint.clone().addScaledVector(direction, -bendHint.dot(direction));
  if (bend.lengthSq() < 0.00001) bend.set(0, -1, 0);
  bend.normalize();
  return shoulder.clone().addScaledVector(direction, along).addScaledVector(bend, height);
}

/** Dark, broadcast-oriented fencing hall with a regulation-size metallic piste. */
export class Arena {
  private readonly root = new THREE.Group();
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly scoreRigs: ScoreRig[] = [];
  private readonly ceilingPanels: THREE.MeshStandardMaterial[] = [];
  private readonly fans: THREE.Group[] = [];

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'fencing-arena';
    this.scene.add(this.root);
    this.scene.background = new THREE.Color(0x070b0e);
    this.scene.fog = new THREE.Fog(0x070b0e, 18, 43);

    this.buildPiste();
    this.buildHall();
    this.buildLighting();
    this.buildDetails();
    this.buildScoreRig(-6.15);
    this.buildScoreRig(6.15);
    this.setScoreLights('off', 'off');
  }

  private addBox(
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    parent: THREE.Object3D = this.root,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.boxGeometry, material);
    mesh.scale.set(width, height, depth);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private buildPiste(): void {
    const rubber = new THREE.MeshStandardMaterial({ color: 0x11171a, roughness: 0.94, metalness: 0.04 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x20292d, roughness: 0.46, metalness: 0.72 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x55636a, roughness: 0.32, metalness: 0.9 });
    const markings = new THREE.MeshStandardMaterial({ color: 0xd8ddd8, roughness: 0.58, metalness: 0.15 });
    const warning = new THREE.MeshStandardMaterial({ color: 0xb9b39b, roughness: 0.62, metalness: 0.12 });
    const brushed = createBrushedMetalTexture();
    const piste = new THREE.MeshStandardMaterial({
      color: 0x879398,
      roughness: 0.4,
      metalness: 0.84,
      bumpMap: brushed,
      bumpScale: 0.012,
    });

    this.addBox(24, 0.22, 26, 0, -0.2, 0, rubber);
    this.addBox(3.2, 0.11, 15.2, 0, -0.06, 0, darkMetal);
    this.addBox(2, 0.075, 14, 0, -0.025, 0, piste);
    this.addBox(0.055, 0.055, 14.12, -1.027, 0.005, 0, trim);
    this.addBox(0.055, 0.055, 14.12, 1.027, 0.005, 0, trim);

    for (const x of [-2.35, 2.35]) {
      this.addBox(2.45, 0.065, 16.2, x, -0.035, 0, rubber);
      this.addBox(0.035, 0.018, 15.8, x + Math.sign(x) * 1.19, 0.006, 0, trim);
    }
    for (const z of [-7.65, 7.65]) {
      this.addBox(6.9, 0.065, 1.25, 0, -0.035, z, rubber);
    }

    const seamMaterial = new THREE.MeshStandardMaterial({ color: 0x3f4a4f, roughness: 0.52, metalness: 0.72 });
    const seamCount = 13;
    const seams = new THREE.InstancedMesh(this.boxGeometry, seamMaterial, seamCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < seamCount; i += 1) {
      dummy.position.set(0, 0.015, -6 + i);
      dummy.scale.set(1.96, 0.004, 0.009);
      dummy.updateMatrix();
      seams.setMatrixAt(i, dummy.matrix);
    }
    seams.receiveShadow = true;
    this.root.add(seams);

    for (const x of [-0.975, 0.975]) {
      this.addBox(0.025, 0.007, 13.96, x, 0.017, 0, markings);
    }
    this.addBox(1.95, 0.008, 0.055, 0, 0.018, 0, markings);
    for (const z of [-2, 2]) this.addBox(1.95, 0.008, 0.05, 0, 0.018, z, markings);
    for (const z of [-5, 5]) {
      this.addBox(1.95, 0.008, 0.065, 0, 0.018, z, warning);
      for (let i = 0; i < 5; i += 1) {
        this.addBox(0.16, 0.008, 0.018, -0.4 + i * 0.2, 0.019, z + Math.sign(z) * 0.12, warning);
      }
    }
    for (const z of [-6.965, 6.965]) this.addBox(1.95, 0.008, 0.07, 0, 0.018, z, markings);

    const screwGeometry = new THREE.CylinderGeometry(0.017, 0.017, 0.007, 8);
    const screws = new THREE.InstancedMesh(screwGeometry, trim, 16);
    let index = 0;
    for (const x of [-0.91, 0.91]) {
      for (let z = -6.3; z <= 6.31; z += 1.8) {
        dummy.position.set(x, 0.021, z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        screws.setMatrixAt(index, dummy.matrix);
        index += 1;
      }
    }
    screws.count = index;
    this.root.add(screws);
  }

  private buildHall(): void {
    const wall = new THREE.MeshStandardMaterial({ color: 0x10171b, roughness: 0.86, metalness: 0.18 });
    const wallInset = new THREE.MeshStandardMaterial({ color: 0x171f24, roughness: 0.76, metalness: 0.3 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x253037, roughness: 0.46, metalness: 0.78 });
    const black = new THREE.MeshStandardMaterial({ color: 0x090d10, roughness: 0.75, metalness: 0.35 });
    const dimLed = new THREE.MeshStandardMaterial({
      color: 0x254148,
      emissive: 0x38717a,
      emissiveIntensity: 0.4,
      roughness: 0.4,
    });

    this.addBox(21, 5.8, 0.25, 0, 2.65, -11.5, wall);
    this.addBox(21, 5.8, 0.25, 0, 2.65, 11.5, wall);
    this.addBox(0.25, 5.8, 23, -10.5, 2.65, 0, wall);
    this.addBox(0.25, 5.8, 23, 10.5, 2.65, 0, wall);

    for (const x of [-7.8, 7.8]) {
      for (const z of [-9, -3, 3, 9]) {
        this.addBox(0.28, 5.7, 0.38, x, 2.62, z, steel);
        this.addBox(0.42, 0.12, 0.52, x, 0.02, z, black);
      }
      this.addBox(0.18, 0.18, 20, x, 5.25, 0, steel);
    }
    for (const z of [-8, -4, 0, 4, 8]) {
      this.addBox(15.8, 0.16, 0.18, 0, 5.25, z, steel);
      this.addBox(15.8, 0.045, 0.045, 0, 4.91, z, black);
    }

    for (const x of [-6, -3, 0, 3, 6]) {
      this.addBox(2.82, 2.1, 0.06, x, 2.15, -11.34, wallInset);
      this.addBox(2.82, 0.035, 0.04, x, 3.23, -11.29, steel);
    }
    for (const x of [-4.55, 4.55]) {
      this.addBox(0.035, 3.4, 0.025, x, 2.5, -11.28, dimLed);
    }
    for (const x of [-3.7, 3.7]) {
      this.addBox(0.025, 0.018, 15.5, x, 0.015, 0, dimLed);
    }

    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row += 1) {
        const x = side * (6.25 + row * 0.48);
        this.addBox(1.05, 0.16, 7.5, x, 0.32 + row * 0.34, 0, black);
        this.addBox(0.12, 0.34 + row * 0.34, 7.1, x + side * 0.3, 0.12 + row * 0.17, 0, wallInset);
      }
    }
  }

  private buildLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xbfd7e3, 0x172025, 1.35);
    this.root.add(hemisphere);

    const key = new THREE.DirectionalLight(0xd7e9f2, 2.1);
    key.position.set(-4, 7, 5);
    this.root.add(key);

    const rim = new THREE.DirectionalLight(0x7396aa, 1.15);
    rim.position.set(5, 4, -7);
    this.root.add(rim);

    const housing = new THREE.MeshStandardMaterial({ color: 0x1c262b, roughness: 0.38, metalness: 0.82 });
    for (let i = 0; i < 3; i += 1) {
      const z = -5 + i * 5;
      const panel = new THREE.MeshStandardMaterial({
        color: 0xd8e5e8,
        emissive: 0xc7e5ef,
        emissiveIntensity: 2.5,
        roughness: 0.28,
      });
      this.ceilingPanels.push(panel);
      this.addBox(3.5, 0.13, 0.78, 0, 5.02, z, housing);
      this.addBox(3.22, 0.025, 0.58, 0, 4.945, z, panel);
      for (const x of [-1.45, 1.45]) this.addBox(0.035, 0.28, 0.035, x, 5.18, z, housing);

      const spot = new THREE.SpotLight(0xd9edf3, 165, 18, 0.69, 0.72, 2);
      spot.position.set(0, 4.88, z);
      spot.target.position.set(0, 0, z - 0.35);
      spot.castShadow = i === 1;
      if (spot.castShadow) {
        spot.shadow.mapSize.set(1024, 1024);
        spot.shadow.camera.near = 0.5;
        spot.shadow.camera.far = 15;
        spot.shadow.bias = -0.00025;
        spot.shadow.normalBias = 0.025;
      }
      this.root.add(spot, spot.target);
    }
  }

  private buildDetails(): void {
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a3439, roughness: 0.42, metalness: 0.8 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0d1215, roughness: 0.72, metalness: 0.3 });
    const consoleMaterial = new THREE.MeshStandardMaterial({ color: 0x1d272c, roughness: 0.55, metalness: 0.5 });
    const display = new THREE.MeshStandardMaterial({
      color: 0x243b40,
      emissive: 0x4a98a0,
      emissiveIntensity: 0.65,
      roughness: 0.32,
    });

    this.addBox(0.85, 0.08, 1.9, 3.15, 0.82, 0, consoleMaterial);
    for (const z of [-0.75, 0.75]) {
      this.addBox(0.07, 0.78, 0.07, 2.86, 0.4, z, steel);
      this.addBox(0.07, 0.78, 0.07, 3.44, 0.4, z, steel);
    }
    const console = this.addBox(0.56, 0.22, 0.68, 3.12, 0.96, 0, black);
    console.rotation.z = -0.12;
    this.addBox(0.018, 0.12, 0.42, 2.824, 1.0, 0, display);

    for (const z of [-1.35, 1.35]) {
      const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.16, 20), black);
      reel.position.set(2.55, 0.19, z);
      reel.castShadow = true;
      this.root.add(reel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.17, 16), steel);
      hub.position.copy(reel.position);
      this.root.add(hub);
    }

    for (const x of [-4.75, 4.75]) {
      for (const z of [-5.5, 0, 5.5]) this.addBox(0.075, 0.85, 0.075, x, 0.39, z, steel);
      this.addBox(0.06, 0.06, 11.1, x, 0.79, 0, steel);
    }

    const fanMaterial = new THREE.MeshStandardMaterial({ color: 0x344148, roughness: 0.5, metalness: 0.72 });
    for (const x of [-7.1, 7.1]) {
      const fan = new THREE.Group();
      fan.position.set(x, 3.85, -11.29);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.025, 8, 32), fanMaterial);
      fan.add(ring);
      for (let i = 0; i < 4; i += 1) {
        const blade = this.addBox(0.095, 0.65, 0.025, 0, 0, 0.01, fanMaterial, fan);
        blade.rotation.z = i * Math.PI * 0.5 + 0.35;
      }
      this.root.add(fan);
      this.fans.push(fan);
    }
  }

  private buildScoreRig(z: number): void {
    const housing = new THREE.MeshStandardMaterial({ color: 0x0b1013, roughness: 0.5, metalness: 0.65 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x39464c, roughness: 0.4, metalness: 0.84 });
    const x = 1.75;
    const y = 2.35;
    this.addBox(0.075, 2.2, 0.075, x, 1.1, z, steel);
    this.addBox(0.48, 0.055, 0.42, x, 0.025, z, housing);
    this.addBox(0.82, 0.34, 0.18, x, y, z, housing);
    this.addBox(0.7, 0.025, 0.025, x, y + 0.21, z, steel);

    const makeLamp = (lampX: number): ScoreLamp => {
      const material = new THREE.MeshStandardMaterial({
        color: 0x192022,
        roughness: 0.24,
        metalness: 0.08,
      });
      const bulbGeometry = new THREE.SphereGeometry(0.092, 18, 12);
      for (const face of [-1, 1]) {
        const bulb = new THREE.Mesh(bulbGeometry, material);
        bulb.position.set(lampX, y, z + face * 0.092);
        this.root.add(bulb);
      }
      const light = new THREE.PointLight(0xffffff, 0, 3.2, 2);
      light.position.set(lampX, y, z);
      light.visible = false;
      this.root.add(light);
      return { material, light };
    };

    this.scoreRigs.push({ player: makeLamp(x - 0.205), ai: makeLamp(x + 0.205) });
  }

  setScoreLights(player: ScoreLightColor, ai: ScoreLightColor): void {
    for (const rig of this.scoreRigs) {
      setLamp(rig.player, player);
      setLamp(rig.ai, ai);
    }
  }

  update(time: number): void {
    for (let i = 0; i < this.ceilingPanels.length; i += 1) {
      this.ceilingPanels[i].emissiveIntensity = 2.48 + Math.sin(time * 0.55 + i * 1.7) * 0.045;
    }
    for (let i = 0; i < this.fans.length; i += 1) {
      this.fans[i].rotation.z = time * (0.12 + i * 0.025);
    }
  }
}

/** Procedural, articulated fencer. The blade is independently aligned to engine world-space endpoints. */
export class FencerVisual {
  private readonly root = new THREE.Group();
  private readonly motion = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly weaponGroup = new THREE.Group();
  private readonly limbGeometry = new THREE.CylinderGeometry(0.84, 1, 1, 12, 1, false);
  private readonly jointGeometry = new THREE.SphereGeometry(1, 12, 8);
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly clothTexture = createFabricTexture();
  private pelvis!: THREE.Mesh;
  private rightArm!: Limb;
  private leftArm!: Limb;
  private rightLeg!: Limb;
  private leftLeg!: Limb;
  private rightHand!: THREE.Group;
  private leftHand!: THREE.Group;
  private rightFoot!: THREE.Group;
  private leftFoot!: THREE.Group;
  private blade!: THREE.Mesh;
  private bladeButton!: THREE.Mesh;
  private time = 0;
  private extension = 0;
  private aimX = 0;
  private aimY = 0;
  private lunge = 0;
  private fleche = 0;
  private attack = 0;
  private feint = 0;
  private parryAmount = 0;
  private prise = 0;
  private hit = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly side: Side,
    private readonly weapon: Weapon,
  ) {
    this.root.name = `${side}-fencer`;
    this.root.position.set(0, 0, side === 'player' ? 2.4 : -2.4);
    this.root.rotation.y = side === 'player' ? 0 : Math.PI;
    this.motion.name = 'articulated-body';
    this.torso.name = 'torso-pivot';
    this.head.name = 'mask-and-head';
    this.weaponGroup.name = `${weapon}-world-aligned`;

    this.scene.add(this.root);
    this.root.add(this.motion);
    this.motion.add(this.torso);
    this.torso.add(this.head);
    this.buildBody();
    this.buildWeapon();
    this.scene.add(this.weaponGroup);

    const direction = side === 'player' ? -1 : 1;
    const handX = side === 'player' ? 0.3 : -0.3;
    const z = side === 'player' ? 2.4 : -2.4;
    this.update({
      side,
      position: { x: 0, y: 0, z },
      aim: { x: 0, y: 0 },
      action: { type: 'idle', elapsed: 0, duration: 1, hitAt: 0.4, hasHit: false },
      extension: 0,
      parry: 0,
      bladeBase: { x: handX, y: 1.23, z: z + direction * 0.36 },
      bladeTip: { x: handX, y: 1.26, z: z + direction * 1.28 },
      speed: 0,
    }, 1 / 60, 'third');
  }

  get group(): THREE.Group {
    return this.root;
  }

  private addBox(
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    parent: THREE.Object3D,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.boxGeometry, material);
    mesh.scale.set(width, height, depth);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private createLimb(
    upperRadius: number,
    lowerRadius: number,
    jointRadius: number,
    material: THREE.Material,
    cuffMaterial?: THREE.Material,
  ): Limb {
    const upper = new THREE.Mesh(this.limbGeometry, material);
    const lower = new THREE.Mesh(this.limbGeometry, material);
    const joint = new THREE.Mesh(this.jointGeometry, material);
    upper.castShadow = true;
    lower.castShadow = true;
    joint.castShadow = true;
    this.motion.add(upper, lower, joint);
    let cuff: THREE.Mesh | undefined;
    if (cuffMaterial) {
      cuff = new THREE.Mesh(this.limbGeometry, cuffMaterial);
      cuff.castShadow = true;
      this.motion.add(cuff);
    }
    return { upper, lower, joint, cuff, upperRadius, lowerRadius, jointRadius };
  }

  private createGlove(material: THREE.Material): THREE.Group {
    const glove = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
    palm.scale.set(0.052, 0.044, 0.072);
    palm.castShadow = true;
    glove.add(palm);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.065, 12), material);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = 0.055;
    cuff.castShadow = true;
    glove.add(cuff);
    this.motion.add(glove);
    return glove;
  }

  private createShoe(leather: THREE.Material, sole: THREE.Material, accent: THREE.Material): THREE.Group {
    const foot = new THREE.Group();
    const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.14, 4, 10), leather);
    shoe.rotation.x = Math.PI / 2;
    shoe.scale.z = 0.62;
    shoe.position.set(0, 0.072, -0.045);
    shoe.castShadow = true;
    foot.add(shoe);
    this.addBox(0.137, 0.025, 0.278, 0, 0.025, -0.045, sole, foot);
    this.addBox(0.105, 0.012, 0.038, 0, 0.119, -0.025, accent, foot);
    this.motion.add(foot);
    return foot;
  }

  private createMaskGrid(): THREE.LineSegments {
    const positions: number[] = [];
    const rx = 0.151;
    const ry = 0.176;
    const rz = 0.172;
    const point = (x: number, y: number): THREE.Vector3 => {
      const z = -rz * Math.sqrt(Math.max(0.025, 1 - (x * x) / (rx * rx) - (y * y) / (ry * ry))) - 0.002;
      return new THREE.Vector3(x, y, z);
    };
    const addLine = (a: THREE.Vector3, b: THREE.Vector3): void => {
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    };

    for (let i = 0; i <= 10; i += 1) {
      const x = -0.132 + i * 0.0264;
      const yMax = ry * Math.sqrt(Math.max(0, 1 - (x * x) / (rx * rx))) * 0.94;
      for (let j = 0; j < 16; j += 1) {
        addLine(point(x, -yMax + (2 * yMax * j) / 16), point(x, -yMax + (2 * yMax * (j + 1)) / 16));
      }
    }
    for (let i = 0; i <= 13; i += 1) {
      const y = -0.151 + i * (0.302 / 13);
      const xMax = rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))) * 0.94;
      for (let j = 0; j < 14; j += 1) {
        addLine(point(-xMax + (2 * xMax * j) / 14, y), point(-xMax + (2 * xMax * (j + 1)) / 14, y));
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0xadb8ba, transparent: true, opacity: 0.72 });
    return new THREE.LineSegments(geometry, material);
  }

  private buildBody(): void {
    const white = new THREE.MeshStandardMaterial({
      color: 0xe3e6e1,
      roughness: 0.79,
      metalness: 0.015,
      bumpMap: this.clothTexture,
      bumpScale: 0.006,
    });
    const socks = new THREE.MeshStandardMaterial({
      color: 0xd5dad6,
      roughness: 0.72,
      metalness: 0.01,
      bumpMap: this.clothTexture,
      bumpScale: 0.004,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x141b1f, roughness: 0.65, metalness: 0.18 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x101619, roughness: 0.43, metalness: 0.16 });
    const sole = new THREE.MeshStandardMaterial({ color: 0x30383a, roughness: 0.83, metalness: 0.02 });
    const accent = new THREE.MeshStandardMaterial({
      color: this.side === 'player' ? 0x235f55 : 0x702e3b,
      roughness: 0.56,
      metalness: 0.2,
    });
    const steel = new THREE.MeshStandardMaterial({ color: 0x727f83, roughness: 0.34, metalness: 0.88 });
    const maskMetal = new THREE.MeshStandardMaterial({ color: 0x303a3e, roughness: 0.43, metalness: 0.82 });

    const jacketPoints = [
      new THREE.Vector2(0.18, 0),
      new THREE.Vector2(0.195, 0.07),
      new THREE.Vector2(0.205, 0.22),
      new THREE.Vector2(0.235, 0.39),
      new THREE.Vector2(0.25, 0.47),
      new THREE.Vector2(0.205, 0.54),
      new THREE.Vector2(0.115, 0.57),
    ];
    const jacket = new THREE.Mesh(new THREE.LatheGeometry(jacketPoints, 24), white);
    jacket.scale.z = 0.7;
    // 衣服底部对齐腰部（pelvis 世界 y≈0.90，torso.position.y≈0.02）
    // LatheGeometry 自身 y ∈ [0, 0.57]，mesh.position.y = 0.88 让 jacket 底部世界 y ≈ 0.90
    jacket.position.y = 0.88;
    jacket.castShadow = true;
    jacket.receiveShadow = true;
    this.torso.add(jacket);

    this.pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.22, 0.22, 20), white);
    this.pelvis.scale.z = 0.73;
    this.pelvis.castShadow = true;
    this.motion.add(this.pelvis);

    // 所有在 torso.local 下的衣物零件统一 +0.88 抬高（对齐 jacket 底边）
    this.addBox(0.016, 0.45, 0.012, 0.045, 1.17, -0.162, dark, this.torso);
    this.addBox(0.095, 0.022, 0.025, 0.21, 1.355, -0.11, accent, this.torso).rotation.z = -0.3;
    this.addBox(0.095, 0.022, 0.025, -0.21, 1.355, -0.11, accent, this.torso).rotation.z = 0.3;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.015, 7, 24), dark);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.448;
    this.torso.add(collar);
    for (let i = 0; i < 4; i += 1) {
      const snap = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), steel);
      snap.position.set(0.058, 1.03 + i * 0.095, -0.174);
      this.torso.add(snap);
    }

    this.rightArm = this.createLimb(0.077, 0.061, 0.067, white, dark);
    this.leftArm = this.createLimb(0.075, 0.058, 0.064, white, dark);
    this.rightLeg = this.createLimb(0.102, 0.067, 0.086, white);
    this.leftLeg = this.createLimb(0.102, 0.067, 0.086, white);
    this.rightLeg.lower.material = socks;
    this.leftLeg.lower.material = socks;
    this.rightHand = this.createGlove(white);
    this.leftHand = this.createGlove(white);
    this.rightFoot = this.createShoe(leather, sole, accent);
    this.leftFoot = this.createShoe(leather, sole, accent);

    this.head.position.set(0, 1.68, -0.005);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.073, 0.088, 0.12, 16), dark);
    neck.position.y = -0.19;
    neck.castShadow = true;
    this.head.add(neck);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), maskMetal);
    helmet.scale.set(0.15, 0.175, 0.17);
    helmet.castShadow = true;
    this.head.add(helmet);

    const backPanel = new THREE.Mesh(new THREE.SphereGeometry(1.008, 20, 14, 0, Math.PI), accent);
    backPanel.scale.set(0.15, 0.175, 0.17);
    this.head.add(backPanel);
    this.head.add(this.createMaskGrid());
    const maskFrame = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 7, 36), steel);
    maskFrame.scale.set(0.145, 0.17, 0.7);
    maskFrame.position.z = -0.047;
    this.head.add(maskFrame);
    const bib = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.17, 20, 1, true), white);
    bib.position.set(0, -0.19, -0.035);
    bib.rotation.x = -0.14;
    bib.castShadow = true;
    this.head.add(bib);
    this.addBox(0.025, 0.11, 0.015, 0, 0.158, 0.055, accent, this.head).rotation.x = 0.4;

    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  private buildWeapon(): void {
    const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0xc8d2d4, roughness: 0.19, metalness: 0.97 });
    const guardMaterial = new THREE.MeshStandardMaterial({
      color: this.weapon === 'sabre' ? 0x9aa5a6 : 0xb8c2c3,
      roughness: 0.25,
      metalness: 0.94,
      side: THREE.DoubleSide,
    });
    const gripMaterial = new THREE.MeshStandardMaterial({
      color: this.side === 'player' ? 0x183d38 : 0x48232a,
      roughness: 0.72,
      metalness: 0.08,
    });

    if (this.weapon === 'foil') {
      this.blade = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 1), bladeMaterial);
    } else if (this.weapon === 'epee') {
      const geometry = new THREE.CylinderGeometry(0.0055, 0.008, 1, 3, 1, false);
      geometry.rotateX(Math.PI / 2);
      this.blade = new THREE.Mesh(geometry, bladeMaterial);
    } else {
      this.blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 1), bladeMaterial);
    }
    this.blade.castShadow = true;
    this.weaponGroup.add(this.blade);

    const guardRadius = this.weapon === 'epee' ? 0.103 : this.weapon === 'foil' ? 0.075 : 0.086;
    const bowl = new THREE.Mesh(
      new THREE.SphereGeometry(guardRadius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      guardMaterial,
    );
    bowl.rotation.x = Math.PI / 2;
    bowl.position.z = -0.006;
    bowl.castShadow = true;
    this.weaponGroup.add(bowl);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(guardRadius, 0.005, 7, 28), guardMaterial);
    rim.position.z = -0.006;
    this.weaponGroup.add(rim);

    if (this.weapon === 'sabre') {
      const knuckleBow = new THREE.Mesh(new THREE.TorusGeometry(0.096, 0.006, 7, 28, Math.PI * 1.35), guardMaterial);
      knuckleBow.position.z = -0.065;
      knuckleBow.rotation.z = -0.55;
      this.weaponGroup.add(knuckleBow);
    }

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.022, 0.13, 12), gripMaterial);
    grip.rotation.x = Math.PI / 2;
    grip.position.z = -0.085;
    grip.castShadow = true;
    this.weaponGroup.add(grip);
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), guardMaterial);
    pommel.scale.z = 0.7;
    pommel.position.z = -0.158;
    this.weaponGroup.add(pommel);

    const buttonGeometry = new THREE.CylinderGeometry(
      this.weapon === 'epee' ? 0.009 : 0.007,
      this.weapon === 'epee' ? 0.009 : 0.007,
      0.014,
      8,
    );
    buttonGeometry.rotateX(Math.PI / 2);
    this.bladeButton = new THREE.Mesh(buttonGeometry, guardMaterial);
    this.weaponGroup.add(this.bladeButton);
  }

  private updateLimb(limb: Limb, start: THREE.Vector3, joint: THREE.Vector3, end: THREE.Vector3): void {
    setSegment(limb.upper, start, joint, limb.upperRadius);
    setSegment(limb.lower, joint, end, limb.lowerRadius);
    limb.joint.position.copy(joint);
    limb.joint.scale.setScalar(limb.jointRadius);
    if (limb.cuff) {
      const cuffStart = joint.clone().lerp(end, 0.8);
      const cuffEnd = joint.clone().lerp(end, 0.96);
      setSegment(limb.cuff, cuffStart, cuffEnd, limb.lowerRadius * 1.06);
    }
  }

  private updateWeapon(base: THREE.Vector3, tip: THREE.Vector3): THREE.Vector3 {
    const direction = new THREE.Vector3().subVectors(tip, base);
    const length = Math.max(0.001, direction.length());
    direction.multiplyScalar(1 / length);
    this.weaponGroup.position.copy(base);
    this.weaponGroup.quaternion.setFromUnitVectors(BLADE_AXIS, direction);
    this.blade.position.set(0, 0, length * 0.5);
    this.blade.scale.z = length;
    this.bladeButton.position.set(0, 0, Math.max(0, length - 0.007));
    this.weaponGroup.updateMatrixWorld(true);
    return direction;
  }

  /** 单一权威写入点：pose buffer 驱动身体，IK 解肘、engine bladeTip 驱动武器。
   *  所有骨骼只在本方法的帧末被写一次，避免多源覆盖竞争。
   */
  update(snapshot: FencerSnapshot, dt: number, viewMode: ViewMode): void {
    const stepDt = Math.min(0.05, Math.max(0, dt));
    this.time += stepDt;

    // --- 1) 从 pose buffer 取权威姿态 progress ∈ [0,1]，parry 编号参与动态模板 ---
    const action = snapshot.action;
    const progress = actionProgress(action);
    const weapon = this.weapon;
    const bufferPose = samplePose(action.type, progress, snapshot.parry, weapon);
    // idle 时在 pose buffer 已有呼吸变化基础上再叠一层呼吸
    const breathingY = action.type === 'idle' ? Math.sin(this.time * 1.65 + (this.side === 'ai' ? 1.3 : 0)) * 0.005 : 0;

    // --- 2) root 层：整体位置 + 朝向 ---
    const targetPosition = new THREE.Vector3(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    this.root.position.lerp(targetPosition, 1 - Math.exp(-18 * stepDt));
    this.root.rotation.y = this.side === 'player' ? 0 : Math.PI;

    // motionLift 来自 pose buffer（ballestra / fleche 的跳跃）
    this.motion.position.y = bufferPose.motionLift;

    // --- 3) pelvis + torso（pose buffer 基础 + 呼吸增量）---
    const pelvisY = bufferPose.pelvisPos[1] + breathingY;
    const pelvisZ = bufferPose.pelvisPos[2];
    this.pelvis.position.set(bufferPose.pelvisPos[0], pelvisY, pelvisZ);

    // torso 叠加 aim 微调：瞄准方向 → 躯干侧扭（小量，保持专业感）
    const aimX = THREE.MathUtils.clamp(snapshot.aim.x, -1, 1);
    const aimY = THREE.MathUtils.clamp(snapshot.aim.y, -1, 1);
    const disengaged = action.disengaged ? Math.sin(progress * Math.PI * 2) * 0.04 : 0;
    this.torso.position.set(
      bufferPose.torsoPos[0],
      bufferPose.torsoPos[1] + breathingY,
      bufferPose.torsoPos[2],
    );
    this.torso.rotation.set(
      bufferPose.torsoRot[0] + aimY * 0.04,          // aimY → torso 俯仰
      bufferPose.torsoRot[1] - aimX * 0.06 - disengaged, // aimX → torso 侧扭
      bufferPose.torsoRot[2],
    );

    // --- 4) head（pose buffer 基础 + aim 头瞄，不跟随 torso 扭动）---
    this.head.position.set(bufferPose.headPos[0], bufferPose.headPos[1] + breathingY * 0.3, bufferPose.headPos[2]);
    this.head.rotation.set(
      bufferPose.headRot[0] + aimY * 0.12,
      bufferPose.headRot[1] - aimX * 0.18,
      bufferPose.headRot[2],
    );
    this.head.visible = viewMode === 'third' || this.side === 'ai';

    // --- 5) 武器：继续由 engine bladeTip / bladeBase 驱动，与 pose buffer 解耦 ---
    const base = new THREE.Vector3(snapshot.bladeBase.x, snapshot.bladeBase.y, snapshot.bladeBase.z);
    const tip = new THREE.Vector3(snapshot.bladeTip.x, snapshot.bladeTip.y, snapshot.bladeTip.z);
    const bladeDirection = this.updateWeapon(base, tip);
    this.root.updateMatrixWorld(true);

    // --- 6) 手臂：IK 解肘，以 pose buffer 的 hand 目标为驱动 ---
    this.torso.updateMatrix();
    // 肩点（torso.local 下），对应解剖意义上的上臂旋转中心
    const rightShoulderWorld = new THREE.Vector3(0.225, 1.60, 0).applyMatrix4(this.torso.matrix);
    const leftShoulderWorld = new THREE.Vector3(-0.225, 1.60, 0).applyMatrix4(this.torso.matrix);

    // swordHand 在 pose buffer 中是 "相对于 torso 中心" 的局部量；
    // 叠加 aimX → 剑尖侧摆（视觉上手随瞄准）、disengage → 绕开偏移、bladeDirection → 保持与武器方向一致
    const swordHandTorsoLocal = new THREE.Vector3(
      bufferPose.swordHandTorsoLocal[0] + aimX * 0.025 + disengaged * 0.03,
      bufferPose.swordHandTorsoLocal[1] + aimY * 0.015,
      bufferPose.swordHandTorsoLocal[2],
    );
    // 把 swordHandTorsoLocal 转到 world，再转回 motion.local（solveElbow 期望 world 输入）
    const swordHandWorld = swordHandTorsoLocal.clone().applyMatrix4(this.torso.matrix);
    const swordHandLocal = this.motion.worldToLocal(swordHandWorld);
    const rightElbow = solveElbow(rightShoulderWorld, swordHandWorld, 0.3, 0.275, new THREE.Vector3(0.85, -0.5, 0.24));
    this.updateLimb(this.rightArm, rightShoulderWorld, rightElbow, swordHandWorld);
    this.rightHand.position.copy(swordHandLocal);

    const offHandTorsoLocal = new THREE.Vector3(
      bufferPose.offHandTorsoLocal[0],
      bufferPose.offHandTorsoLocal[1],
      bufferPose.offHandTorsoLocal[2],
    );
    const offHandWorld = offHandTorsoLocal.clone().applyMatrix4(this.torso.matrix);
    const offHandLocal = this.motion.worldToLocal(offHandWorld);
    const leftElbow = solveElbow(leftShoulderWorld, offHandWorld, 0.29, 0.265, new THREE.Vector3(-0.85, -0.2, 0.5));
    this.updateLimb(this.leftArm, leftShoulderWorld, leftElbow, offHandWorld);
    this.leftHand.position.copy(offHandLocal);

    // --- 7) 腿：pose buffer 给出的 world-local 坐标直接作为目标 ---
    const rightAnkleRoot = new THREE.Vector3(...bufferPose.rightAnkleRootLocal);
    const rightKneeRoot = new THREE.Vector3(...bufferPose.rightKneeRootLocal);
    const leftAnkleRoot = new THREE.Vector3(...bufferPose.leftAnkleRootLocal);
    const leftKneeRoot = new THREE.Vector3(...bufferPose.leftKneeRootLocal);
    // 髋部关节 = pelvis 位置 + hipPelvisLocal
    const rightHipWorld = new THREE.Vector3(
      bufferPose.pelvisPos[0] + bufferPose.rightHipPelvisLocal[0],
      bufferPose.pelvisPos[1] + bufferPose.rightHipPelvisLocal[1] + breathingY,
      bufferPose.pelvisPos[2] + bufferPose.rightHipPelvisLocal[2],
    );
    const leftHipWorld = new THREE.Vector3(
      bufferPose.pelvisPos[0] + bufferPose.leftHipPelvisLocal[0],
      bufferPose.pelvisPos[1] + bufferPose.leftHipPelvisLocal[1] + breathingY,
      bufferPose.pelvisPos[2] + bufferPose.leftHipPelvisLocal[2],
    );
    // 统一用 root world（root 没有额外 translate 除了 motion.position.y 的跳跃已在上面加了）
    this.updateLimb(this.rightLeg, rightHipWorld, rightKneeRoot, rightAnkleRoot);
    this.updateLimb(this.leftLeg, leftHipWorld, leftKneeRoot, leftAnkleRoot);

    // --- 8) 脚：yaw 来自 pose buffer，位置与 ankle 对齐 ---
    this.rightFoot.position.copy(rightAnkleRoot);
    this.leftFoot.position.copy(leftAnkleRoot);
    this.rightFoot.rotation.y = bufferPose.rightFootYaw;
    this.leftFoot.rotation.y = bufferPose.leftFootYaw;
  }

  dispose(): void {
    this.scene.remove(this.root, this.weaponGroup);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const collect = (object: THREE.Object3D): void => {
      const renderable = object as THREE.Mesh;
      if (renderable.geometry) geometries.add(renderable.geometry);
      const material = renderable.material;
      if (Array.isArray(material)) {
        for (const entry of material) materials.add(entry);
      } else if (material) {
        materials.add(material);
      }
    };
    this.root.traverse(collect);
    this.weaponGroup.traverse(collect);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.clothTexture.dispose();
  }
}
