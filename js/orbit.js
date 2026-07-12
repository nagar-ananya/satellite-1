/**
 * Circular LEO orbit propagator (two-body, no perturbations).
 * Altitude in km, inclination in degrees.
 * Returns ECI position [x, y, z] in meters.
 */

const MU = 3.986004418e14;   // Earth GM, m³/s²
const RE = 6371000;          // Earth radius, m

export class CircularOrbit {
  constructor({ altitudeKm = 550, inclinationDeg = 45, raanDeg = 0 } = {}) {
    this.r = RE + altitudeKm * 1000;
    const inc  = inclinationDeg * Math.PI / 180;
    const raan = raanDeg        * Math.PI / 180;

    this.period = 2 * Math.PI * Math.sqrt(this.r ** 3 / MU); // seconds
    this.n      = 2 * Math.PI / this.period;                 // mean motion, rad/s

    // Rotation matrix: perifocal → ECI (for circular orbit, arg of perigee = 0)
    const cosR = Math.cos(raan), sinR = Math.sin(raan);
    const cosI = Math.cos(inc),  sinI = Math.sin(inc);
    // Row-major 3×3
    this.rot = [
      [ cosR, -sinR * cosI,  sinR * sinI],
      [ sinR,  cosR * cosI, -cosR * sinI],
      [ 0,     sinI,         cosI       ]
    ];

    this.t0 = Date.now() / 1000;
  }

  /** ECI position at elapsed time t (seconds from epoch). */
  positionEci(t) {
    const theta = this.n * t;
    const xP = this.r * Math.cos(theta);
    const yP = this.r * Math.sin(theta);
    return this._rotate([xP, yP, 0]);
  }

  /** ECI velocity at t (m/s). */
  velocityEci(t) {
    const v = Math.sqrt(MU / this.r);
    const theta = this.n * t;
    const vxP = -v * Math.sin(theta);
    const vyP =  v * Math.cos(theta);
    return this._rotate([vxP, vyP, 0]);
  }

  _rotate(v) {
    return this.rot.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  }

  periodSeconds() { return this.period; }
}

const EARTH_ROT = 7.2921150e-5; // rad/s (sidereal)

/** Rotate an ECI position vector to ECEF for a given elapsed time (seconds). */
export function eciToEcef(eciPos, elapsedSec) {
  const theta = EARTH_ROT * elapsedSec;
  const c = Math.cos(theta), s = Math.sin(theta);
  return [
     c * eciPos[0] + s * eciPos[1],
    -s * eciPos[0] + c * eciPos[1],
    eciPos[2],
  ];
}

/**
 * Returns the ECI→ECEF rotation as a Cesium Quaternion.
 * Rz(−θ) in (x, y, z, w) form.
 */
export function eciToEcefQuaternion(elapsedSec) {
  const half = EARTH_ROT * elapsedSec / 2;
  return { x: 0, y: 0, z: -Math.sin(half), w: Math.cos(half) };
}

/** Approximate Sun direction in ECI (unit vector). */
export function sunDirectionEci(julianDay) {
  const D  = julianDay - 2451545.0;
  const g  = (357.529 + 0.98560028 * D) * Math.PI / 180;
  const L  = (280.459 + 0.98564736 * D) * Math.PI / 180;
  const lam = L + 1.915 * Math.PI / 180 * Math.sin(g) + 0.020 * Math.PI / 180 * Math.sin(2 * g);
  const eps = 23.439 * Math.PI / 180;
  const x = Math.cos(lam);
  const y = Math.cos(eps) * Math.sin(lam);
  const z = Math.sin(eps) * Math.sin(lam);
  const mag = Math.hypot(x, y, z);
  return [x / mag, y / mag, z / mag];
}
