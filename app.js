const canvas = document.getElementById("bg");
const minimap = document.getElementById("minimap");
const enterBtn = document.getElementById("enter");
const hintText = document.querySelector(".hint");
const infoPanel = document.getElementById("info-panel");
const closeInfoBtn = document.getElementById("close-info");
const infoTitle = document.getElementById("item-title");
const infoText = document.getElementById("item-text");

// PointerLockControls embutido (compat com file://)
(function embedPointerLock(THREE) {
  if (THREE.PointerLockControls) return;
  const _euler = new THREE.Euler(0, 0, 0, "YXZ");
  const _vec = new THREE.Vector3();
  const PI_2 = Math.PI / 2;
  const _changeEvent = { type: "change" };
  const _lockEvent = { type: "lock" };
  const _unlockEvent = { type: "unlock" };
  function PointerLockControls(camera, domElement) {
    this.domElement = domElement || document.body;
    this.isLocked = false;
    const scope = this;
    function onMouseMove(event) {
      if (!scope.isLocked) return;
      const movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
      const movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;
      _euler.setFromQuaternion(camera.quaternion);
      _euler.y -= movementX * 0.002;
      _euler.x -= movementY * 0.002;
      _euler.x = Math.max(-PI_2, Math.min(PI_2, _euler.x));
      camera.quaternion.setFromEuler(_euler);
      scope.dispatchEvent(_changeEvent);
    }
    function onPointerlockChange() {
      if (document.pointerLockElement === scope.domElement) {
        scope.dispatchEvent(_lockEvent);
        scope.isLocked = true;
      } else {
        scope.dispatchEvent(_unlockEvent);
        scope.isLocked = false;
      }
    }
    function onPointerlockError() { scope.dispatchEvent({ type: "error" }); }
    this.connect = function () {
      document.addEventListener("mousemove", onMouseMove, false);
      document.addEventListener("pointerlockchange", onPointerlockChange, false);
      document.addEventListener("pointerlockerror", onPointerlockError, false);
    };
    this.disconnect = function () {
      document.removeEventListener("mousemove", onMouseMove, false);
      document.removeEventListener("pointerlockchange", onPointerlockChange, false);
      document.removeEventListener("pointerlockerror", onPointerlockError, false);
    };
    this.dispose = function () { this.disconnect(); };
    this.getObject = function () { return camera; };
    this.getDirection = function (v) { return v.set(0, 0, -1).applyQuaternion(camera.quaternion); };
    this.moveForward = function (d) { _vec.setFromMatrixColumn(camera.matrix, 0); _vec.crossVectors(camera.up, _vec); camera.position.addScaledVector(_vec, d); };
    this.moveRight = function (d) { _vec.setFromMatrixColumn(camera.matrix, 0); camera.position.addScaledVector(_vec, d); };
    this.lock = function () { if (this.domElement.requestPointerLock) this.domElement.requestPointerLock(); };
    this.unlock = function () { if (document.exitPointerLock) document.exitPointerLock(); };
    this.connect();
  }
  PointerLockControls.prototype = Object.create(THREE.EventDispatcher.prototype);
  PointerLockControls.prototype.constructor = PointerLockControls;
  THREE.PointerLockControls = PointerLockControls;
})(window.THREE);

if (!window.THREE) {
  if (hintText) hintText.textContent = "Falha ao carregar Three.js";
  throw new Error("Three.js ausente");
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1018);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 250);
camera.position.set(0, 1.7, 9);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace;

const controls = new THREE.PointerLockControls(camera, renderer.domElement);

// Loaders
const textureLoader = new THREE.TextureLoader();
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

function loadTexture(url, repeat = 1, wrap = true) {
  const tex = textureLoader.load(url, undefined, undefined, () => console.warn("Falha textura", url));
  if (tex.colorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (wrap) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
  }
  return tex;
}

function loadTextureFallback(urls, repeat = 1) {
  const tex = new THREE.Texture();
  let idx = 0;
  const tryLoad = () => {
    if (idx >= urls.length) { console.warn("Falha todas texturas", urls); return; }
    const url = urls[idx];
    textureLoader.load(url, (t) => {
      tex.image = t.image;
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat, repeat);
      tex.anisotropy = 8;
      if (t.colorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
    }, undefined, () => { idx += 1; tryLoad(); });
  };
  tryLoad();
  return tex;
}

