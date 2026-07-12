import { AttitudeState, pdControl, nadirTargetEuler, sunTargetEuler } from './attitude.js';
import { CircularOrbit, sunDirectionEci, eciToEcef, eciToEcefQuaternion } from './orbit.js';

const viewer = new Cesium.Viewer('cesiumContainer', {
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  skyAtmosphere: new Cesium.SkyAtmosphere(),
});

viewer.clock.shouldAnimate = true;

// Replace default Ion imagery with ArcGIS (no token needed)
viewer.imageryLayers.removeAll();
viewer.imageryLayers.addImageryProvider(
  new Cesium.UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credit: 'Esri World Imagery',
  })
);

viewer.scene.globe.enableLighting = true;

// ── Orbital elements ──────────────────────────────────────────────────────────
const orbit = new CircularOrbit({ altitudeKm: 550, inclinationDeg: 51.6, raanDeg: 30 });
const attitude = new AttitudeState();

let mode      = 'sun';
let showTrack = true;
let showAxes  = true;
let elapsed   = 0;
let following = false;

// Chase-cam: heading 0, pitched 30° down. Range is adjustable via mouse wheel
// while following (see wheel handler below) so you can zoom in on the satellite.
let followRange = 800_000; // meters from satellite (start fairly close)
const FOLLOW_MIN_RANGE = 50_000;
const FOLLOW_MAX_RANGE = 8_000_000;

// ── Helper: body→ECEF quaternion ─────────────────────────────────────────────
function bodyToEcefQuat() {
  // attitude.q = [w,x,y,z] body→ECI
  const [aw, ax, ay, az] = attitude.q;
  const q_body_eci  = new Cesium.Quaternion(ax, ay, az, aw); // Cesium: (x,y,z,w)
  const { x, y, z, w } = eciToEcefQuaternion(elapsed);
  const q_eci_ecef  = new Cesium.Quaternion(x, y, z, w);
  // body→ECEF = ECI→ECEF ⊗ body→ECI
  return Cesium.Quaternion.multiply(q_eci_ecef, q_body_eci, new Cesium.Quaternion());
}

// ── Satellite entity ──────────────────────────────────────────────────────────
const satEntity = viewer.entities.add({
  name: 'SAT-1',
  position: new Cesium.CallbackProperty(() => {
    const ecef = eciToEcef(orbit.positionEci(elapsed), elapsed);
    return new Cesium.Cartesian3(ecef[0], ecef[1], ecef[2]);
  }, false),
  orientation: new Cesium.CallbackProperty(() => bodyToEcefQuat(), false),
  // Central body / bus (gold multi-layer insulation look)
  box: {
    dimensions: new Cesium.Cartesian3(16000, 10000, 10000),
    material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#d9a441')),
    outline: true,
    outlineColor: Cesium.Color.fromCssColorString('#5a3d10'),
  },
  // Always-visible point — useful when zoomed out to the full Earth
  point: {
    pixelSize: 10,
    color: Cesium.Color.fromCssColorString('#88ddff'),
    outlineColor: Cesium.Color.WHITE,
    outlineWidth: 1,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  },
  label: {
    text: 'SAT-1',
    font: '12px Courier New',
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 2,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new Cesium.Cartesian2(14, 0),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5_000_000),
  },
});

// ── Satellite sub-parts (solar panels, antenna) ───────────────────────────────
// Each part is a separate entity rigidly attached to the body: it shares the
// satellite's attitude and sits at a fixed offset expressed in body coordinates.
function bodyOffsetPosition(offsetBody) {
  const ecef   = eciToEcef(orbit.positionEci(elapsed), elapsed);
  const satPos = new Cesium.Cartesian3(ecef[0], ecef[1], ecef[2]);
  const rot    = Cesium.Matrix3.fromQuaternion(bodyToEcefQuat());
  const off    = Cesium.Matrix3.multiplyByVector(rot, offsetBody, new Cesium.Cartesian3());
  return Cesium.Cartesian3.add(satPos, off, new Cesium.Cartesian3());
}

function makeBodyPart(offsetBody, graphics) {
  return viewer.entities.add({
    position: new Cesium.CallbackProperty(() => bodyOffsetPosition(offsetBody), false),
    orientation: new Cesium.CallbackProperty(() => bodyToEcefQuat(), false),
    ...graphics,
  });
}

