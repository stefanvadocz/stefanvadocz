/* Cesta lesom — 3D FPS v prehliadači (Three.js, bez externých assetov) */
(function(){
'use strict';

// ---------- Pomocné ----------
const rand = (a,b)=>a+Math.random()*(b-a);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const lerp = (a,b,t)=>a+(b-a)*t;
const smooth = t=>{ t=clamp(t,0,1); return t*t*(3-2*t); };
// Renderer pracuje v lineárnom priestore a na výstupe konvertuje do sRGB. Farby preto
// zadávame tak, ako ich vidíme (sRGB hex), a tu ich prevedieme do lineárneho priestoru.
const srgb = hex => new THREE.Color(hex).convertSRGBToLinear();

// ---------- Svet ----------
const HOUSE_Z = 400;            // pozícia bezpečného domu
const WORLD = { minX:-68, maxX:68, minZ:-22, maxZ:HOUSE_Z+4 };
const MAX_HITS = 3;             // viac ako 3 zásahy = koniec
// Cieľová zóna je celé okolie domu, nie len prah dverí — inak by hráč mohol prejsť
// tesne popri dome, naraziť na hranicu sveta a zaseknúť sa bez toho, aby vyhral.
const WIN_RADIUS = 10;
// Les sa ku koncu zužuje do lievika, ktorý hráča privedie k domu. Hranica koridoru
// leží presne na okraji stromov, takže pôsobí ako hustý porast, nie ako neviditeľná stena.
const CORRIDOR_FROM_Z = HOUSE_Z - 60, CORRIDOR_TO_Z = HOUSE_Z - 15;
const CORRIDOR_MIN_HALF = 15;
function corridorHalfWidth(z){
  if (z <= CORRIDOR_FROM_Z) return WORLD.maxX;
  const t = smooth((z - CORRIDOR_FROM_Z) / (CORRIDOR_TO_Z - CORRIDOR_FROM_Z));
  return lerp(WORLD.maxX, CORRIDOR_MIN_HALF, t);
}

function terrainH(x,z){
  let h = 1.4*Math.sin(x*0.043+1.3)*Math.cos(z*0.031)
        + 0.9*Math.sin(z*0.023+0.6)
        + 0.45*Math.sin((x*0.7+z)*0.061);
  const dHouse = Math.hypot(x, z-HOUSE_Z);
  if (dHouse < 30) h = lerp(0.4, h, smooth(dHouse/30));   // rovinka pod domom
  const dSpawn = Math.hypot(x, z-4);
  if (dSpawn < 12) h = lerp(0.2, h, smooth(dSpawn/12));   // rovinka na štarte
  return h;
}

// ---------- Renderer / scéna ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
// Hmla musí zavrieť výhľad skôr, než hráč dovidí na koniec kulisy.
scene.fog = new THREE.Fog(srgb(0xa8b89c), 16, 148);

const camera = new THREE.PerspectiveCamera(75, 1, 0.08, 900);
scene.add(camera);

function onResize(){
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// ---------- Svetlá ----------
const SUN_DIR = new THREE.Vector3(-0.42, 0.72, -0.55).normalize();
const sun = new THREE.DirectionalLight(0xffedc9, 1.45);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
// Tiene stačia v okolí hráča — ďalej scénu aj tak prekryje hmla.
sun.shadow.camera.left = -38; sun.shadow.camera.right = 38;
sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38;
sun.shadow.camera.near = 5; sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0007;
scene.add(sun); scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0x9db8d4, 0x3a4630, 0.42);
scene.add(hemi);

// ---------- Obloha ----------
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite:false, fog:false,
  uniforms: { sunDir: { value: SUN_DIR } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: [
    'varying vec3 vDir; uniform vec3 sunDir;',
    'void main(){',
    '  vec3 d = normalize(vDir);',
    '  float h = max(d.y, 0.0);',
    // Hodnoty sú priamo vo výstupnom (sRGB) priestore — ShaderMaterial neprechádza
    // tone-mappingom ani encodingom, preto horizont ladíme na farbu hmly.
    '  vec3 horizon = vec3(0.659, 0.722, 0.612);',
    '  vec3 zenith = vec3(0.29, 0.46, 0.68);',
    '  vec3 col = mix(horizon, zenith, pow(h, 0.55));',
    '  float s = max(dot(d, sunDir), 0.0);',
    '  col += vec3(1.0, 0.92, 0.75) * pow(s, 420.0) * 1.4;', // slnečný kotúč
    '  col += vec3(1.0, 0.85, 0.6) * pow(s, 7.0) * 0.14;',   // opar okolo slnka
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n')
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(850, 20, 12), skyMat);
scene.add(skyDome);

// ---------- Procedurálne textúry ----------
function makeCanvas(size, draw){
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.encoding = THREE.sRGBEncoding;   // canvas kreslí v sRGB, renderer očakáva lineárny vstup
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

const groundTex = makeCanvas(512, (g,s)=>{
  g.fillStyle = '#33402a'; g.fillRect(0,0,s,s);
  for (let i=0;i<9000;i++){
    const shades = ['#2b3820','#3d4a2c','#242f1c','#46523a','#3a3524','#2f4522','#453d28'];
    g.fillStyle = shades[(Math.random()*shades.length)|0];
    g.globalAlpha = rand(0.25,0.7);
    const r = rand(1,4);
    g.fillRect(Math.random()*s, Math.random()*s, r, r);
  }
  g.globalAlpha = 1;
  for (let i=0;i<70;i++){ // hlinené fľaky a lístie
    g.fillStyle = Math.random()<0.5 ? 'rgba(62,50,32,0.25)' : 'rgba(42,54,28,0.28)';
    g.beginPath();
    g.ellipse(Math.random()*s, Math.random()*s, rand(10,45), rand(8,30), rand(0,3), 0, 7);
    g.fill();
  }
  for (let i=0;i<400;i++){
    g.fillStyle = `rgba(${95+Math.random()*35|0},${75+Math.random()*25|0},42,${rand(0.15,0.35)})`;
    g.fillRect(Math.random()*s, Math.random()*s, rand(1,3), rand(1,3));
  }
});
groundTex.repeat.set(104, 180);

const barkTex = makeCanvas(128, (g,s)=>{
  g.fillStyle = '#6d573c'; g.fillRect(0,0,s,s);
  for (let x=0;x<s;x+=rand(3,7)){
    g.fillStyle = ['#5c4830','#7d6647','#4e3d28','#8a7154'][(Math.random()*4)|0];
    g.globalAlpha = rand(0.4,0.9);
    g.fillRect(x, 0, rand(2,5), s);
  }
  g.globalAlpha = 0.45; g.fillStyle = '#42341f';
  for (let i=0;i<40;i++) g.fillRect(Math.random()*s, Math.random()*s, rand(1,3), rand(6,26));
  g.globalAlpha = 0.3; g.fillStyle = '#8f9a72';   // machové škvrny
  for (let i=0;i<18;i++){
    g.beginPath();
    g.ellipse(Math.random()*s, Math.random()*s, rand(3,9), rand(4,14), 0, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;
});
barkTex.repeat.set(1.5, 3);

const grassTex = makeCanvas(128, (g,s)=>{
  g.clearRect(0,0,s,s);
  for (let i=0;i<26;i++){
    const x = rand(6, s-6), w = rand(2.5,5), hgt = rand(s*0.45, s*0.95);
    const lean = rand(-14,14);
    g.fillStyle = ['#3a5424','#48632e','#2f4a1f','#557038'][(Math.random()*4)|0];
    g.beginPath();
    g.moveTo(x-w/2, s); g.lineTo(x+w/2, s); g.lineTo(x+lean, s-hgt);
    g.closePath(); g.fill();
  }
});

const camoTex = makeCanvas(128, (g,s)=>{
  g.fillStyle = '#4a5638'; g.fillRect(0,0,s,s);
  const cols = ['#33402a','#5c6644','#26301e','#6d7351'];
  for (let i=0;i<60;i++){
    g.fillStyle = cols[(Math.random()*cols.length)|0];
    g.beginPath();
    g.ellipse(Math.random()*s, Math.random()*s, rand(6,22), rand(4,12), rand(0,3), 0, 7);
    g.fill();
  }
});
camoTex.repeat.set(1,1);

const plankTex = makeCanvas(256, (g,s)=>{
  g.fillStyle = '#7a5c3c'; g.fillRect(0,0,s,s);
  const rows = 6;
  for (let r=0;r<rows;r++){
    const y = r*s/rows;
    g.fillStyle = ['#75573a','#836440','#6b5034','#7d5f3e'][r%4];
    g.fillRect(0, y, s, s/rows-2);
    g.fillStyle = 'rgba(40,26,14,0.8)';
    g.fillRect(0, y+s/rows-2, s, 2);
    g.fillStyle = 'rgba(60,42,24,0.5)';
    for (let i=0;i<26;i++) g.fillRect(Math.random()*s, y+rand(2,s/rows-4), rand(8,40), 1);
  }
});
plankTex.repeat.set(2,1);

const roofTex = makeCanvas(256, (g,s)=>{
  g.fillStyle = '#43372c'; g.fillRect(0,0,s,s);
  const rows = 8;
  for (let r=0;r<rows;r++){
    const y = r*s/rows;
    for (let x=0;x<s;x+=32){
      g.fillStyle = ['#3c3126','#4a3d30','#352b21','#463a2c'][(Math.random()*4)|0];
      g.fillRect(x+((r%2)*16), y, 30, s/rows-2);
    }
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, y+s/rows-2, s, 2);
  }
});
roofTex.repeat.set(3,2);

function makeRadialTex(color, inner){
  return makeCanvas(64, (g,s)=>{
    const rg = g.createRadialGradient(s/2,s/2,2, s/2,s/2,s/2);
    rg.addColorStop(0, inner);
    rg.addColorStop(1, color);
    g.fillStyle = rg; g.fillRect(0,0,s,s);
  });
}
const puffTexture = makeRadialTex('rgba(150,140,120,0)','rgba(190,180,160,0.85)');
const bloodTexture = makeRadialTex('rgba(110,10,10,0)','rgba(140,18,14,0.9)');
const smokeTexture = makeRadialTex('rgba(180,180,180,0)','rgba(200,200,200,0.5)');
const muzzleTexture = makeCanvas(64, (g,s)=>{
  g.clearRect(0,0,s,s);
  g.translate(s/2,s/2);
  const rg = g.createRadialGradient(0,0,1, 0,0,s/2);
  rg.addColorStop(0,'rgba(255,255,230,1)');
  rg.addColorStop(0.35,'rgba(255,200,90,0.9)');
  rg.addColorStop(1,'rgba(255,140,30,0)');
  g.fillStyle = rg;
  for (let i=0;i<6;i++){
    g.rotate(Math.PI/3);
    g.beginPath();
    g.moveTo(0,-3); g.lineTo(s/2,0); g.lineTo(0,3);
    g.closePath(); g.fill();
  }
  g.beginPath(); g.arc(0,0,7,0,7); g.fill();
});

const signTex = makeCanvas(256, (g,s)=>{
  g.fillStyle = '#6b5236'; g.fillRect(0,0,s,s);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y=0; y<s; y+=18) g.fillRect(0, y, s, 2);      // drevené dosky
  g.strokeStyle = '#3c2d1c'; g.lineWidth = 12; g.strokeRect(6,6,s-12,s-12);
  g.fillStyle = '#f3e9cf';
  g.font = 'bold 52px sans-serif'; g.textAlign='center'; g.textBaseline='middle';
  g.fillText('BEZPEČNÝ', s/2, s/2-30);
  g.fillText('DOM', s/2, s/2+32);
});
signTex.wrapS = signTex.wrapT = THREE.ClampToEdgeWrapping;

// ---------- Spájanie geometrií ----------
function mergeGeoms(list){
  const g = new THREE.BufferGeometry();
  const pos=[], norm=[], uv=[], idx=[];
  let off = 0;
  for (const src of list){
    const p = src.attributes.position, n = src.attributes.normal, u = src.attributes.uv;
    for (let i=0;i<p.count;i++){
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      norm.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u?u.getX(i):0, u?u.getY(i):0);
    }
    if (src.index){ for (let i=0;i<src.index.count;i++) idx.push(src.index.getX(i)+off); }
    else { for (let i=0;i<p.count;i++) idx.push(i+off); }
    off += p.count;
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm,3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(idx);
  return g;
}

// ---------- Terén ----------
// Podlaha je výrazne širšia než hrací priestor, aby hráč nikdy nedovidel na jej okraj.
const groundGeo = new THREE.PlaneGeometry(520, 900, 130, 200);
groundGeo.rotateX(-Math.PI/2);
groundGeo.translate(0, 0, 200);
{
  const p = groundGeo.attributes.position;
  for (let i=0;i<p.count;i++) p.setY(i, terrainH(p.getX(i), p.getZ(i)));
  groundGeo.computeVertexNormals();
}
const groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({map:groundTex, roughness:1}));
groundMesh.receiveShadow = true;
scene.add(groundMesh);

// ---------- Kolízna mriežka kmeňov ----------
const trunkGrid = new Map();
const CELL = 8;
function gridKey(cx,cz){ return cx+','+cz; }
function addTrunkCollider(x,z,r,topY){
  const cx = Math.floor(x/CELL), cz = Math.floor(z/CELL);
  const key = gridKey(cx,cz);
  if (!trunkGrid.has(key)) trunkGrid.set(key, []);
  trunkGrid.get(key).push({x,z,r,topY});
}
function forEachTrunkNear(x,z,rad,cb){
  const c0x = Math.floor((x-rad)/CELL), c1x = Math.floor((x+rad)/CELL);
  const c0z = Math.floor((z-rad)/CELL), c1z = Math.floor((z+rad)/CELL);
  for (let cx=c0x;cx<=c1x;cx++) for (let cz=c0z;cz<=c1z;cz++){
    const arr = trunkGrid.get(gridKey(cx,cz));
    if (arr) for (const t of arr) cb(t);
  }
}
// Zistí, či úsečku a→b pretína kmeň stromu; vracia bod zásahu do kmeňa, inak null.
// Kmene riešime ako zvislé valce a testujeme ich presne — vzorkovanie po krokoch by
// tenké kmene občas preskočilo a hráč by dostával zásahy „cez" strom, za ktorým stojí.
function losBlocked(a, b){
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx*dx + dz*dz;
  if (len2 < 0.25) return null;
  let best = null, bestS = Infinity;
  const pad = 1;
  const c0x = Math.floor((Math.min(a.x,b.x)-pad)/CELL), c1x = Math.floor((Math.max(a.x,b.x)+pad)/CELL);
  const c0z = Math.floor((Math.min(a.z,b.z)-pad)/CELL), c1z = Math.floor((Math.max(a.z,b.z)+pad)/CELL);
  for (let cx=c0x; cx<=c1x; cx++) for (let cz=c0z; cz<=c1z; cz++){
    const arr = trunkGrid.get(gridKey(cx,cz));
    if (!arr) continue;
    for (const t of arr){
      // najbližší bod úsečky ku kmeňu v pôdoryse
      let s = ((t.x-a.x)*dx + (t.z-a.z)*dz) / len2;
      s = clamp(s, 0, 1);
      const px = a.x + dx*s, pz = a.z + dz*s;
      if (Math.hypot(px-t.x, pz-t.z) > t.r) continue;
      const py = a.y + (b.y-a.y)*s;
      if (py >= t.topY) continue;              // strela preletí ponad kmeň
      if (s < bestS){ bestS = s; best = new THREE.Vector3(px, py, pz); }
    }
  }
  return best;
}

// ---------- Les ----------
const treeMats = {
  bark: new THREE.MeshStandardMaterial({map:barkTex, roughness:1}),
  pine: new THREE.MeshStandardMaterial({color:srgb(0x2a4222), roughness:1}),
  leaf: new THREE.MeshStandardMaterial({color:srgb(0x3d5726), roughness:1})
};
// deterministický šum vrcholov — nepravidelné, prirodzenejšie koruny (bez trhlín na švíkoch)
function roughen(geo, amp){
  const p = geo.attributes.position;
  for (let i=0;i<p.count;i++){
    const x=p.getX(i), y=p.getY(i), z=p.getZ(i);
    const n1 = Math.sin(x*12.7+y*7.3+z*9.1), n2 = Math.sin(x*5.3-y*11.2+z*6.7);
    p.setXYZ(i, x + n1*amp, y + n2*amp*0.6, z + Math.sin(x*8.1+y*4.9-z*10.3)*amp);
  }
  geo.computeVertexNormals();
  return geo;
}

// smrek: kmeň + 3 kužele
const pineTrunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 5.2, 7);
pineTrunkGeo.translate(0, 2.6, 0);
const pineCrownGeo = roughen(mergeGeoms([
  new THREE.ConeGeometry(2.1, 2.6, 9).translate(0, 2.6, 0),
  new THREE.ConeGeometry(1.8, 2.6, 9).translate(0, 4.0, 0),
  new THREE.ConeGeometry(1.45, 2.5, 9).translate(0, 5.4, 0),
  new THREE.ConeGeometry(1.05, 2.4, 9).translate(0, 6.7, 0),
  new THREE.ConeGeometry(0.6, 2.0, 8).translate(0, 8.0, 0)
]), 0.2);
// listnáč: kmeň + guľaté koruny
const leafTrunkGeo = new THREE.CylinderGeometry(0.14, 0.26, 3.6, 7);
leafTrunkGeo.translate(0, 1.8, 0);
const leafCrownGeo = roughen(mergeGeoms([
  new THREE.IcosahedronGeometry(1.5, 1).translate(0, 4.2, 0),
  new THREE.IcosahedronGeometry(1.15, 1).translate(0.95, 3.5, 0.35),
  new THREE.IcosahedronGeometry(1.05, 1).translate(-0.85, 3.7, -0.45),
  new THREE.IcosahedronGeometry(0.85, 1).translate(0.25, 5.0, -0.7),
  new THREE.IcosahedronGeometry(0.8, 1).translate(-0.4, 4.6, 0.85)
]), 0.16);

// Stromy v hracej ploche majú kolízie aj tiene. Kulisa okolo nej ich nemá — je ďaleko
// v hmle, takže by len zaťažovala shadow mapu.
const trees = [];
const backdropTrees = [];
{
  const houseD = (x,z)=>Math.hypot(x, z-HOUSE_Z);
  let attempts = 0;
  while (trees.length < 1250 && attempts < 26000){
    attempts++;
    const x = rand(-74, 74), z = rand(-24, 412);
    if (Math.hypot(x, z-4) < 8) continue;                 // štart voľný
    if (houseD(x,z) < 15) continue;                       // čistinka pri dome
    if (houseD(x,z) < 24 && Math.random() < 0.55) continue;
    let tooClose = false;
    forEachTrunkNear(x, z, 2.2, t=>{ if (Math.hypot(x-t.x,z-t.z) < 1.7) tooClose = true; });
    if (tooClose) continue;
    const pine = Math.random() < 0.68;
    const s = rand(0.8, 1.6);
    const y = terrainH(x,z);
    trees.push({x, y, z, s, pine, rot: rand(0, Math.PI*2)});
    addTrunkCollider(x, z, (pine?0.30:0.26)*s, y + (pine?5.2:3.6)*s);
  }
  // kulisa: prstenec okolo hracej plochy, aby hráč nikdy nedovidel na jej okraj
  for (let i=0; i<1500; i++){
    const x = rand(-210, 210), z = rand(-140, 570);
    if (Math.abs(x) < 76 && z > -26 && z < 414) continue;  // vnútro rieši hustý les
    if (houseD(x,z) < 30) continue;
    backdropTrees.push({
      x, y: terrainH(x,z), z,
      s: rand(0.9, 1.7), pine: Math.random() < 0.7, rot: rand(0, Math.PI*2)
    });
  }
}
function fillInstances(mesh, list, tintFrom, tintTo, shadows){
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const sv = new THREE.Vector3(), pv = new THREE.Vector3(), col = new THREE.Color();
  list.forEach((t,i)=>{
    e.set(0, t.rot, 0); q.setFromEuler(e);
    pv.set(t.x, t.y, t.z); sv.set(t.s, t.s*rand(0.92,1.1), t.s);
    m.compose(pv, q, sv);
    mesh.setMatrixAt(i, m);
    col.set(tintFrom).lerp(new THREE.Color(tintTo), Math.random());
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = shadows !== false;
  mesh.receiveShadow = shadows !== false;
  scene.add(mesh);
  return mesh;
}
const pines = trees.filter(t=>t.pine), leafs = trees.filter(t=>!t.pine);
const pineTrunkMesh = fillInstances(new THREE.InstancedMesh(pineTrunkGeo, treeMats.bark, pines.length), pines, 0xffffff, 0x9a8c78);
const pineCrownMesh = fillInstances(new THREE.InstancedMesh(pineCrownGeo, treeMats.pine, pines.length), pines, 0xffffff, 0x6a8a58);
const leafTrunkMesh = fillInstances(new THREE.InstancedMesh(leafTrunkGeo, treeMats.bark, leafs.length), leafs, 0xffffff, 0xa89a82);
const leafCrownMesh = fillInstances(new THREE.InstancedMesh(leafCrownGeo, treeMats.leaf, leafs.length), leafs, 0xffffff, 0x7a9a50);
{
  const bPines = backdropTrees.filter(t=>t.pine), bLeafs = backdropTrees.filter(t=>!t.pine);
  fillInstances(new THREE.InstancedMesh(pineTrunkGeo, treeMats.bark, bPines.length), bPines, 0xffffff, 0x9a8c78, false);
  fillInstances(new THREE.InstancedMesh(pineCrownGeo, treeMats.pine, bPines.length), bPines, 0xffffff, 0x6a8a58, false);
  fillInstances(new THREE.InstancedMesh(leafTrunkGeo, treeMats.bark, bLeafs.length), bLeafs, 0xffffff, 0xa89a82, false);
  fillInstances(new THREE.InstancedMesh(leafCrownGeo, treeMats.leaf, bLeafs.length), bLeafs, 0xffffff, 0x7a9a50, false);
}

// tráva
{
  const gGeo = new THREE.PlaneGeometry(1.1, 0.85);
  gGeo.translate(0, 0.42, 0);
  const gMat = new THREE.MeshStandardMaterial({map:grassTex, alphaTest:0.35, side:THREE.DoubleSide, roughness:1});
  const N = 3200;
  const gMesh = new THREE.InstancedMesh(gGeo, gMat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const col = new THREE.Color();
  for (let i=0;i<N;i++){
    const x = rand(-64, 64), z = rand(-16, 410);
    e.set(0, rand(0,Math.PI), 0); q.setFromEuler(e);
    const s = rand(0.7, 1.5);
    m.compose(new THREE.Vector3(x, terrainH(x,z), z), q, new THREE.Vector3(s,s,s));
    gMesh.setMatrixAt(i, m);
    // inštančná farba je násobič nad textúrou — drž ju okolo 1, inak tráva sčernie
    col.setRGB(rand(0.62,1.05), rand(0.72,1.1), rand(0.5,0.9));
    gMesh.setColorAt(i, col);
  }
  gMesh.receiveShadow = true;
  scene.add(gMesh);
}
// kríky
{
  const bGeo = new THREE.IcosahedronGeometry(0.7, 1);
  bGeo.translate(0, 0.45, 0);
  bGeo.scale(1.3, 0.8, 1.3);
  const bMat = new THREE.MeshStandardMaterial({color:srgb(0x2f4522), roughness:1});
  const N = 260;
  const bMesh = new THREE.InstancedMesh(bGeo, bMat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  for (let i=0;i<N;i++){
    const x = rand(-64,64), z = rand(-16,404);
    e.set(0, rand(0,6), 0); q.setFromEuler(e);
    const s = rand(0.6, 1.6);
    m.compose(new THREE.Vector3(x, terrainH(x,z), z), q, new THREE.Vector3(s, s*rand(0.7,1), s));
    bMesh.setMatrixAt(i, m);
    col.setRGB(rand(0.7,1.25), rand(0.8,1.3), rand(0.6,1.0));
    bMesh.setColorAt(i, col);
  }
  bMesh.castShadow = true; bMesh.receiveShadow = true;
  scene.add(bMesh);
}
// kamene
let rockMesh;
{
  const rGeo = new THREE.DodecahedronGeometry(0.6, 0);
  const rMat = new THREE.MeshStandardMaterial({color:srgb(0x8a8578), roughness:1});
  const N = 120;
  rockMesh = new THREE.InstancedMesh(rGeo, rMat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  for (let i=0;i<N;i++){
    const x = rand(-64,64), z = rand(-16,404);
    e.set(rand(0,3), rand(0,3), rand(0,3)); q.setFromEuler(e);
    const s = rand(0.3, 1.4);
    m.compose(new THREE.Vector3(x, terrainH(x,z)+0.05, z), q, new THREE.Vector3(s, s*rand(0.5,0.8), s));
    rockMesh.setMatrixAt(i, m);
    col.setRGB(rand(0.55,1.05), rand(0.55,1.0), rand(0.5,0.95));
    rockMesh.setColorAt(i, col);
  }
  rockMesh.castShadow = true; rockMesh.receiveShadow = true;
  scene.add(rockMesh);
}
// padnuté kmene
for (let i=0;i<16;i++){
  const x = rand(-55,55), z = rand(10,380);
  const len = rand(3,6);
  const log = new THREE.Mesh(new THREE.CylinderGeometry(rand(0.18,0.3), rand(0.2,0.34), len, 7), treeMats.bark);
  log.rotation.z = Math.PI/2 + rand(-0.15,0.15);
  log.rotation.y = rand(0, Math.PI);
  log.position.set(x, terrainH(x,z)+0.22, z);
  log.castShadow = log.receiveShadow = true;
  scene.add(log);
}

// oblaky
{
  const cTex = makeCanvas(128, (g,s)=>{
    g.clearRect(0,0,s,s);
    for (let i=0;i<9;i++){
      const rg = g.createRadialGradient(rand(s*0.25,s*0.75), rand(s*0.35,s*0.65), 2, s/2, s/2, s*0.45);
      rg.addColorStop(0,'rgba(255,255,255,0.5)');
      rg.addColorStop(1,'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(0,0,s,s);
    }
  });
  for (let i=0;i<10;i++){
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:cTex, transparent:true, opacity:rand(0.4,0.7), fog:false, depthWrite:false}));
    sp.position.set(rand(-500,500), rand(120,210), rand(-300,650));
    const sc = rand(90,190);
    sp.scale.set(sc, sc*0.45, 1);
    scene.add(sp);
  }
}

// ---------- Bezpečný dom ----------
{
  const hY = terrainH(0, HOUSE_Z);
  const house = new THREE.Group();
  house.position.set(0, hY, HOUSE_Z);
  const wallMat = new THREE.MeshStandardMaterial({map:plankTex, roughness:1});
  const roofMat = new THREE.MeshStandardMaterial({map:roofTex, roughness:1});
  const body = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 6), wallMat);
  body.position.y = 1.7;
  body.castShadow = body.receiveShadow = true;
  house.add(body);
  // sedlová strecha
  const roofL = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.18, 3.9), roofMat);
  roofL.position.set(0, 4.1, -1.55); roofL.rotation.x = -0.42; roofL.castShadow = true;
  const roofR = roofL.clone(); roofR.position.z = 1.55; roofR.rotation.x = 0.42;
  house.add(roofL, roofR);
  const gableGeo = new THREE.BufferGeometry();
  gableGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -4,3.4,0,  4,3.4,0,  0,4.9,0
  ],3));
  gableGeo.setIndex([0,1,2]); gableGeo.computeVertexNormals();
  const gF = new THREE.Mesh(gableGeo, wallMat); gF.position.z = 3.001; house.add(gF);
  const gB = new THREE.Mesh(gableGeo, wallMat); gB.position.z = -3.001; gB.rotation.y = Math.PI; house.add(gB);
  // dvere a okná (predná stena smerom k lesu = -Z domu... hráč prichádza od z<HOUSE_Z)
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.12), new THREE.MeshStandardMaterial({color:srgb(0x4a3524), roughness:0.9}));
  door.position.set(0, 1.1, -3.02);
  house.add(door);
  const winMat = new THREE.MeshStandardMaterial({color:srgb(0xffd98a), emissive:srgb(0xffb84d), emissiveIntensity:0.9, roughness:0.4});
  for (const wx of [-2.4, 2.4]){
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 0.1), winMat);
    win.position.set(wx, 1.9, -3.02);
    house.add(win);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.2, 0.06), new THREE.MeshStandardMaterial({color:srgb(0x3a2c1c)}));
    frame.position.set(wx, 1.9, -3.0);
    house.add(frame);
  }
  // komín + tabuľa
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.2, 0.7), new THREE.MeshStandardMaterial({color:srgb(0x6f675c), roughness:1}));
  chimney.position.set(2.6, 4.6, 0.6); chimney.castShadow = true;
  house.add(chimney);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({map:signTex, transparent:false}));
  sign.position.set(0, 3.0, -3.06);
  sign.rotation.y = Math.PI;
  house.add(sign);
  const porchLight = new THREE.PointLight(0xffc06a, 0.9, 14, 2);
  porchLight.position.set(0, 2.6, -3.6);
  house.add(porchLight);
  scene.add(house);
  addTrunkCollider(-4, HOUSE_Z, 0.4, hY+4); // rohy domu ako hrubé kolízie
  addTrunkCollider(4, HOUSE_Z, 0.4, hY+4);
}
// dym z komína
const smokePuffs = [];
for (let i=0;i<7;i++){
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:smokeTexture, transparent:true, opacity:0, depthWrite:false}));
  scene.add(sp);
  smokePuffs.push({sp, t: i/7});
}