function makePBR(opts) {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color || 0xffffff,
    metalness: opts.metalness ?? 0,
    roughness: opts.roughness ?? 0.8,
    envMap: scene.environment,
    envMapIntensity: opts.envMapIntensity ?? 0.5
  });
  if (opts.map) mat.map = opts.map;
  if (opts.normalMap) mat.normalMap = opts.normalMap;
  if (opts.roughnessMap) mat.roughnessMap = opts.roughnessMap;
  if (opts.aoMap) mat.aoMap = opts.aoMap;
  return mat;
}

// Environment HDRI + fallback cube
const hdrUrl = "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr";
function setEnvFromHDR() {
  if (!THREE.RGBELoader) return loadFallbackCube();
  new THREE.RGBELoader().load(hdrUrl, (hdrTex) => {
    const env = pmremGenerator.fromEquirectangular(hdrTex).texture;
    scene.environment = env;
    hdrTex.dispose();
    pmremGenerator.dispose();
  }, undefined, () => {
    console.warn("Falha HDRI, usando cube");
    loadFallbackCube();
  });
}
function loadFallbackCube() {
  const cubeLoader = new THREE.CubeTextureLoader();
  const envMap = cubeLoader.setPath("https://threejs.org/examples/textures/cube/Bridge2/").load(
    ["posx.jpg", "negx.jpg", "posy.jpg", "negy.jpg", "posz.jpg", "negz.jpg"],
    () => {},
    undefined,
    () => console.warn("Falha cube map")
  );
  if (envMap && envMap.colorSpace !== undefined) envMap.colorSpace = THREE.SRGBColorSpace;
  scene.environment = envMap;
}
setEnvFromHDR();

// Luzes
const hemi = new THREE.HemisphereLight(0xffffff, 0x1c2433, 0.65);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1.05);
sun.position.set(12, 18, -8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.00015;
scene.add(sun);

const fill = new THREE.DirectionalLight(0xf5eddc, 0.45);
fill.position.set(-8, 12, 10);
scene.add(fill);

function makePendant(x, y, z) {
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 12), makePBR({ color: 0x1c1d20, roughness: 0.4, metalness: 0.6, envMapIntensity: 1.2 }));
  body.position.set(x, y - 0.2, z);
  const bulb = new THREE.PointLight(0xffe2b8, 1.0, 8, 2);
  bulb.position.set(x, y - 0.45, z);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.3, 16, 1, true), makePBR({ color: 0x2a2b2f, roughness: 0.6, metalness: 0.4, envMapIntensity: 1.4 }));
  shade.position.set(x, y - 0.3, z);
  shade.rotation.x = Math.PI;
  const g = new THREE.Group();
  g.add(body, shade, bulb);
  scene.add(g);
}
[-4, 0, 4].forEach((z) => makePendant(-2, 5.2, z));
[-4, 0, 4].forEach((z) => makePendant(2.5, 5.2, z));

// Trilho de spots
function addTrack(x, z, len = 6, count = 4) {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), makePBR({ color: 0x1c1d20, roughness: 0.6, metalness: 0.8, envMapIntensity: 1.0 }));
  bar.position.set(x, 5.4, z);
  bar.castShadow = true;
  scene.add(bar);
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) - 0.5;
    const spot = new THREE.SpotLight(0xffe9cc, 0.5, 10, Math.PI / 5, 0.35);
    spot.position.set(x + t * len, 5.35, z);
    spot.target.position.set(x + t * len, 1.2, z - 1.2 + i * 0.6);
    spot.castShadow = true;
    scene.add(spot);
    scene.add(spot.target);
  }
}
addTrack(0, -1, 10, 5);
addTrack(0, 2.5, 10, 5);

