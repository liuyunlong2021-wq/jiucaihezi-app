import { Box3, Quaternion, Vector3, type Object3D } from 'three'
import { parseScene3DDocument, type Scene3DDocument } from './scene3d'

/** Align the rendered hip to a horizontal seat cushion; report floor fit separately. */
export function alignRenderedCharacterToSeat(source: Scene3DDocument, root: Object3D, targetId: string, seatId: string, floorY = 0) {
  if (!Number.isFinite(floorY)) throw new Error('落座地面高度无效')
  const document = parseScene3DDocument(source)
  const target = document.objects.find(item => item.id === targetId)
  const seat = document.objects.find(item => item.id === seatId)
  if (target?.type !== 'person' || !target.character) throw new Error('落座需要真实人物模型')
  if (target.pose !== 'sitting') throw new Error('请先应用坐姿后再测量落座')
  if (seat?.type !== 'box' || targetId === seatId) throw new Error('座面必须是独立 box 对象，请指定坐垫而非整把椅子')
  const related = new Set([targetId, seatId, ...document.groups.filter(group => group.memberIds.includes(targetId) || group.memberIds.includes(seatId)).map(group => group.id)])
  if (document.timeline?.some(entry => related.has(entry.target) && ['move', 'rotate', 'scale'].includes(entry.action)))
    throw new Error('人物或座面带有变换动画，请先调整时间线后再落座')
  const actorNode = root.getObjectByName(`scene-object:${targetId}`)
  const seatNode = root.getObjectByName(`scene-object:${seatId}`)
  const hips = actorNode?.getObjectByName('Hips')
  const spine = actorNode?.getObjectByName('Spine')
  if (!actorNode || !seatNode || !hips || !spine) throw new Error('人物或座面尚未加载，无法测量落座')
  root.updateMatrixWorld(true)
  const orientation = seatNode.getWorldQuaternion(new Quaternion())
  if (new Vector3(0, 1, 0).applyQuaternion(orientation).dot(new Vector3(0, 1, 0)) < 0.999) throw new Error('暂不支持倾斜座面，请使用水平坐垫')
  const bounds = new Box3().setFromObject(seatNode)
  const hip = hips.getWorldPosition(new Vector3())
  const clearance = hip.distanceTo(spine.getWorldPosition(new Vector3())) * 0.5
  const desired = bounds.getCenter(new Vector3()).setY(bounds.max.y + clearance)
  const origin = actorNode.getWorldPosition(new Vector3()).add(desired.sub(hip))
  if (actorNode.parent) actorNode.parent.worldToLocal(origin)
  actorNode.position.copy(origin)
  root.updateMatrixWorld(true)
  const body = actorNode.getObjectByName('scene-character')
  if (!body) throw new Error('真实人物模型尚未加载')
  body.traverse(node => {
    const mesh = node as Object3D & { isSkinnedMesh?: boolean; computeBoundingBox?: () => void }
    if (mesh.isSkinnedMesh) mesh.computeBoundingBox?.()
  })
  const footGap = new Box3().setFromObject(body).min.y - floorY
  if (!Number.isFinite(footGap)) throw new Error('人物几何边界不可测量')
  target.position = origin.toArray()
  return {
    document,
    report: {
      target: targetId, seat: seatId, position: target.position, seatTopY: bounds.max.y,
      pelvisClearance: clearance, contactMethod: 'hip-bone-estimate', floorY,
      footGap, warning: Math.abs(footGap) > 0.05 ? '人物最低点与地面有高度差；请结合截图调整坐垫高度或人物比例' : null,
      visualCheckRequired: true,
    },
  }
}