// ---------- Vojak (šablóna) ----------
const soldierMats = {
  camo: new THREE.MeshStandardMaterial({map:camoTex, roughness:1}),
  vest: new THREE.MeshStandardMaterial({color:srgb(0x2e3524), roughness:1}),
  skin: new THREE.MeshStandardMaterial({color:srgb(0xc9996f), roughness:0.9}),
  helmet: new THREE.MeshStandardMaterial({color:srgb(0x39422c), roughness:1}),
  rifle: new THREE.MeshStandardMaterial({color:srgb(0x191919), roughness:0.6, metalness:0.4}),
  boot: new THREE.MeshStandardMaterial({color:srgb(0x241f18), roughness:1})
};
function buildSoldier(){
  const root = new THREE.Group();
  const cast = m=>{ m.castShadow = true; return m; };
  // nohy s pivotmi v bedrách
  const legL = new THREE.Group(); legL.position.set(-0.11, 0.95, 0);
  const legR = new THREE.Group(); legR.position.set(0.11, 0.95, 0);
  for (const [leg] of [[legL],[legR]]){
    const thigh = cast(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.9, 0.2), soldierMats.camo));
    thigh.position.y = -0.45;
    const boot = cast(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.3), soldierMats.boot));
    boot.position.set(0, -0.88, 0.05);
    leg.add(thigh, boot);
  }
  root.add(legL, legR);
  const torso = cast(new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.66, 0.28), soldierMats.camo));
  torso.position.y = 1.28;
  const vest = cast(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.44, 0.32), soldierMats.vest));
  vest.position.y = 1.33;
  root.add(torso, vest);
  // hlava
  const head = new THREE.Group(); head.position.y = 1.74;
  const face = cast(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.22), soldierMats.skin));
  face.userData.head = true;
  const helmet = cast(new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 7, 0, Math.PI*2, 0, Math.PI*0.62), soldierMats.helmet));
  helmet.position.y = 0.06;
  helmet.scale.set(1, 0.95, 1.08);
  helmet.userData.head = true;
  head.add(face, helmet);
  root.add(head);
  // mieriaca skupina: ramená + puška, otáča sa vo výške pŕs
  const aim = new THREE.Group(); aim.position.y = 1.5;
  const armL = cast(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.5), soldierMats.camo));
  armL.position.set(-0.18, -0.05, 0.28); armL.rotation.y = 0.5;
  const armR = cast(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.44), soldierMats.camo));
  armR.position.set(0.16, -0.03, 0.24); armR.rotation.y = -0.35;
  const gun = new THREE.Group();
  gun.position.set(0.02, 0, 0.3);
  const receiver = cast(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.55), soldierMats.rifle));
  const barrel = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6), soldierMats.rifle));
  barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.01, 0.42);
  const mag = cast(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.09), soldierMats.rifle));
  mag.position.set(0, -0.12, 0.1); mag.rotation.x = 0.3;
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, 0.6);
  gun.add(receiver, barrel, mag, muzzle);
  aim.add(armL, armR, gun);
  root.add(aim);

  // Neviditeľné zásahové objemy. Bez nich by lúč prechádzal medzi nohami a okolo trupu —
  // mierenie na siluetu musí platiť ako zásah, presne ako v bežných FPS hrách.
  const hitMat = new THREE.MeshBasicMaterial({visible:false});
  const hitBody = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.56, 0.44), hitMat);
  hitBody.position.y = 0.83;
  const hitHead = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.38, 0.36), hitMat);
  hitHead.position.y = 1.80;
  hitHead.userData.head = true;
  root.add(hitBody, hitHead);

  root.userData = { legL, legR, aim, head, muzzle, hitBody, hitHead };
  return root;
}