// Two solar arrays extending along the body ±Y axis
const PANEL_DIMS = new Cesium.Cartesian3(11000, 34000, 500);
const panelMaterial = new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#1c3a8c'));
function solarPanel(signY) {
  return makeBodyPart(new Cesium.Cartesian3(0, signY * 23000, 0), {
    box: {
      dimensions: PANEL_DIMS,
      material: panelMaterial,
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString('#8fb4ff'),
    },
  });
}
solarPanel(+1);
solarPanel(-1);

// Communications dish on the +Z face (cylinder axis is body Z)
makeBodyPart(new Cesium.Cartesian3(0, 0, 9000), {
  cylinder: {
    length: 6000,
    topRadius: 5000,
    bottomRadius: 800,
    material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#e8e8e8')),
    outline: true,
    outlineColor: Cesium.Color.fromCssColorString('#888888'),
  },
});

// ── Body-frame axis arrows ────────────────────────────────────────────────────
const AXIS_LEN = 80000; // meters

function makeAxis(colorHex) {
  return viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(
        () => [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
        false
      ),
      width: 2.5,
      material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(colorHex)),
      arcType: Cesium.ArcType.NONE,
    },
  });
}

const axisX = makeAxis('#ff4444'); // X – red
const axisY = makeAxis('#44ff44'); // Y – green
const axisZ = makeAxis('#4488ff'); // Z – blue

function updateAxes(posEcef) {
  const q   = bodyToEcefQuat();
  const mat = Cesium.Matrix3.fromQuaternion(q);

  const cx = new Cesium.Cartesian3(posEcef[0], posEcef[1], posEcef[2]);
  const cols = [0, 1, 2].map(i => {
    const col = Cesium.Matrix3.getColumn(mat, i, new Cesium.Cartesian3());
    Cesium.Cartesian3.multiplyByScalar(col, AXIS_LEN, col);
    return Cesium.Cartesian3.add(cx, col, new Cesium.Cartesian3());
  });

  axisX.polyline.positions = new Cesium.ConstantProperty([cx, cols[0]]);
  axisY.polyline.positions = new Cesium.ConstantProperty([cx, cols[1]]);
  axisZ.polyline.positions = new Cesium.ConstantProperty([cx, cols[2]]);

  [axisX, axisY, axisZ].forEach(a => { a.show = showAxes; });
}

// ── Ground track ──────────────────────────────────────────────────────────────
const TRACK_MAX = 600;
const trackPositions = [];

const groundTrackLine = viewer.entities.add({
  polyline: {
    positions: new Cesium.CallbackProperty(() => trackPositions.slice(), false),
    width: 1.5,
    material: new Cesium.PolylineDashMaterialProperty({
      color: Cesium.Color.fromCssColorString('#2288ff').withAlpha(0.7),
      dashLength: 12,
    }),
    clampToGround: true,
  },
});

// ── Attitude control ──────────────────────────────────────────────────────────
const JD_J2000    = 2451545.0;
const secondsPerDay = 86400;

function computeTorque(posEci) {
  const euler  = attitude.eulerDeg();
  let   target = [0, 0, 0];

  if (mode === 'nadir') {
    target = nadirTargetEuler(posEci);
  } else if (mode === 'sun') {
    const jd = JD_J2000 + elapsed / secondsPerDay;
    target   = sunTargetEuler(sunDirectionEci(jd));
  } else if (mode === 'inertial') {
    target = [0, 0, 0];
  }

  if (mode !== 'manual') {
    const error = target.map((t, i) => {
      let e = t - euler[i];
      while (e >  180) e -= 360;
      while (e < -180) e += 360;
      return e;
    });
    attitude.torque = pdControl(error, attitude.omega);
  }
}

// ── Main tick ─────────────────────────────────────────────────────────────────
let REAL_TIME_FACTOR = 60;
let lastWall = performance.now();

viewer.clock.onTick.addEventListener(() => {
  const now    = performance.now();
  const wallDt = (now - lastWall) / 1000;
  lastWall     = now;

  const simDt = Math.min(wallDt, 0.1) * REAL_TIME_FACTOR; // cap to avoid spiral if tab was hidden
  elapsed += simDt;

  const posEci  = orbit.positionEci(elapsed);
  const posEcef = eciToEcef(posEci, elapsed);

  computeTorque(posEci);
  attitude.step(simDt);

  // Ground track — use ECEF position
  const cartEcef = new Cesium.Cartesian3(posEcef[0], posEcef[1], posEcef[2]);
  const carto    = Cesium.Cartographic.fromCartesian(cartEcef);
  if (carto) {
    const surface = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude);
    trackPositions.push(surface);
    if (trackPositions.length > TRACK_MAX) trackPositions.shift();
  }
  groundTrackLine.show = showTrack && trackPositions.length > 1;

  updateAxes(posEcef);
  updateHUD(posEci);

  // Chase-cam: re-center on the satellite every frame while following
  if (following) {
    const satPos = new Cesium.Cartesian3(posEcef[0], posEcef[1], posEcef[2]);
    viewer.camera.lookAt(
      satPos,
      new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), followRange)
    );
  }
});