// Arquitetura
function buildArchitecture() {
  // Piso cimento polido
  const floorMat = makePBR({
    color: 0xdadada,
    roughness: 0.32,
    metalness: 0.08,
    envMapIntensity: 0.7,
    map: loadTextureFallback([
      "https://dl.polyhaven.org/file/ph-assets/Textures/2k/concrete_pitted/concrete_pitted_diff_2k.jpg",
      "https://threejs.org/examples/textures/hardwood2_diffuse.jpg"
    ], 3),
    roughnessMap: loadTextureFallback([
      "https://dl.polyhaven.org/file/ph-assets/Textures/2k/concrete_pitted/concrete_pitted_rough_2k.jpg"
    ], 3)
  });
  const floorGeo = new THREE.PlaneGeometry(28, 20);
  floorGeo.setAttribute("uv2", new THREE.BufferAttribute(floorGeo.attributes.uv.array, 2));
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Paredes neutras
  const wallMat = makePBR({
    color: 0xf6f2ea,
    roughness: 0.9,
    metalness: 0.02,
    envMapIntensity: 0.25,
    map: loadTextureFallback([
      "https://dl.polyhaven.org/file/ph-assets/Textures/2k/plaster_brushed/plaster_brushed_diff_2k.jpg",
      "https://threejs.org/examples/textures/brick_diffuse.jpg"
    ], 2)
  });
  const wallGeo = new THREE.PlaneGeometry(28, 7.5);
  wallGeo.setAttribute("uv2", new THREE.BufferAttribute(wallGeo.attributes.uv.array, 2));
  const back = new THREE.Mesh(wallGeo, wallMat);
  back.position.set(0, 3.75, -10);
  back.receiveShadow = true;
  scene.add(back);
  const front = back.clone();
  front.position.set(0, 3.75, 10);
  front.rotation.y = Math.PI;
  scene.add(front);

  const sideGeo = new THREE.PlaneGeometry(20, 7.5);
  sideGeo.setAttribute("uv2", new THREE.BufferAttribute(sideGeo.attributes.uv.array, 2));
  const left = new THREE.Mesh(sideGeo, wallMat);
  left.position.set(-14, 3.75, 0);
  left.rotation.y = Math.PI / 2;
  left.receiveShadow = true;
  scene.add(left);
  const right = left.clone();
  right.position.set(14, 3.75, 0);
  right.rotation.y = -Math.PI / 2;
  scene.add(right);

  // Parede de tijolo quente
  const brickMat = makePBR({
    color: 0xd6b19a,
    roughness: 0.7,
    metalness: 0.05,
    envMapIntensity: 0.35,
    map: loadTextureFallback([
      "https://dl.polyhaven.org/file/ph-assets/Textures/2k/brick_clay_old/brick_clay_old_diff_2k.jpg",
      "https://threejs.org/examples/textures/brick_diffuse.jpg"
    ], 2)
  });
  const brickWall = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), brickMat);
  brickWall.position.set(0, 2.5, -9.99);
  brickWall.castShadow = true;
  scene.add(brickWall);

  // Vigas
  const beamMat = makePBR({ color: 0x4f545c, roughness: 0.5, metalness: 0.1, envMapIntensity: 0.6 });
  const beamGeo = new THREE.BoxGeometry(28, 0.18, 0.6);
  [ -2, 2 ].forEach((z) => {
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, 6.0, z);
    beam.castShadow = true;
    beam.receiveShadow = true;
    scene.add(beam);
  });

  // Ripas madeira clara
  const woodMat = makePBR({
    color: 0xd9c9b4,
    roughness: 0.6,
    metalness: 0.05,
    envMapIntensity: 0.5,
    map: loadTextureFallback([
      "https://dl.polyhaven.org/file/ph-assets/Textures/2k/wood_larch_clapboard/wood_larch_clapboard_diff_2k.jpg",
      "https://threejs.org/examples/textures/hardwood2_diffuse.jpg"
    ], 1.5)
  });
  for (let i = -13; i <= 13; i += 1.5) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.22), woodMat);
    slat.position.set(i, 1.2, -9.8);
    slat.castShadow = true;
    scene.add(slat);
  }

  // Janelas panoramicas
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0,
    transmission: 0.82,
    transparent: true,
    opacity: 0.4,
    envMap: scene.environment,
    envMapIntensity: 1.2,
    thickness: 0.05
  });
  const winGeo = new THREE.PlaneGeometry(6, 4.8);
  for (let i = -1; i <= 1; i++) {
    const wLeft = new THREE.Mesh(winGeo, glassMat);
    wLeft.position.set(-13.0, 3.3, i * 4);
    wLeft.rotation.y = Math.PI / 2;
    scene.add(wLeft);
    const wRight = wLeft.clone();
    wRight.position.set(13.0, 3.3, i * 4);
    wRight.rotation.y = -Math.PI / 2;
    scene.add(wRight);
  }
}