// ---------- Nepriatelia ----------
const enemies = [];
const enemyHitMeshes = [];   // meshe pre raycast hráčovej streľby
function spawnEnemies(){
  const n = 18;
  for (let i=0;i<n;i++){
    const z = 42 + i*19 + rand(-6,6);
    const spawnHalf = Math.min(42, corridorHalfWidth(z) - 3);
    let x = rand(-spawnHalf, spawnHalf);
    // neumiestňuj do stromu
    let ok = false, tries = 0;
    while (!ok && tries<20){
      ok = true; tries++;
      forEachTrunkNear(x, z, 1.5, t=>{ if (Math.hypot(x-t.x,z-t.z) < t.r+0.7) ok = false; });
      if (!ok) x = rand(-spawnHalf, spawnHalf);
    }
    const g = buildSoldier();
    const y = terrainH(x,z);
    g.position.set(x, y, z);
    g.rotation.y = Math.PI; // pozerá proti hráčovi
    scene.add(g);
    const en = {
      group: g, x, z, hp: 2, state: 'idle', dead: false,
      deathT: 0, walkPhase: rand(0,6),
      prefRange: rand(15, 28),
      burstLeft: 0, shotTimer: 0, cooldown: rand(0.4, 1.6),
      strafeDir: Math.random()<0.5?-1:1, strafeT: rand(1,3),
      alertDelay: 0
    };
    // Na streľbu sa testujú len zásahové objemy, nie jednotlivé časti modelu.
    for (const hm of [g.userData.hitBody, g.userData.hitHead]){
      hm.userData.enemy = en;
      enemyHitMeshes.push(hm);
    }
    enemies.push(en);
  }
}

