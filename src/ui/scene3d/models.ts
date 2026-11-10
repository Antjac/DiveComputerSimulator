// Static 3D models: the diver, the water around, the boat, the depth overlays.
import * as THREE from 'three';
import { mulberry32 } from './math';

/**
 * Diver in their suit, BCD and tank, with fins (kicked by the animation) and a dive torch. Returns the
 * body, hidden once the textured model (loadDiverModel) is in.
 */
export function buildDiver(diver: THREE.Group, pitch: THREE.Group, fins: THREE.Group[], torch: THREE.SpotLight): THREE.Group {
    const body = new THREE.Group();
    pitch.add(body);
    const suit = new THREE.MeshStandardMaterial({ color: 0x1b2733, roughness: 0.7 });
    const bcd = new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.8 });
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.35, metalness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.3, metalness: 0.9 });
    const finMat = new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.6, side: THREE.DoubleSide });
    const maskMat = new THREE.MeshStandardMaterial({ color: 0x7fe0ff, emissive: 0x1a6070, roughness: 0.1, metalness: 0.3 });
    const compMat = new THREE.MeshStandardMaterial({ color: 0xff6a3d, emissive: 0x552010 });
    const hoseMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.65, 4, 12), suit);
    torso.rotation.x = Math.PI / 2;
    const vest = new THREE.Mesh(new THREE.CapsuleGeometry(0.225, 0.4, 4, 12), bcd);
    vest.rotation.x = Math.PI / 2;
    vest.position.z = 0.12;
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.65, 16), tankMat);
    tank.rotation.x = Math.PI / 2;
    tank.position.set(0, 0.28, -0.05);
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8), steel);
    valve.rotation.x = Math.PI / 2;
    valve.position.set(0, 0.28, 0.32);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), suit);
    head.position.set(0, 0.06, 0.58);
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.06), maskMat);
    mask.position.set(0, 0.08, 0.7);
    const reg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10), steel);
    reg.rotation.x = Math.PI / 2;
    reg.position.set(0, -0.03, 0.72);
    const hose = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([new THREE.Vector3(0.03, 0.3, 0.34), new THREE.Vector3(0.16, 0.2, 0.55), new THREE.Vector3(0.05, -0.03, 0.7)]),
        12,
        0.015,
        5,
      ),
      hoseMat,
    );
    body.add(torso, vest, tank, valve, head, mask, reg, hose);

    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.5, 4, 8), suit);
      leg.rotation.x = Math.PI / 2;
      leg.position.set(side * 0.1, -0.02, -0.72);
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, -0.02, -1.0);
      const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.45), finMat);
      fin.rotation.x = -Math.PI / 2;
      fin.position.z = -0.2;
      hip.add(fin);
      fins.push(hip);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.45, 4, 8), suit);
      arm.rotation.set(Math.PI / 2.4, 0, side * 0.25);
      arm.position.set(side * 0.2, -0.12, 0.35);
      body.add(leg, hip, arm);
    }
    const comp = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.07), compMat);
    comp.position.set(-0.24, -0.2, 0.52);
    body.add(comp);

    // Dive torch: only noticeable once the surface light fades.
    torch.position.set(0, 0.1, 0.7);
    torch.target.position.set(0, -1.5, 8);
    pitch.add(torch, torch.target);

    diver.add(pitch);
    return body;
  }

/**
 * Arms of the textured diver: hands crossed in front, under the chin, each gripping the other forearm,
 * as divers hold them in trim. Model space (x across, y towards the back, z forwards), for the left
 * arm, x mirrored for the right one. Directions of the upper arms (the right one lower, so that its
 * forearm lies under the left one), of the forearms, and of the hand, which goes round the other
 * forearm (y and z mirrored too: the left hand reaches down and back over the right forearm, the
 * right hand up and forwards behind the left one); `palmTo`: where the palm faces (mirrored the same
 * way). Bend of each finger joint towards the palm (rad); `palm`: which side the palm is on (±1).
 */
export const ARM_POSE = {
  upperArm: [0.1, -0.45, 0.75],
  upperArmR: [0.1, -0.85, 0.55],
  forearm: [-1, 0, 0.15],
  hand: [-0.2, -1, -0.7],
  palmTo: [0, 0, -1],
  curl: { index: 1.5, middle: 1.55, ring: 1.6, pinky: 1.65, thumb: 0.8 } as Record<string, number>,
  palm: -1,
};
/** Clip duration of the model's kick cycle (s). */
export const KICK_CYCLE = 1.958;