buildArchitecture();

// Plantas
function addPlant(x, z, scale = 1) {
  const potMat = makePBR({ color: 0x3a3c42, roughness: 0.5, metalness: 0.2, envMapIntensity: 0.6 });
  const leafMat = makePBR({ color: 0x3f7d4e, roughness: 0.65, metalness: 0.05, envMapIntensity: 0.4 });
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * scale, 0.45 * scale, 0.5 * scale, 16), potMat);
  pot.position.set(x, 0.25 * scale, z);
  pot.castShadow = true; pot.receiveShadow = true;
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.8 * scale, 1.6 * scale, 10), leafMat);
  leaf.position.set(x, 1.3 * scale, z);
  leaf.castShadow = true;
  scene.add(pot, leaf);
}
[-7, 0, 7].forEach((x) => addPlant(x, -7));
[-10, 10].forEach((x) => addPlant(x, 7, 1.2));

// Plataformas
const platforms = [];
function addPlatform(x, z, w, d, h = 0.25) {
  const mat = makePBR({ color: 0xd7c3a0, roughness: 0.45, metalness: 0.08, envMapIntensity: 0.6 });
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  platforms.push(mesh);
  return mesh;
}
addPlatform(-6, -2.5, 5, 2.5);
addPlatform(6, 0, 5, 2.5);
addPlatform(0, 4, 6.5, 2.2, 0.32);

// Rugs
function addRug(x, z, w, d, color = 0xcfd4d8) {
  const mat = makePBR({ color, roughness: 0.95, metalness: 0.02, envMapIntensity: 0.25, map: loadTexture("https://threejs.org/examples/textures/uv_grid_opengl.jpg", 1) });
  const geo = new THREE.PlaneGeometry(w, d);
  geo.setAttribute("uv2", new THREE.BufferAttribute(geo.attributes.uv.array, 2));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.015, z);
  mesh.receiveShadow = true;
  scene.add(mesh);
}
addRug(-6, -2.5, 5, 3, 0xd8dad6);
addRug(6, 0, 5, 3, 0xc7cec5);

// Hotspots / itens
const pickable = [];
const hotspots = [];

function addHotspot(obj, item) {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  marker.position.copy(center);
  marker.position.y += size.y * 0.6;
  marker.userData = item;
  scene.add(marker);
  hotspots.push(marker);
}

function lounge(item, color = 0xcfc9c1) {
  const mat = makePBR({ color, roughness: 0.55, metalness: 0.08, envMapIntensity: 0.6 });
  const group = new THREE.Group();
  const modules = [
    { pos: [0, 0.35, 0], size: [1.2, 0.7, 0.9] },
    { pos: [1.2, 0.35, 0], size: [1.2, 0.7, 0.9] },
    { pos: [0.6, 0.35, -0.9], size: [2.4, 0.7, 0.9] }
  ];
  modules.forEach((m) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...m.size), mat);
    mesh.position.set(...m.pos);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  });
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.18), mat);
  back.position.set(0.6, 0.8, -0.9);
  back.castShadow = true;
  group.add(back);
  group.position.set(...item.position);
  group.userData = item;
  scene.add(group);
  pickable.push(group);
  addHotspot(group, item);
}