// ---------- Efekty ----------
const fxPool = [];
for (let i=0;i<50;i++){
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({transparent:true, opacity:0, depthWrite:false}));
  sp.visible = false;
  scene.add(sp);
  fxPool.push({sp, life:0, maxLife:1, grow:0, baseScale:1});
}
function spawnFx(pos, tex, scale, grow, life, additive){
  const fx = fxPool.find(f=>f.life<=0);
  if (!fx) return;
  fx.sp.material.map = tex;
  fx.sp.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  fx.sp.material.opacity = 1;
  fx.sp.material.rotation = rand(0, Math.PI*2);
  fx.sp.position.copy(pos);
  fx.sp.scale.set(scale, scale, 1);
  fx.sp.visible = true;
  fx.life = fx.maxLife = life;
  fx.grow = grow;
  fx.baseScale = scale;
}
function updateFx(dt){
  for (const fx of fxPool){
    if (fx.life <= 0) continue;
    fx.life -= dt;
    if (fx.life <= 0){ fx.sp.visible = false; continue; }
    const t = 1 - fx.life/fx.maxLife;
    const s = fx.baseScale + fx.grow*t;
    fx.sp.scale.set(s, s, 1);
    fx.sp.material.opacity = 1 - t;
  }
}
// stopy striel
const tracers = [];
for (let i=0;i<26;i++){
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({color:srgb(0xffd9a0), transparent:true, opacity:0.85, blending:THREE.AdditiveBlending, depthWrite:false}));
  line.visible = false;
  scene.add(line);
  tracers.push({line, life:0});
}
function spawnTracer(a, b){
  const t = tracers.find(t=>t.life<=0);
  if (!t) return;
  const p = t.line.geometry.attributes.position;
  p.setXYZ(0, a.x, a.y, a.z);
  p.setXYZ(1, b.x, b.y, b.z);
  p.needsUpdate = true;
  t.line.visible = true;
  t.life = 0.06;
}
function updateTracers(dt){
  for (const t of tracers){
    if (t.life <= 0) continue;
    t.life -= dt;
    if (t.life <= 0) t.line.visible = false;
  }
}
const enemyFlashLight = new THREE.PointLight(0xffb45a, 0, 12, 2);
scene.add(enemyFlashLight);
let enemyFlashT = 0;