// ── HUD ───────────────────────────────────────────────────────────────────────
function fmt(n, d = 2) { return n.toFixed(d); }

function updateHUD(posEci) {
  const [roll, pitch, yaw] = attitude.eulerDeg();
  const [wx, wy, wz]       = attitude.omega;
  const altKm = (Math.hypot(...posEci) - 6371000) / 1000;

  document.getElementById('hud-mode').textContent  = modeLabel(mode);
  document.getElementById('hud-roll').textContent  = fmt(roll)  + '°';
  document.getElementById('hud-pitch').textContent = fmt(pitch) + '°';
  document.getElementById('hud-yaw').textContent   = fmt(yaw)   + '°';
  document.getElementById('hud-wx').textContent    = fmt(wx, 3) + ' °/s';
  document.getElementById('hud-wy').textContent    = fmt(wy, 3) + ' °/s';
  document.getElementById('hud-wz').textContent    = fmt(wz, 3) + ' °/s';
  document.getElementById('hud-alt').textContent   = fmt(altKm) + ' km';
  document.getElementById('hud-time').textContent  = fmt(elapsed, 0) + ' s';
}

function modeLabel(m) {
  return { sun: 'Sun-Pointing', nadir: 'Nadir-Pointing', inertial: 'Inertial Hold', manual: 'Manual' }[m];
}

// ── UI wiring ────────────────────────────────────────────────────────────────
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('manual-controls').classList.toggle('hidden', mode !== 'manual');
    if (mode === 'manual') attitude.torque = [0, 0, 0];
  });
});

function wireSlider(id, labelId, axis) {
  const input = document.getElementById(id);
  const label = document.getElementById(labelId);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    label.textContent = v;
    if (mode === 'manual') attitude.torque[axis] = v;
  });
}
wireSlider('roll-input',  'roll-val',        0);
wireSlider('pitch-input', 'pitch-val',       1);
wireSlider('yaw-input',   'yaw-input-label', 2);

// Simulation speed slider
const speedInput = document.getElementById('speed-input');
const speedVal   = document.getElementById('speed-val');
if (speedInput) {
  speedInput.addEventListener('input', () => {
    REAL_TIME_FACTOR = parseFloat(speedInput.value);
    speedVal.textContent = REAL_TIME_FACTOR;
  });
}

const btnFollow = document.getElementById('btn-follow');

function setFollowStyle(on) {
  btnFollow.style.background  = on ? 'rgba(26,111,168,0.75)' : '';
  btnFollow.style.color       = on ? '#fff' : '';
  btnFollow.style.borderColor = on ? '#4db8ff' : '';
}

function startFollowing() {
  following = true;
  setFollowStyle(true);
  // The tick handler will lookAt() the satellite every frame, keeping it centered.
  // Use the mouse wheel to zoom in/out (adjusts followRange).
}

function stopFollowing() {
  if (!following) return;
  following = false;
  setFollowStyle(false);
  // Release the lookAt reference frame — without this, the camera stays locked
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}

// While following, the wheel adjusts the chase-cam distance instead of Cesium's
// default zoom (which lookAt would override every frame anyway).
const wheelHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
wheelHandler.setInputAction((delta) => {
  if (!following) return;
  // delta > 0 = scroll up = zoom in
  followRange *= delta > 0 ? 0.9 : 1.1;
  followRange = Cesium.Math.clamp(followRange, FOLLOW_MIN_RANGE, FOLLOW_MAX_RANGE);
}, Cesium.ScreenSpaceEventType.WHEEL);

btnFollow.addEventListener('click', () => {
  if (following) stopFollowing();
  else           startFollowing();
});

document.getElementById('btn-global').addEventListener('click', () => {
  stopFollowing();
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(0, 20, 18_000_000),
    duration: 1.5,
  });
});
document.getElementById('btn-track').addEventListener('click', () => {
  showTrack = !showTrack;
});
document.getElementById('btn-axes').addEventListener('click', () => {
  showAxes = !showAxes;
});

// ── Initial camera ────────────────────────────────────────────────────────────
viewer.camera.flyTo({
  destination: Cesium.Cartesian3.fromDegrees(0, 20, 18_000_000),
  duration: 2,
});
