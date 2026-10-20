import * as THREE from 'three'

export function frameScene3DBounds(bounds: THREE.Box3, direction: THREE.Vector3, verticalFov: number, aspect: number) {
  if (bounds.isEmpty()) return null
  const sphere = bounds.getBoundingSphere(new THREE.Sphere())
  const halfVertical = THREE.MathUtils.degToRad(verticalFov) / 2
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect)
  const distance = Math.max(sphere.radius, .25) * 1.15 / Math.sin(Math.min(halfVertical, halfHorizontal))
  const offset = direction.lengthSq() > 1e-6 ? direction.clone().normalize() : new THREE.Vector3(1, .6, 1).normalize()
  return { position: sphere.center.clone().add(offset.multiplyScalar(distance)), target: sphere.center }
}

export function moveScene3DCamera(camera: THREE.Camera, target: THREE.Vector3, keys: ReadonlySet<string>, seconds: number, speed: number) {
  const forward = camera.getWorldDirection(new THREE.Vector3())
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
  const offset = forward.multiplyScalar(Number(keys.has('KeyW')) - Number(keys.has('KeyS')))
    .addScaledVector(right, Number(keys.has('KeyD')) - Number(keys.has('KeyA')))
    .addScaledVector(camera.up, Number(keys.has('KeyE')) - Number(keys.has('KeyQ')))
  if (!offset.lengthSq()) return
  const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1
  offset.normalize().multiplyScalar(speed * boost * seconds)
  // 同步移动观察中心，越过旧中心时也能继续前进。
  camera.position.add(offset); target.add(offset)
}

export function lookScene3DCamera(camera: THREE.Camera, target: THREE.Vector3, dx: number, dy: number) {
  const distance = Math.max(camera.position.distanceTo(target), .1)
  const angles = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
  angles.y -= dx * .003
  angles.x = THREE.MathUtils.clamp(angles.x - dy * .003, -Math.PI / 2 + .01, Math.PI / 2 - .01)
  camera.quaternion.setFromEuler(angles)
  target.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(distance))
}