// ---------- Zvuk (WebAudio, syntetizovaný) ----------
let actx = null, masterGain = null, noiseBuf = null;
function initAudio(){
  if (actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  masterGain = actx.createGain();
  masterGain.gain.value = 0.55;
  masterGain.connect(actx.destination);
  const len = actx.sampleRate * 2;
  noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i=0;i<len;i++) d[i] = Math.random()*2-1;
  // vietor
  const wind = actx.createBufferSource();
  wind.buffer = noiseBuf; wind.loop = true;
  const windFil = actx.createBiquadFilter();
  windFil.type = 'lowpass'; windFil.frequency.value = 380;
  const windGain = actx.createGain(); windGain.gain.value = 0.06;
  const lfo = actx.createOscillator(); lfo.frequency.value = 0.13;
  const lfoGain = actx.createGain(); lfoGain.gain.value = 0.03;
  lfo.connect(lfoGain); lfoGain.connect(windGain.gain);
  wind.connect(windFil); windFil.connect(windGain); windGain.connect(masterGain);
  wind.start(); lfo.start();
  scheduleBird();
}
function noiseBurst(dur, filterType, freq, gain, q){
  if (!actx) return;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = rand(0.9, 1.1);
  const fil = actx.createBiquadFilter();
  fil.type = filterType; fil.frequency.value = freq;
  if (q) fil.Q.value = q;
  const g = actx.createGain();
  g.gain.setValueAtTime(gain, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
  src.connect(fil); fil.connect(g); g.connect(masterGain);
  src.start(); src.stop(actx.currentTime + dur + 0.05);
}
function sfxPlayerShot(){ noiseBurst(0.16, 'lowpass', 2400, 0.5); noiseBurst(0.08, 'highpass', 1200, 0.25); }
function sfxEnemyShot(dist){
  const g = clamp(7/dist, 0.04, 0.5);
  noiseBurst(0.2, 'lowpass', clamp(2600 - dist*28, 350, 2600), g);
}
function sfxWhizz(){ noiseBurst(0.09, 'bandpass', rand(2600,4200), 0.12, 6); }
function sfxImpact(){ noiseBurst(0.07, 'lowpass', 900, 0.14); }
function sfxPlayerHit(){
  noiseBurst(0.12, 'lowpass', 500, 0.5);
  if (!actx) return;
  const o = actx.createOscillator(); o.type='sine';
  o.frequency.setValueAtTime(140, actx.currentTime);
  o.frequency.exponentialRampToValueAtTime(60, actx.currentTime+0.25);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.4, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime+0.3);
  o.connect(g); g.connect(masterGain);
  o.start(); o.stop(actx.currentTime+0.32);
}
function sfxEnemyDown(){ noiseBurst(0.25, 'lowpass', 300, 0.3); }
function sfxReload(stage){ noiseBurst(0.05, 'highpass', stage===0?1800:2600, 0.16); }
function sfxStep(){ noiseBurst(0.05, 'lowpass', rand(500,750), 0.07); }
function sfxClick(){ noiseBurst(0.03, 'highpass', 3000, 0.1); }
function scheduleBird(){
  if (!actx) return;
  setTimeout(()=>{
    if (actx && game.status !== 'over'){
      const o = actx.createOscillator(); o.type='sine';
      const t0 = actx.currentTime;
      const f0 = rand(2600, 3800);
      o.frequency.setValueAtTime(f0, t0);
      for (let i=0;i<3;i++){
        o.frequency.setValueAtTime(f0 + rand(-300,500), t0 + 0.07*i);
        o.frequency.exponentialRampToValueAtTime(f0*rand(0.8,1.2), t0 + 0.07*i + 0.05);
      }
      const g = actx.createGain();
      g.gain.setValueAtTime(0.035, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
      o.connect(g); g.connect(masterGain);
      o.start(); o.stop(t0 + 0.3);
    }
    scheduleBird();
  }, rand(2500, 8000));
}

// ---------- Zbraň hráča (viewmodel) ----------
const weapon = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({color:srgb(0x1d1d1f), roughness:0.55, metalness:0.35});
  const grip = new THREE.MeshStandardMaterial({color:srgb(0x2c2620), roughness:0.9});
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.52), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.4, 8), dark);
  barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.012, -0.42);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.22), grip);
  stock.position.set(0, -0.02, 0.32);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, 0.09), dark);
  mag.position.set(0, -0.12, -0.06); mag.rotation.x = 0.25;
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.24), grip);
  handguard.position.set(0, 0, -0.28);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.08), dark);
  sight.position.set(0, 0.075, -0.05);
  weapon.add(receiver, barrel, stock, mag, handguard, sight);
  weapon.position.set(0.26, -0.24, -0.55);
  weapon.rotation.y = 0.03;
  camera.add(weapon);
}
const muzzleSprite = new THREE.Sprite(new THREE.SpriteMaterial({map:muzzleTexture, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false}));
muzzleSprite.position.set(0.26, -0.21, -1.05);
muzzleSprite.scale.set(0.32, 0.32, 1);
camera.add(muzzleSprite);
const playerFlashLight = new THREE.PointLight(0xffc66a, 0, 9, 2);
camera.add(playerFlashLight);