function coffeeTable(item) {
  const topMat = makePBR({ color: 0xe2d4c0, roughness: 0.4, metalness: 0.1, envMapIntensity: 0.7 });
  const legMat = makePBR({ color: 0x1f2023, roughness: 0.5, metalness: 0.9, envMapIntensity: 1.1 });
  const group = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.8), topMat);
  top.position.y = 0.4;
  top.castShadow = true; top.receiveShadow = true;
  group.add(top);
  const legGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.4, 10);
  const legPos = [ [-0.6, 0.2, -0.3], [0.6, 0.2, -0.3], [-0.6, 0.2, 0.3], [0.6, 0.2, 0.3] ];
  legPos.forEach((p) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(...p);
    leg.castShadow = true; leg.receiveShadow = true;
    group.add(leg);
  });
  group.position.set(...item.position);
  group.userData = item;
  scene.add(group);
  pickable.push(group);
  addHotspot(group, item);
}

function diningSet(item) {
  const topMat = makePBR({ color: 0xe2d4c0, roughness: 0.4, metalness: 0.1, envMapIntensity: 0.7 });
  const legMat = makePBR({ color: 0x1f2023, roughness: 0.5, metalness: 0.9, envMapIntensity: 1.2 });
  const group = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 1), topMat);
  top.position.y = 0.78;
  top.castShadow = true; top.receiveShadow = true;
  group.add(top);
  const legGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.8, 10);
  const legPos = [ [-1, 0.4, -0.4], [1, 0.4, -0.4], [-1, 0.4, 0.4], [1, 0.4, 0.4] ];
  legPos.forEach((p) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(...p);
    leg.castShadow = true; leg.receiveShadow = true;
    group.add(leg);
  });
  const seatMat = makePBR({ color: 0xf4eee5, roughness: 0.6, metalness: 0.05, envMapIntensity: 0.5 });
  const frameMat = makePBR({ color: 0x1f2023, roughness: 0.5, metalness: 0.8, envMapIntensity: 1.0 });
  for (let i = 0; i < 4; i++) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.45), seatMat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 0.05), seatMat);
    back.position.set(0, 0.23, -0.2);
    const chair = new THREE.Group();
    seat.position.y = 0.35;
    chair.add(seat);
    back.position.y = 0.55;
    chair.add(back);
    const legs = new THREE.CylinderGeometry(0.02, 0.02, 0.35, 10);
    const lp = [ [-0.18, 0.175, -0.18], [0.18, 0.175, -0.18], [-0.18, 0.175, 0.18], [0.18, 0.175, 0.18] ];
    lp.forEach((p) => {
      const leg = new THREE.Mesh(legs, frameMat);
      leg.position.set(...p);
      leg.castShadow = true; leg.receiveShadow = true;
      chair.add(leg);
    });
    const angle = (i % 2 === 0) ? Math.PI : 0;
    chair.rotation.y = angle + (i < 2 ? -0.1 : 0.1);
    chair.position.set(i < 2 ? -0.9 : 0.9, 0, i % 2 === 0 ? -0.7 : 0.7);
    chair.castShadow = true;
    group.add(chair);
  }
  group.position.set(...item.position);
  group.userData = item;
  scene.add(group);
  pickable.push(group);
  addHotspot(group, item);
}

function barCounter(item) {
  const counterMat = makePBR({ color: 0xf1e6d8, roughness: 0.35, metalness: 0.1, envMapIntensity: 0.8 });
  const baseMat = makePBR({ color: 0x1f2023, roughness: 0.5, metalness: 0.8, envMapIntensity: 1.1 });
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1, 0.8), counterMat);
  body.position.y = 0.5;
  body.castShadow = true; body.receiveShadow = true;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.12, 0.82), baseMat);
  plinth.position.y = 0.06;
  plinth.receiveShadow = true;
  group.add(body, plinth);

  const stoolSeat = makePBR({ color: 0xd3cbc1, roughness: 0.55, metalness: 0.1, envMapIntensity: 0.7 });
  const stoolFrame = makePBR({ color: 0x1f2023, roughness: 0.4, metalness: 0.9, envMapIntensity: 1.0 });
  const stool = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.08, 14), stoolSeat);
  seat.position.y = 0.7;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.7, 12), stoolFrame);
  leg.position.y = 0.35;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.05, 14), stoolFrame);
  base.position.y = 0.025;
  stool.add(seat, leg, base);
  stool.castShadow = true; stool.receiveShadow = true;
  [-1, 0, 1].forEach((i) => {
    const s = stool.clone();
    s.position.set(i * 1.2, 0, 0.9);
    group.add(s);
  });

  group.position.set(...item.position);
  group.userData = item;
  scene.add(group);
  pickable.push(group);
  addHotspot(group, item);
}

