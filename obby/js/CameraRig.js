// CameraRig.js — third-person follow camera (drag to orbit), camera-relative axes
import * as THREE from 'three';

export class CameraRig {
  constructor(camera, canvas) {
    this.cam = camera;
    this.yaw = 0;            // 0 => looking toward +Z (down the course)
    this.pitch = 0.42;
    this.dist = 8.5;
    this.target = new THREE.Vector3();
    this._initDrag(canvas);
  }

  _initDrag(canvas) {
    let id = null, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', e => { id = e.pointerId; lx = e.clientX; ly = e.clientY; });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      this.yaw -= (e.clientX - lx) * 0.005;
      this.pitch = Math.max(0.08, Math.min(1.1, this.pitch - (e.clientY - ly) * 0.004));
      lx = e.clientX; ly = e.clientY;
    });
    const end = e => { if (e.pointerId === id) id = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  // screen-right for a camera facing +forward (= forward × up); corrects the left/right inversion
  right() { return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  update(dt, focus) {
    this.target.lerp(focus, Math.min(1, dt * 9));   // smooth the point we orbit
    const hd = this.dist * Math.cos(this.pitch);
    const y = this.dist * Math.sin(this.pitch) + 1.3;
    const desired = new THREE.Vector3(
      this.target.x - Math.sin(this.yaw) * hd,
      this.target.y + y,
      this.target.z - Math.cos(this.yaw) * hd
    );
    this.cam.position.lerp(desired, Math.min(1, dt * 8));
    this.cam.lookAt(this.target.x, this.target.y + 1.2, this.target.z);
  }

  snap(focus) {
    this.target.copy(focus);
    const hd = this.dist * Math.cos(this.pitch);
    const y = this.dist * Math.sin(this.pitch) + 1.3;
    this.cam.position.set(focus.x - Math.sin(this.yaw) * hd, focus.y + y, focus.z - Math.cos(this.yaw) * hd);
    this.cam.lookAt(focus.x, focus.y + 1.2, focus.z);
  }
}