// ---------- Stav hry ----------
const game = {
  status: 'menu',   // menu | playing | paused | over | win
  elapsed: 0, score: 0, kills: 0, hits: 0,
  invuln: 0, shakeT: 0
};
const player = {
  x: 0, z: 4, yaw: Math.PI, pitch: 0,  // yaw PI => pozerá do +Z (do lesa)
  vy: 0, bobPhase: 0, stepAcc: 0,
  ammo: 30, magSize: 30, reloading: 0,
  fireCooldown: 0, firing: false, recoil: 0, recoilPitch: 0
};
// yaw: forward = (sin(yaw), cos(yaw))? Definujme: forward = (-sin(yaw), -cos(yaw)) ako pri kamere Three (pozerá do -Z pri yaw 0).
// Hráč štartuje pohľadom do +Z → yaw = PI.

const HUD = {
  score: document.getElementById('scoreVal'),
  kills: document.getElementById('killsVal'),
  ammo: document.getElementById('ammoVal'),
  hits: [...document.querySelectorAll('.hitPip')],
  progress: document.getElementById('progressFill'),
  reloadNote: document.getElementById('reloadNote'),
  houseNote: document.getElementById('houseNote'),
  damageFlash: document.getElementById('damageFlash'),
  vignette: document.getElementById('vignette')
};
const screens = {
  start: document.getElementById('startScreen'),
  pause: document.getElementById('pauseScreen'),
  over: document.getElementById('gameoverScreen'),
  win: document.getElementById('winScreen')
};
function showScreen(name){
  for (const k in screens) screens[k].classList.toggle('hidden', k!==name);
  if (!name) for (const k in screens) screens[k].classList.add('hidden');
}

// ---------- Vstup ----------
const keys = {};
window.addEventListener('keydown', e=>{
  keys[e.code] = true;
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyR' && game.status==='playing') startReload();
});
window.addEventListener('keyup', e=>{ keys[e.code] = false; });

const NOLOCK = /[?&]nolock/.test(location.search);
let pointerLocked = false;
document.addEventListener('pointerlockchange', ()=>{
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked && game.status==='playing' && !isTouch && !NOLOCK) pauseGame();
});
document.addEventListener('mousemove', e=>{
  if ((pointerLocked || NOLOCK) && (game.status==='playing')){
    player.yaw -= e.movementX * 0.0022;
    player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.45, 1.45);
  }
});
canvas.addEventListener('mousedown', e=>{
  if (game.status==='playing' && !isTouch){
    if (!pointerLocked && !NOLOCK){ lockPointer(); return; }
    if (e.button === 0) player.firing = true;
  }
});
window.addEventListener('mouseup', e=>{ if (e.button===0) player.firing = false; });
function lockPointer(){
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(()=>{});
  } catch(err){}
}

// dotykové ovládanie
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');
const touchState = { moveId:null, lookId:null, ox:0, oy:0, mx:0, my:0, lx:0, ly:0 };
const joyZone = document.getElementById('joyZone');
const joyKnob = document.getElementById('joyKnob');
const fireBtn = document.getElementById('fireBtn');
const reloadBtn = document.getElementById('reloadBtn');
if (isTouch){
  joyZone.addEventListener('touchstart', e=>{
    e.preventDefault();
    const t = e.changedTouches[0];
    touchState.moveId = t.identifier;
    touchState.ox = t.clientX; touchState.oy = t.clientY;
  }, {passive:false});
  window.addEventListener('touchmove', e=>{
    for (const t of e.changedTouches){
      if (t.identifier === touchState.moveId){
        const dx = t.clientX-touchState.ox, dy = t.clientY-touchState.oy;
        const len = Math.hypot(dx,dy), max = 46;
        const k = len>max ? max/len : 1;
        touchState.mx = dx*k/max; touchState.my = dy*k/max;
        joyKnob.style.transform = `translate(${dx*k}px,${dy*k}px)`;
      } else if (t.identifier === touchState.lookId){
        player.yaw -= (t.clientX-touchState.lx)*0.005;
        player.pitch = clamp(player.pitch-(t.clientY-touchState.ly)*0.005, -1.45, 1.45);
        touchState.lx = t.clientX; touchState.ly = t.clientY;
      }
    }
  }, {passive:false});
  window.addEventListener('touchend', e=>{
    for (const t of e.changedTouches){
      if (t.identifier === touchState.moveId){
        touchState.moveId = null; touchState.mx = touchState.my = 0;
        joyKnob.style.transform = '';
      }
      if (t.identifier === touchState.lookId) touchState.lookId = null;
    }
  });
  canvas.addEventListener('touchstart', e=>{
    if (game.status!=='playing') return;
    const t = e.changedTouches[0];
    if (touchState.lookId===null){
      touchState.lookId = t.identifier;
      touchState.lx = t.clientX; touchState.ly = t.clientY;
    }
  }, {passive:true});
  fireBtn.addEventListener('touchstart', e=>{ e.preventDefault(); player.firing = true; }, {passive:false});
  fireBtn.addEventListener('touchend', ()=>{ player.firing = false; });
  reloadBtn.addEventListener('touchstart', e=>{ e.preventDefault(); startReload(); }, {passive:false});
}

// ---------- Streľba hráča ----------
const raycaster = new THREE.Raycaster();
const shootTargets = [groundMesh, pineTrunkMesh, leafTrunkMesh, pineCrownMesh, leafCrownMesh, rockMesh];
function startReload(){
  if (player.reloading>0 || player.ammo===player.magSize) return;
  player.reloading = 1.7;
  sfxReload(0);
  HUD.reloadNote.style.display = 'block';
}
function playerShoot(){
  if (player.reloading>0) return;
  if (player.ammo<=0){ sfxClick(); startReload(); return; }
  player.ammo--;
  player.fireCooldown = 0.115;
  player.recoil = Math.min(player.recoil+0.05, 0.14);
  // Zdvih hlavne sa po dávke sám vráti späť (viď updatePlayer) — bez toho by dlhšia
  // dávka natrvalo odklonila mierenie nad cieľ.
  const kick = 0.005;
  player.pitch = clamp(player.pitch + kick, -1.45, 1.45);
  player.recoilPitch += kick;
  player.yaw += rand(-0.003, 0.003);
  sfxPlayerShot();
  muzzleSprite.material.opacity = 1;
  muzzleSprite.material.rotation = rand(0, Math.PI*2);
  playerFlashLight.intensity = 2.2;
  playerFlashLight.position.set(0.26, -0.2, -1.0);
  // rozptyl podľa pohybu
  const moving = playerSpeedNow > 0.5;
  const spread = (moving ? 0.02 : 0.006) + (keys.ShiftLeft||keys.ShiftRight ? 0.015 : 0);
  const dir = new THREE.Vector3(rand(-spread,spread), rand(-spread,spread), -1).normalize();
  raycaster.set(camera.getWorldPosition(new THREE.Vector3()), dir.applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())));
  raycaster.far = 220;
  const liveEnemyMeshes = enemyHitMeshes.filter(m=>!m.userData.enemy.dead);
  const hits = raycaster.intersectObjects(shootTargets.concat(liveEnemyMeshes), false);
  if (hits.length){
    const h = hits[0];
    const en = h.object.userData.enemy;
    if (en && !en.dead){
      const headshot = !!h.object.userData.head;
      en.hp -= headshot ? 2 : 1;
      spawnFx(h.point, bloodTexture, 0.35, 0.5, 0.35);
      alertNear(en, 40);
      if (en.hp <= 0) killEnemy(en);
      else { en.state = 'combat'; }
    } else {
      spawnFx(h.point, puffTexture, 0.3, 0.6, 0.4);
      sfxImpact();
    }
  }
  updateHUDAmmo();
}
function killEnemy(en){
  en.dead = true;
  en.deathT = 0;
  en.fallDir = rand(0,Math.PI*2);
  game.kills++;
  HUD.kills.textContent = game.kills;
  sfxEnemyDown();
}
function alertNear(src, radius){
  for (const e of enemies){
    if (e.dead || e.state!=='idle') continue;
    if (Math.hypot(e.group.position.x-src.group.position.x, e.group.position.z-src.group.position.z) < radius){
      e.state = 'combat';
      e.alertDelay = rand(0.3, 1.2);
    }
  }
}

// ---------- Poškodenie hráča ----------
function damagePlayer(){
  if (game.invuln > 0) return;
  game.invuln = 1.5;   // jedna dávka nikdy nezoberie viac než jeden zásah
  game.hits++;
  game.shakeT = 0.4;
  sfxPlayerHit();
  HUD.damageFlash.style.opacity = '0.75';
  setTimeout(()=>{ HUD.damageFlash.style.opacity = '0'; }, 120);
  updateHUDHits();
  if (game.hits > MAX_HITS) endGame('over');
}
function updateHUDHits(){
  HUD.hits.forEach((pip,i)=>{
    pip.classList.toggle('lost', i < game.hits);
  });
  HUD.vignette.style.opacity = game.hits>=MAX_HITS ? '0.55' : (game.hits*0.12).toFixed(2);
  document.getElementById('critNote').style.display = game.hits>=MAX_HITS ? 'block' : 'none';
}
function updateHUDAmmo(){
  HUD.ammo.textContent = player.ammo;
}