function displayPiece(item) {
  const mat = makePBR({ color: item.color, roughness: 0.3, metalness: 0.25, envMapIntensity: 1.0 });
  const geo = new THREE.CapsuleGeometry(item.size[0], item.size[1], 8, 16);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...item.position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = item;
  scene.add(mesh);
  pickable.push(mesh);
  addHotspot(mesh, item);
}

const catalog = [
  { id: "lounge", name: "Lounge bege", info: "Sofa modular bege com chaise, estilo escandinavo premium.", position: [-6, 0, -2.5], color: 0xcfc9c1 },
  { id: "lounge2", name: "Lounge verde oliva", info: "Sofa modular verde oliva, modulos simetricos.", position: [6, 0, 0], color: 0x7b8a6a },
  { id: "coffee", name: "Mesa de centro carvalho", info: "Mesa baixa em carvalho claro com estrutura metalica preta.", position: [-6, 0, -2.5] },
  { id: "dining", name: "Jantar nordico", info: "Mesa carvalho claro com cadeiras em tecido bege e estrutura preta.", position: [5.5, 0, 0.5] },
  { id: "bar", name: "Bar minimalista", info: "Balcon liso marfim, base preta, banquetas metalicas.", position: [0, 0, 4] },
  { id: "sculpt", name: "Peca escultorica", info: "Objeto metalico em pedestal claro.", position: [-6, 0.5, -2.5], size: [0.28, 0.35], color: 0xbba78c },
  { id: "lamp", name: "Luminaria coluna", info: "Coluna metalica escura com difusor fosco.", position: [6.2, 1, 0.2], size: [0.18, 0.45], color: 0x2b2c30 }
];

function buildSceneItems() {
  catalog.forEach((item) => {
    if (item.id === "lounge") lounge(item, item.color);
    if (item.id === "lounge2") lounge(item, item.color);
    if (item.id === "coffee") coffeeTable(item);
    if (item.id === "dining") diningSet(item);
    if (item.id === "bar") barCounter(item);
    if (item.id === "sculpt" || item.id === "lamp") displayPiece(item);
  });
}
buildSceneItems();

// Post processing
let composer = null;
if (THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass) {
  composer = new THREE.EffectComposer(renderer);
  const renderPass = new THREE.RenderPass(scene, camera);
  const ssao = THREE.SSAOPass ? new THREE.SSAOPass(scene, camera, window.innerWidth, window.innerHeight) : null;
  if (ssao) {
    ssao.kernelRadius = 12;
    ssao.minDistance = 0.0006;
    ssao.maxDistance = 0.2;
    ssao.output = THREE.SSAOPass.OUTPUT.Default;
  }
  const bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.28, 0.5, 0.85);
  composer.addPass(renderPass);
  if (ssao) composer.addPass(ssao);
  composer.addPass(bloomPass);
}

// Controles e painel
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let sprint = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let prevTime = performance.now();
const baseSpeed = 6.0;
const sprintBoost = 1.7;

function onKeyDown(e) {
  switch (e.code) {
    case "ArrowUp": case "KeyW": moveForward = true; break;
    case "ArrowLeft": case "KeyA": moveLeft = true; break;
    case "ArrowDown": case "KeyS": moveBackward = true; break;
    case "ArrowRight": case "KeyD": moveRight = true; break;
    case "ShiftLeft": case "ShiftRight": sprint = true; break;
  }
}
function onKeyUp(e) {
  switch (e.code) {
    case "ArrowUp": case "KeyW": moveForward = false; break;
    case "ArrowLeft": case "KeyA": moveLeft = false; break;
    case "ArrowDown": case "KeyS": moveBackward = false; break;
    case "ArrowRight": case "KeyD": moveRight = false; break;
    case "ShiftLeft": case "ShiftRight": sprint = false; break;
  }
}
document.addEventListener("keydown", onKeyDown);
document.addEventListener("keyup", onKeyUp);