/**
 * Textured diver: "Diver" by ucdavisterc, CC BY 4.0 (sketchfab.com/3d-models/diver-9a415258dec4449c9faf28f11a5b6831),
 * in public/models/diver.glb. Swims with the legs only: the clip's tracks on the arms, hands and neck
 * are dropped, the arms stay still. Resolves to null if the file is missing (procedural diver kept).
 */
export async function loadDiverModel(): Promise<{ model: THREE.Object3D; action: THREE.AnimationAction; mixer: THREE.AnimationMixer } | null> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/diver.glb`);
  } catch {
    return null;
  }
  // Its materials are in KHR_materials_pbrSpecularGlossiness, which three.js no longer reads: apply
  // the diffuse texture and colour, and the glossiness as roughness.
  const parser = gltf.parser;
  const pending: Promise<void>[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (o.name.startsWith('pPlane1')) o.visible = false; // stray plane of the original scene
    mesh.frustumCulled = false; // skinned: the bind-pose bounds do not follow the kicks
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const idx = parser.associations.get(mat)?.materials;
    const sg = idx === undefined ? undefined : parser.json.materials[idx].extensions?.KHR_materials_pbrSpecularGlossiness;
    if (!sg) return;
    const [r, g, b, a] = sg.diffuseFactor ?? [1, 1, 1, 1];
    mat.color.setRGB(r, g, b, THREE.SRGBColorSpace);
    mat.opacity = a;
    mat.metalness = 0;
    mat.roughness = 1 - (sg.glossinessFactor ?? 1) * 0.6;
    if (sg.diffuseTexture) {
      pending.push(
        parser.getDependency('texture', sg.diffuseTexture.index).then((tex: THREE.Texture) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          mat.map = tex;
          mat.needsUpdate = true;
        }),
      );
    }
  });
  await Promise.all(pending);

  const legs = /^(Root|l_leg|r_leg|l_knee|r_knee|l_ankle|r_ankle|l_ball|r_ball|l_toe|r_toe|l_fin|r_fin)/;
  const clip = gltf.animations[0];
  clip.tracks = clip.tracks.filter((t) => legs.test(t.name));
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.update(0);
  poseArms(gltf.scene);
  return { model: gltf.scene, action, mixer };
}

/**
 * Poses the arms and hands (ARM_POSE), from the model's own pose, kept on the first call. Worked out
 * in each parent's frame: the right arm's joints are mirrored (negative scale), which world
 * quaternions do not represent.
 */
export function poseArms(root: THREE.Object3D, pose = ARM_POSE): void {
  const arm = /^[lr]_(shoulder|elbow|wrist|thumb|index|middle|ring|pinky)\d*_\d/;
  root.traverse((o) => {
    if (!arm.test(o.name)) return;
    o.userData.rest ??= o.quaternion.clone();
    o.quaternion.copy(o.userData.rest);
  });
  const at = (o: THREE.Object3D) => {
    root.updateMatrixWorld(true);
    return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  };
  /** Turns `bone` so that the direction `from` (model space) becomes `to`. */
  const turn = (bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) => {
    const toParent = bone.parent!.matrixWorld.clone().invert();
    const a = from.clone().transformDirection(toParent);
    const b = to.clone().transformDirection(toParent);
    bone.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(a, b));
  };
  const aim = (bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) => turn(bone, at(child).sub(at(bone)), dir);
  for (const [side, x] of [['l', 1], ['r', -1]] as const) {
    const bone = (n: string) => {
      let found: THREE.Object3D | undefined;
      root.traverse((o) => (found ??= new RegExp(`^${side}_${n}_\\d`).test(o.name) ? o : undefined));
      return found;
    };
    const [shoulder, elbow, wrist] = [bone('shoulder'), bone('elbow'), bone('wrist')];
    const [index, middle, pinky] = [bone('index1'), bone('middle'), bone('pinky1')]; // knuckles, and the middle finger's base
    if (!shoulder?.parent || !elbow || !wrist || !index || !middle || !pinky) continue;
    const [u, f, h] = [x > 0 ? pose.upperArm : pose.upperArmR, pose.forearm, pose.hand];
    aim(shoulder, elbow, new THREE.Vector3(u[0] * x, u[1], u[2]));
    aim(elbow, wrist, new THREE.Vector3(f[0] * x, f[1], f[2]));
    // The hand bent onto the other forearm, palm turned onto it, fingers wrapped round it.
    const palmOf = () => {
      const w = at(wrist);
      return at(index).sub(w).cross(at(pinky).sub(w)).normalize().multiplyScalar(x * pose.palm);
    };
    aim(wrist, middle, new THREE.Vector3(h[0] * x, h[1] * x, h[2] * x));
    const axis = at(middle).sub(at(wrist)).normalize();
    turn(wrist, palmOf().projectOnPlane(axis).normalize(), new THREE.Vector3(pose.palmTo[0] * x, pose.palmTo[1] * x, pose.palmTo[2] * x).projectOnPlane(axis).normalize());
    const palm = palmOf();
    for (const [finger, curl] of Object.entries(pose.curl)) {
      for (const j of [1, 2]) {
        const b = bone(`${finger}${j}`);
        const c = bone(`${finger}${j + 1}`);
        if (!b || !c) continue;
        const seg = at(c).sub(at(b)).normalize();
        aim(b, c, seg.clone().applyAxisAngle(seg.clone().cross(palm).normalize(), curl));
      }
    }
  }
}

/** Water all around, the surface seen from below, sun rays, marine snow and the exhaled bubbles. */
export function buildAmbience() {
  const rays: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[] = [];
    // Water all around: brighter towards the surface, darker towards the depths. Its horizon is the
    // fog colour, so distant scenery melts into it.
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(300, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uHorizon;
          uniform vec3 uBottom;
          varying vec3 vDir;
          void main() {
            float h = normalize(vDir).y;
            vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.7)) : mix(uHorizon, uBottom, pow(-h, 0.6));
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    );
    dome.renderOrder = -1;
    dome.frustumCulled = false;

    // Surface seen from below: only inside Snell's window (a cone of ~48.6° above the eye), fading
    // out at its rim; beyond it the surface reflects the depths and melts into the water colour.
    const surf = new THREE.PlaneGeometry(2, 2, 48, 48);
    surf.rotateX(-Math.PI / 2);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g2 = cv.getContext('2d')!;
    const grad = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.75, '#fff');
    grad.addColorStop(1, '#000');
    g2.fillStyle = grad;
    g2.fillRect(0, 0, 128, 128);
    const surface = new THREE.Mesh(
      surf,
      new THREE.MeshBasicMaterial({
        color: 0xc6f1ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, fog: false,
        alphaMap: new THREE.CanvasTexture(cv),
      }),
    );

    // Sun rays.
    for (let i = 0; i < 7; i++) {
      const geo = new THREE.CylinderGeometry(0.4, 2.6, 34, 12, 1, true);
      geo.translate(0, -17, 0);
      const ray = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: 0xe8fbff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      ray.userData = { dx: (i - 3) * 5 + Math.sin(i * 12.9) * 2, dz: Math.cos(i * 7.3) * 9, phase: i * 1.7 };
      rays.push(ray);
    }

    // Marine snow around the camera.
    const n = 1400;
    const snowBase = new Float32Array(n * 3);
    const rnd = mulberry32(7);
    for (let i = 0; i < n * 3; i++) snowBase[i] = rnd() * 30;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe8f4f0, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false }));
    snow.frustumCulled = false;

    // Exhaled bubbles.
    const bubbles = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.6, emissive: 0x335566 }),
      120,
    );
    bubbles.count = 0;
    bubbles.frustumCulled = false;
  return { dome, surface, rays, snowBase, snow, bubbles };
}

/**
 * Sea surface seen from above (diver at the surface): a finely meshed square of water around the
 * camera whose vertices and colours follow the swell each frame (Scene3D.updateOcean: darker troughs,
 * lighter crests, a little foam), and a flat sea beyond it up to the horizon. Nearly opaque: the
 * shallow scenery only shows faintly under it.
 */
export function buildOcean(): { near: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhongMaterial>; far: THREE.Mesh<THREE.RingGeometry, THREE.MeshPhongMaterial> } {
  const geo = new THREE.PlaneGeometry(1, 1, 120, 120);
  geo.rotateX(-Math.PI / 2);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
  const near = new THREE.Mesh(
    geo,
    new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x5f8fa8, shininess: 120, flatShading: true, transparent: true, opacity: 0.95 }),
  );
  // Flat sea from the edge of the near square to the horizon (fog blends it into the sky).
  const ring = new THREE.RingGeometry(34, 1500, 64, 1);
  ring.rotateX(-Math.PI / 2);
  const far = new THREE.Mesh(ring, new THREE.MeshPhongMaterial({ color: 0x0b4462, specular: 0x4f7f98, shininess: 60, transparent: true, opacity: 0.97 }));
  for (const m of [near, far]) {
    m.frustumCulled = false;
    m.visible = false;
  }
  return { near, far };
}

  /** Small dive boat (about 7 m), bow along +z; seen from below: red antifouling, keel, outboard. */
/** Boarding ladder of the boat (boat frame: bow towards +z, deck at y = BOAT_DECK). */
export const BOAT_LADDER = { x: 0.75, z: -3.45 };
export const BOAT_DECK = 0.55;
/** How far the lower part of the ladder is raised when stowed. */
export const LADDER_STOW = 1.35;

export function buildBoat(boat: THREE.Group): void {
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: 0x8e2a22, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.5, metalness: 0.3 });
    // Hull side profile (z along the boat, y up), extruded across its width.
    const profile = new THREE.Shape();
    profile.moveTo(-3.4, -0.55);
    profile.lineTo(2.1, -0.55);
    profile.quadraticCurveTo(3.3, -0.4, 3.7, 0.55);
    profile.lineTo(-3.4, 0.55);
    profile.closePath();
    const hullGeo = (depth: number) => {
      const g = new THREE.ExtrudeGeometry(profile, { depth, bevelEnabled: false });
      g.translate(0, 0, -depth / 2);
      g.rotateY(-Math.PI / 2); // profile x → boat z
      return g;
    };
    const hull = new THREE.Mesh(hullGeo(2.4), white);
    // Antifouling: a slightly wider copy clipped to the part under the waterline.
    const bottom = new THREE.Mesh(hullGeo(2.44), red);
    bottom.scale.set(1.01, 1, 1.01);
    red.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)];
    const keel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 5), red);
    keel.position.set(0, -0.66, 0.1);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 2), white);
    cabin.position.set(0, 1.1, 0.4);
    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.3, 0.35), dark);
    motor.position.set(0, -0.1, -3.6);
    const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12), dark);
    prop.rotation.x = Math.PI / 2;
    prop.position.set(0, -0.65, -3.8);
    // Boarding ladder on the transom, beside the motor: a fixed upper part with handrails, and a lower
    // part that slides down into the water for the diver (boat.userData.ladderLow, moved by Scene3D).
    const steel = new THREE.MeshStandardMaterial({ color: 0xc9d0d6, roughness: 0.35, metalness: 0.7 });
    const ladder = new THREE.Group();
    ladder.position.set(BOAT_LADDER.x, 0, BOAT_LADDER.z);
    const rails = (group: THREE.Group, y0: number, y1: number) => {
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, y1 - y0, 6), steel);
        rail.position.set(side * 0.22, (y0 + y1) / 2, 0);
        group.add(rail);
      }
    };
    const rungs = (group: THREE.Group, ys: number[]) => {
      for (const y of ys) {
        const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.44, 6), steel);
        rung.rotation.z = Math.PI / 2;
        rung.position.set(0, y, 0);
        group.add(rung);
      }
    };
    const upper = new THREE.Group();
    rails(upper, -0.2, 1.15);
    rungs(upper, [0.0, 0.3]);
    const low = new THREE.Group();
    rails(low, -1.55, -0.1);
    rungs(low, [-1.5, -1.2, -0.9, -0.6, -0.3]);
    low.position.z = -0.06;
    ladder.add(upper, low);
    boat.userData.ladderLow = low;
    boat.add(hull, bottom, keel, cabin, motor, prop, ladder);
    boat.visible = false;
  }

/** Target depth ring, ceiling disc and safety stop band around the diver. */
export function buildOverlays() {
    const ring = new THREE.TorusGeometry(1.3, 0.025, 6, 48);
    ring.rotateX(Math.PI / 2);
    const targetRing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffe678, transparent: true, opacity: 0.8, fog: false, toneMapped: false }));

    const disc = new THREE.CircleGeometry(9, 48);
    disc.rotateX(-Math.PI / 2);
    const ceilingDisc = new THREE.Mesh(
      disc,
      new THREE.MeshBasicMaterial({ color: 0xff4a3c, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    );

    const tube = new THREE.CylinderGeometry(7, 7, 3, 48, 1, true);
    const safetyTube = new THREE.Mesh(
      tube,
      new THREE.MeshBasicMaterial({ color: 0x50dc8c, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    );
    return { targetRing, ceilingDisc, safetyTube };
}