// ---------- Streľba nepriateľov ----------
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
let playerSpeedNow = 0;
function enemyFire(en){
  const muzzlePos = en.group.userData.muzzle.getWorldPosition(_v1.clone());
  const playerEye = _v2.set(player.x, terrainH(player.x,player.z)+1.6, player.z);
  const dist = muzzlePos.distanceTo(playerEye);
  sfxEnemyShot(dist);
  // záblesk
  spawnFx(muzzlePos, muzzleTexture, 0.5, 0.2, 0.07, true);
  if (dist < 45){
    enemyFlashLight.position.copy(muzzlePos);
    enemyFlashLight.intensity = 1.6;
    enemyFlashT = 0.05;
  }
  en.group.userData.aim.position.z = -0.05; // spätný ráz
  // Pravdepodobnosť zásahu. Držíme ju nízko zámerne: hráč má len 3 životy na 400 metrov,
  // takže jedna dávka nesmie byť takmer istý zásah ani na blízko.
  const sprinting = keys.ShiftLeft||keys.ShiftRight;
  let p = 0.11 * clamp(18/dist, 0.3, 1.4);
  if (playerSpeedNow > 0.5) p *= 0.7;
  if (sprinting) p *= 0.7;
  // Prvý výstrel z dávky ide vždy vedľa — hráč dostane okamih na to, aby sa skryl.
  if (en.firstShot){ en.firstShot = false; p = 0; }
  p = clamp(p, 0.015, 0.16);
  const blocked = losBlocked(muzzlePos, playerEye);
  if (blocked){
    spawnTracer(muzzlePos, blocked);
    spawnFx(blocked, puffTexture, 0.3, 0.5, 0.35);
    return;
  }
  if (Math.random() < p){
    spawnTracer(muzzlePos, playerEye);
    damagePlayer();
  } else {
    // tesne vedľa — stopa preletí okolo hráča
    const side = _v3.crossVectors(playerEye.clone().sub(muzzlePos).normalize(), new THREE.Vector3(0,1,0));
    const missPt = playerEye.clone()
      .addScaledVector(side, rand(0.5,1.8)*(Math.random()<0.5?-1:1))
      .add(new THREE.Vector3(0, rand(-0.6,0.9), 0));
    const past = missPt.sub(muzzlePos).normalize().multiplyScalar(dist+rand(3,10)).add(muzzlePos);
    spawnTracer(muzzlePos, past);
    if (dist < 30) sfxWhizz();
  }
}

// ---------- AI nepriateľov ----------
function updateEnemies(dt){
  const px = player.x, pz = player.z;
  const playerPos = _v1.set(px, terrainH(px,pz)+1.6, pz);
  for (const en of enemies){
    const g = en.group;
    if (en.dead){
      if (en.deathT < 0.7){
        en.deathT += dt;
        const t = smooth(en.deathT/0.7);
        g.rotation.x = -t * Math.PI/2 * Math.cos(en.fallDir);
        g.rotation.z = t * Math.PI/2 * Math.sin(en.fallDir);
      }
      continue;
    }
    const dx = px - g.position.x, dz = pz - g.position.z;
    const dist = Math.hypot(dx, dz);
    if (en.state === 'idle'){
      if (dist < 52){
        const eyePos = _v2.set(g.position.x, g.position.y+1.7, g.position.z);
        if (dist < 22 || !losBlocked(eyePos, playerPos)){
          en.state = 'combat';
          en.alertDelay = rand(0.25, 0.9);
        }
      }
      continue;
    }
    // combat
    if (en.alertDelay > 0){ en.alertDelay -= dt; continue; }
    const yawTo = Math.atan2(dx, dz);
    let dy = yawTo - g.rotation.y;
    while (dy > Math.PI) dy -= Math.PI*2;
    while (dy < -Math.PI) dy += Math.PI*2;
    g.rotation.y += clamp(dy, -3.2*dt, 3.2*dt);
    // mierenie výškovo
    const eyeY = g.position.y + 1.5;
    en.group.userData.aim.rotation.x = clamp(-Math.atan2(playerPos.y - eyeY, dist), -0.5, 0.5);
    en.group.userData.aim.position.z = lerp(en.group.userData.aim.position.z, 0, dt*10);
    en.group.userData.head.rotation.y = clamp(dy, -0.5, 0.5)*0.4;

    const eyePos = _v2.set(g.position.x, eyeY+0.2, g.position.z);
    const clearLOS = !losBlocked(eyePos, playerPos);
    let moveX = 0, moveZ = 0;
    const fwdX = Math.sin(g.rotation.y), fwdZ = Math.cos(g.rotation.y);
    if (dist > en.prefRange + 4 || !clearLOS){
      moveX += fwdX; moveZ += fwdZ;                    // približuj sa / hľadaj výhľad
      en.strafeT -= dt;
      if (en.strafeT <= 0){ en.strafeDir *= -1; en.strafeT = rand(0.8, 2.2); }
      if (!clearLOS){ moveX += -fwdZ*en.strafeDir*0.8; moveZ += fwdX*en.strafeDir*0.8; }
    } else if (dist < 7){
      moveX -= fwdX; moveZ -= fwdZ;                    // priveľmi blízko, ustúp
    } else {
      en.strafeT -= dt;
      if (en.strafeT <= 0){ en.strafeDir *= -1; en.strafeT = rand(1.2, 3.0); }
      moveX += -fwdZ*en.strafeDir*0.35; moveZ += fwdX*en.strafeDir*0.35;
    }
    const mlen = Math.hypot(moveX, moveZ);
    if (mlen > 0.01){
      const speed = 2.6;
      let nx = g.position.x + moveX/mlen*speed*dt;
      let nz = g.position.z + moveZ/mlen*speed*dt;
      // vyhýbanie kmeňom
      forEachTrunkNear(nx, nz, 1.6, t=>{
        const d = Math.hypot(nx-t.x, nz-t.z);
        const min = t.r + 0.5;
        if (d < min && d > 0.001){
          nx = t.x + (nx-t.x)/d*min;
          nz = t.z + (nz-t.z)/d*min;
        }
      });
      nz = clamp(nz, WORLD.minZ, WORLD.maxZ);
      const ehw = corridorHalfWidth(nz);
      nx = clamp(nx, -ehw, ehw);
      g.position.x = nx; g.position.z = nz;
      g.position.y = terrainH(nx, nz);
      en.walkPhase += dt*7;
      g.userData.legL.rotation.x = Math.sin(en.walkPhase)*0.55;
      g.userData.legR.rotation.x = -Math.sin(en.walkPhase)*0.55;
    } else {
      g.userData.legL.rotation.x = lerp(g.userData.legL.rotation.x, 0, dt*8);
      g.userData.legR.rotation.x = lerp(g.userData.legR.rotation.x, 0, dt*8);
    }
    // streľba v dávkach
    if (clearLOS && dist < 65 && Math.abs(dy) < 0.35){
      if (en.burstLeft > 0){
        en.shotTimer -= dt;
        if (en.shotTimer <= 0){
          enemyFire(en);
          en.burstLeft--;
          en.shotTimer = 0.13;
        }
      } else {
        en.cooldown -= dt;
        if (en.cooldown <= 0){
          en.burstLeft = 3 + (Math.random()*3|0);
          en.firstShot = true;
          en.cooldown = rand(2.4, 4.2) + dist*0.02;
        }
      }
    }
  }
}