const lockControls = () => {
  if (!document.body.requestPointerLock) {
    if (hintText) hintText.textContent = "Navegador sem pointer lock. Use Chrome/Edge/Firefox desktop.";
    return;
  }
  controls.lock();
};
enterBtn.addEventListener("click", lockControls);
canvas.addEventListener("click", () => { if (!controls.isLocked) lockControls(); });

controls.addEventListener("lock", () => {
  enterBtn.style.display = "none";
  if (hintText) hintText.textContent = "WASD mover, Shift correr, mouse olhar, clique para detalhes.";
});
controls.addEventListener("unlock", () => {
  enterBtn.style.display = "block";
  if (hintText) hintText.textContent = "Clique para entrar - WASD mover - Shift correr - Mouse olhar - Clique detalhes";
});
closeInfoBtn.addEventListener("click", () => infoPanel.classList.add("hidden"));

document.addEventListener("pointerlockerror", () => {
  if (hintText) hintText.textContent = "Pointer lock bloqueado. Tente servidor http://";
});

// Raycast para hotspots
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(0, 0);
const inspect = () => {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects([...pickable, ...hotspots], true)[0];
  if (hit && hit.object.userData && hit.object.userData.name) {
    const { name, info } = hit.object.userData;
    infoTitle.textContent = name;
    infoText.textContent = info;
    infoPanel.classList.remove("hidden");
  }
};
window.addEventListener("mousedown", (e) => { if (controls.isLocked && e.button === 0) inspect(); });

// Minimap
const mapCtx = minimap.getContext("2d");
function drawMinimap() {
  const w = minimap.width, h = minimap.height;
  mapCtx.fillStyle = "#0b1220";
  mapCtx.fillRect(0, 0, w, h);
  mapCtx.strokeStyle = "#1f2937";
  mapCtx.strokeRect(0, 0, w, h);

  const range = { x: 28, z: 20 };
  const toMap = (x, z) => ({ x: ((x + range.x / 2) / range.x) * w, z: ((z + range.z / 2) / range.z) * h });

  mapCtx.fillStyle = "#f59e0b";
  catalog.forEach((item) => {
    const p = toMap(item.position[0], item.position[2]);
    mapCtx.beginPath();
    mapCtx.arc(p.x, p.z, 4, 0, Math.PI * 2);
    mapCtx.fill();
  });

  const cam = camera.position;
  const cp = toMap(cam.x, cam.z);
  mapCtx.fillStyle = "#38bdf8";
  mapCtx.beginPath();
  mapCtx.arc(cp.x, cp.z, 5, 0, Math.PI * 2);
  mapCtx.fill();
  const dir = new THREE.Vector3();
  controls.getDirection(dir);
  const end = toMap(cam.x + dir.x * 2, cam.z + dir.z * 2);
  mapCtx.strokeStyle = "#38bdf8";
  mapCtx.beginPath();
  mapCtx.moveTo(cp.x, cp.z);
  mapCtx.lineTo(end.x, end.z);
  mapCtx.stroke();
}

function animate() {
  requestAnimationFrame(animate);
  const time = performance.now();
  const delta = (time - prevTime) / 1000;
  prevTime = time;

  if (controls.isLocked) {
    velocity.x -= velocity.x * 8.0 * delta;
    velocity.z -= velocity.z * 8.0 * delta;

    direction.z = Number(moveForward) - Number(moveBackward);
    direction.x = Number(moveRight) - Number(moveLeft);
    direction.normalize();

    const speed = sprint ? baseSpeed * sprintBoost : baseSpeed;
    if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
    if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

    controls.moveRight(-velocity.x * delta);
    controls.moveForward(-velocity.z * delta);

    camera.position.y = THREE.MathUtils.clamp(camera.position.y, 1.0, 2.8);
  }

  drawMinimap();
  if (composer) composer.render(); else renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});