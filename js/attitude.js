/**
 * Attitude dynamics and control modes.
 *
 * State: quaternion q (body-to-ECI) + angular velocity omega (body frame, deg/s).
 * Integration: simple Euler for now — easy to swap to RK4.
 */

const DEG = Math.PI / 180;

export class AttitudeState {
  constructor() {
    // Identity quaternion [w, x, y, z]
    this.q = [1, 0, 0, 0];
    // Angular velocity in body frame, deg/s
    this.omega = [0, 0, 0];
    // Applied torque, deg/s²
    this.torque = [0, 0, 0];
    // Damping coefficient (simulates attitude-control dampers)
    this.damping = 0.15;
  }

  /** Integrate attitude by dt seconds. */
  step(dt) {
    // α = torque − damping·ω
    const alpha = this.torque.map((t, i) => t - this.damping * this.omega[i]);
    this.omega = this.omega.map((w, i) => w + alpha[i] * dt);

    // Quaternion kinematics: dq/dt = 0.5 * q ⊗ [0, ω]
    const [w, x, y, z] = this.q;
    const [wx, wy, wz] = this.omega.map(v => v * DEG);
    const dw = 0.5 * (-x * wx - y * wy - z * wz);
    const dx = 0.5 * ( w * wx + y * wz - z * wy);
    const dy = 0.5 * ( w * wy - x * wz + z * wx);
    const dz = 0.5 * ( w * wz + x * wy - y * wx);

    this.q = [w + dw * dt, x + dx * dt, y + dy * dt, z + dz * dt];
    this._normalise();
  }

  _normalise() {
    const n = Math.hypot(...this.q);
    this.q = this.q.map(v => v / n);
  }

  /** Euler angles (deg) from quaternion, ZYX convention → [roll, pitch, yaw]. */
  eulerDeg() {
    const [qw, qx, qy, qz] = this.q;
    const roll  = Math.atan2(2*(qw*qx + qy*qz), 1 - 2*(qx*qx + qy*qy)) / DEG;
    const pitch = Math.asin( Math.max(-1, Math.min(1, 2*(qw*qy - qz*qx)))) / DEG;
    const yaw   = Math.atan2(2*(qw*qz + qx*qy), 1 - 2*(qy*qy + qz*qz)) / DEG;
    return [roll, pitch, yaw];
  }

  /** Convert stored quaternion to Cesium Quaternion. */
  toCesiumQuaternion(Cesium) {
    const [qw, qx, qy, qz] = this.q;
    return new Cesium.Quaternion(qx, qy, qz, qw);
  }
}

/* ── Controller helpers ── */

/**
 * PD controller: drives error toward zero.
 * Returns torque (deg/s²).
 */
export function pdControl(error, rate, kp = 0.8, kd = 1.2) {
  return error.map((e, i) => kp * e - kd * rate[i]);
}

/**
 * Compute desired attitude for nadir-pointing (satellite Z-axis toward Earth center).
 * Returns target Euler angles [roll, pitch, yaw] in degrees.
 */
export function nadirTargetEuler(posEci) {
  // Nadir = -position unit vector in ECI
  const mag = Math.hypot(...posEci);
  if (mag === 0) return [0, 0, 0];
  const nadir = posEci.map(v => -v / mag);
  // Pitch angle needed to point body-Z at Earth
  const pitch = Math.asin(nadir[2]) / DEG;
  const yaw   = Math.atan2(nadir[1], nadir[0]) / DEG;
  return [0, pitch, yaw];
}

/**
 * Compute desired attitude for sun-pointing (satellite X-axis toward Sun).
 * sunDir: unit vector to sun in ECI.
 */
export function sunTargetEuler(sunDir) {
  const pitch = Math.asin(-sunDir[2]) / DEG;
  const yaw   = Math.atan2(sunDir[1], sunDir[0]) / DEG;
  return [0, pitch, yaw];
}