// ---------- Pohyb hráča ----------
function updatePlayer(dt){
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz += 1;
  if (keys.KeyS || keys.ArrowDown) iz -= 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (isTouch){ ix += touchState.mx; iz -= touchState.my; }
  const ilen = Math.hypot(ix, iz);
  const sprint = (keys.ShiftLeft || keys.ShiftRight) && iz > 0;
  const speed = sprint ? 7.2 : 4.6;
  playerSpeedNow = 0;
  if (ilen > 0.01){
    ix /= Math.max(ilen,1); iz /= Math.max(ilen,1);
    // smer podľa yaw (yaw=PI → dopredu = +Z)
    const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
    const wx = (-s)*iz + (-c)*ix;
    const wz = (-c)*iz + (s)*ix;
    let nx = player.x + wx*speed*dt;
    let nz = player.z + wz*speed*dt;
    forEachTrunkNear(nx, nz, 1.6, t=>{
      const d = Math.hypot(nx-t.x, nz-t.z);
      const min = t.r + 0.45;
      if (d < min && d > 0.001){
        nx = t.x + (nx-t.x)/d*min;
        nz = t.z + (nz-t.z)/d*min;
      }
    });
    nz = clamp(nz, WORLD.minZ, WORLD.maxZ);
    const hw = corridorHalfWidth(nz);
    nx = clamp(nx, -hw, hw);
    playerSpeedNow = Math.hypot(nx-player.x, nz-player.z)/Math.max(dt,0.0001);
    player.x = nx; player.z = nz;
    player.bobPhase += dt * (sprint ? 13 : 9);
    player.stepAcc += playerSpeedNow*dt;
    if (player.stepAcc > (sprint?2.4:2.0)){ player.stepAcc = 0; sfxStep(); }
  }
  // Doznievanie spätného rázu: hlaveň klesá späť k pôvodnému bodu mierenia.
  if (player.recoilPitch > 0){
    const back = Math.min(player.recoilPitch, 1.6*dt);
    player.pitch -= back;
    player.recoilPitch -= back;
  }
  // kamera
  const groundY = terrainH(player.x, player.z);
  const bob = Math.sin(player.bobPhase)* (playerSpeedNow>0.5 ? 0.05 : 0);
  camera.position.set(player.x, groundY + 1.68 + bob, player.z);
  camera.rotation.order = 'YXZ';
  let shakeX = 0, shakeY = 0;
  if (game.shakeT > 0){
    game.shakeT -= dt;
    shakeX = rand(-1,1)*0.02*game.shakeT/0.4;
    shakeY = rand(-1,1)*0.02*game.shakeT/0.4;
  }
  camera.rotation.set(player.pitch + shakeY, player.yaw + shakeX, 0);
  // FOV pri šprinte
  const targetFov = sprint && playerSpeedNow>1 ? 82 : 75;
  camera.fov = lerp(camera.fov, targetFov, dt*6);
  camera.updateProjectionMatrix();
  // zbraň: hojdanie + spätný ráz
  player.recoil = lerp(player.recoil, 0, dt*9);
  const wBobX = Math.sin(player.bobPhase)*0.008*(playerSpeedNow>0.5?1:0);
  const wBobY = Math.abs(Math.cos(player.bobPhase))*0.008*(playerSpeedNow>0.5?1:0);
  weapon.position.set(0.26 + wBobX, -0.24 - wBobY - (player.reloading>0?0.12:0), -0.55 + player.recoil);
  weapon.rotation.x = player.recoil*0.7 + (player.reloading>0?0.35:0);
  muzzleSprite.material.opacity = Math.max(0, muzzleSprite.material.opacity - dt*18);
  playerFlashLight.intensity = Math.max(0, playerFlashLight.intensity - dt*30);
  // streľba
  player.fireCooldown -= dt;
  if (player.firing && player.fireCooldown <= 0 && game.status==='playing') playerShoot();
  // nabíjanie
  if (player.reloading > 0){
    player.reloading -= dt;
    if (player.reloading <= 0.8 && player.reloading+dt > 0.8) sfxReload(1);
    if (player.reloading <= 0){
      player.ammo = player.magSize;
      HUD.reloadNote.style.display = 'none';
      updateHUDAmmo();
    }
  }
  if (game.invuln > 0) game.invuln -= dt;
}

// ---------- Slnko a dym ----------
function updateEnvironment(dt){
  sun.position.set(player.x + SUN_DIR.x*90, SUN_DIR.y*90, player.z + SUN_DIR.z*90);
  sun.target.position.set(player.x, 0, player.z);
  skyDome.position.set(player.x, 0, player.z);
  for (const s of smokePuffs){
    s.t += dt*0.12;
    if (s.t > 1) s.t -= 1;
    const hY = terrainH(0,HOUSE_Z);
    s.sp.position.set(2.6 + Math.sin(s.t*9)*0.4 + s.t*1.5, hY + 5.7 + s.t*5, HOUSE_Z + 0.6);
    const sc = 0.6 + s.t*2.2;
    s.sp.scale.set(sc, sc, 1);
    s.sp.material.opacity = 0.4*(1 - s.t)*(s.t>0.05?1:s.t/0.05);
  }
  if (enemyFlashT > 0){
    enemyFlashT -= dt;
    if (enemyFlashT <= 0) enemyFlashLight.intensity = 0;
  }
}

// ---------- Životný cyklus hry ----------
function resetGame(){
  // odstráň starých nepriateľov
  for (const en of enemies) scene.remove(en.group);
  enemies.length = 0;
  enemyHitMeshes.length = 0;
  spawnEnemies();
  game.status = 'playing';
  game.elapsed = 0; game.score = 0; game.kills = 0; game.hits = 0;
  game.invuln = 0; game.shakeT = 0;
  player.x = 0; player.z = 4; player.yaw = Math.PI; player.pitch = 0;
  player.ammo = player.magSize; player.reloading = 0; player.firing = false;
  player.recoil = 0; player.recoilPitch = 0;
  HUD.kills.textContent = '0';
  HUD.score.textContent = '0';
  HUD.reloadNote.style.display = 'none';
  HUD.houseNote.style.display = 'none';
  updateHUDAmmo();
  updateHUDHits();
  showScreen(null);
}
function startGame(){
  initAudio();
  if (actx && actx.state==='suspended') actx.resume();
  resetGame();
  if (!isTouch && !NOLOCK) lockPointer();
}
function pauseGame(){
  if (game.status!=='playing') return;
  game.status = 'paused';
  showScreen('pause');
}
function resumeGame(){
  game.status = 'playing';
  showScreen(null);
  if (!isTouch && !NOLOCK) lockPointer();
}
function endGame(result){
  game.status = result; // 'over' | 'win'
  player.firing = false;
  HUD.houseNote.style.display = 'none';
  HUD.reloadNote.style.display = 'none';
  if (result==='win'){
    game.score += 500;
    document.getElementById('winScore').textContent = game.score;
    document.getElementById('winKills').textContent = game.kills;
    showScreen('win');
  } else {
    document.getElementById('goScore').textContent = game.score;
    document.getElementById('goKills').textContent = game.kills;
    showScreen('over');
  }
  if (document.pointerLockElement) document.exitPointerLock();
}
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('retryBtn1').addEventListener('click', startGame);
document.getElementById('retryBtn2').addEventListener('click', startGame);
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
window.addEventListener('keydown', e=>{
  if (e.code==='Enter'){
    if (!screens.start.classList.contains('hidden') ||
        !screens.over.classList.contains('hidden') ||
        !screens.win.classList.contains('hidden')) startGame();
    else if (!screens.pause.classList.contains('hidden')) resumeGame();
  }
  if (e.code==='Escape' && game.status==='playing' && (isTouch||NOLOCK)) pauseGame();
});

// ---------- Hlavná slučka ----------
let lastT = performance.now();
let scoreAcc = 0;
function tickGame(dt){
  updatePlayer(dt);
  updateEnemies(dt);
  game.elapsed += dt;
  scoreAcc += dt;
  while (scoreAcc >= 1){ scoreAcc -= 1; game.score += 10; HUD.score.textContent = game.score; }
  HUD.progress.style.width = clamp(player.z/HOUSE_Z*100, 0, 100) + '%';
  const toHouse = Math.hypot(player.x, player.z - HOUSE_Z);
  HUD.houseNote.style.display = (toHouse < 30 && toHouse >= WIN_RADIUS) ? 'block' : 'none';
  if (toHouse < WIN_RADIUS) endGame('win');
}
function loop(t){
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t-lastT)/1000);
  lastT = t;
  if (game.status === 'playing') tickGame(dt);
  updateFx(dt);
  updateTracers(dt);
  updateEnvironment(dt);
  renderer.render(scene, camera);
}
updateHUDHits();
updateHUDAmmo();

// Ladiaci prístup pre automatizované testy (?debug v URL) — v bežnej hre sa nevystavuje.
if (/[?&]debug/.test(location.search)){
  window.__forest = {game, player, enemies, scene, camera, HOUSE_Z, terrainH, losBlocked,
    trunks(){ const out=[]; for (const arr of trunkGrid.values()) out.push(...arr); return out; },
    teleport(x,z,yaw){ player.x=x; player.z=z; if(yaw!==undefined) player.yaw=yaw; },
    // Posunie hernú logiku o zadaný počet sekúnd bez čakania na vykresľovanie.
    // Svetové matice inak aktualizuje render — bez neho by raycast strieľal na staré pozície.
    step(seconds, dt){
      dt = dt || 1/60;
      for (let t=0; t<seconds && game.status==='playing'; t+=dt){
        scene.updateMatrixWorld(true);
        tickGame(dt);
      }
    }};
}

requestAnimationFrame(loop);
})();
