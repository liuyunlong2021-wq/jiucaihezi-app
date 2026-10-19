import handPoses from '@/assets/storyboarder/hand-poses.json'
import poses from '@/assets/storyboarder/poses.json'
import { convertFileSrc } from '@tauri-apps/api/core'
import { resolveResource } from '@tauri-apps/api/path'
import type { Object3D } from 'three'
import type { Scene3DCharacter, Scene3DObject, Scene3DCharacterModel } from './scene3d'

export const STORYBOARDER_CHARACTER_MODELS: Scene3DCharacterModel[] = ['adult-male', 'adult-female', 'teen-male', 'teen-female', 'child']
export const STORYBOARDER_EDITABLE_BONES = [
  'Head', 'Neck', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
  'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3', 'RightHandIndex1', 'RightHandIndex2', 'RightHandIndex3',
]

type PresetState = { skeleton?: Record<string, { rotation?: { x?: number; y?: number; z?: number } }>; handSkeleton?: Record<string, { rotation?: { x?: number; y?: number; z?: number } }> }
type Preset = { id: string; name: string; keywords?: string; state: PresetState }

export const STORYBOARDER_POSES = Object.values(poses) as Preset[]
export const STORYBOARDER_HAND_POSES = Object.values(handPoses) as Preset[]

export function posePreset(id: string) { return STORYBOARDER_POSES.find(item => item.id === id) }
export function handPosePreset(id: string) { return STORYBOARDER_HAND_POSES.find(item => item.id === id) }

export async function resolveStoryboarderModelUrl(model: Scene3DCharacterModel): Promise<string | null> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null
  const path = await resolveResource(`storyboarder/models/${model}.glb`)
  return convertFileSrc(path)
}

export function applyStoryboarderCharacterState(root: Object3D, character: Scene3DCharacter, pose: Scene3DObject['pose'] = 'standing') {
  root.traverse(node => {
    const bind = node.userData.storyboarderBindQuaternion as [number, number, number, number] | undefined
    if (bind) node.quaternion.fromArray(bind)
  })
  // Use the same presets as the editor buttons; explicit manual bones override the base pose.
  const presetName = { standing: 'stand', sitting: 'sit chair', crouching: 'crouch inspect', lying: 'laying on back' }[pose]
  const preset = pose === 'standing' ? undefined : STORYBOARDER_POSES.find(item => item.name === presetName)
  for (const [name, entry] of Object.entries(preset?.state.skeleton || {})) {
    const bone = root.getObjectByName(name)
    const rotation = entry.rotation
    if (bone && rotation) bone.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0)
  }
  for (const [name, values] of Object.entries(character.bones || {})) {
    const bone = root.getObjectByName(name)
    if (bone) bone.quaternion.fromArray(values)
  }
}
