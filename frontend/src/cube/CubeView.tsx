import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ColorName, CubeState } from '../api/types'
import { colorHex } from '../lib/format'
import { rotateOffset, specAngle } from './animation'
import { cubieSlots, sizeOf, slotKey, type Vec3 } from './facelets'
import { layerSlots, parseMove, rotateSlot, type MoveSpec } from './moves'
import { MATERIAL_NORMALS, materialIndex, paintPlan } from './repaint'
import {
  easeOutProgress,
  initialCameraPosition,
  presetCameraPosition,
  VIEW_LERP_MS,
  type ViewRequest,
} from './viewControls'

const CUBIE_SIZE = 0.94
const DARK = '#0f172a'
const UNIT = 0.5
const BASE_DURATION_MS = 220
const INSTANT_SPEED = 100

const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
]

export interface MoveBatch {
  eventId: number
  moves: string[]
  state: CubeState
}

export interface CubeViewProps {
  state: CubeState | null
  resetToken: number
  batch: MoveBatch | null
  speed: number
  paused: boolean
  skipToken: number
  viewRequest?: ViewRequest
  idleSpin?: boolean
  onBatchComplete?: () => void
}

interface Entry {
  index: number
  mesh: THREE.Mesh
  materials: THREE.MeshStandardMaterial[]
  slot: Vec3
  quat: THREE.Quaternion
}

interface CurrentMove {
  batch: MoveBatch
  moveIndex: number
  spec: MoveSpec
  elapsed: number
  duration: number
  entries: Entry[]
}

function Scene(props: CubeViewProps) {
  const size = props.state ? sizeOf(props.state.cube) : 2
  const slots = useMemo(() => cubieSlots(size), [size])
  const group = useRef<THREE.Group | null>(null)
  const entries = useRef<Entry[]>([])
  const queue = useRef<MoveBatch[]>([])
  const current = useRef<CurrentMove | null>(null)
  const pausedRef = useRef(props.paused)
  const speedRef = useRef(props.speed)
  const latestTarget = useRef<CubeState | null>(props.state)
  const lastBatchId = useRef<number | null>(null)
  const scratchPosition = useRef(new THREE.Vector3())
  const scratchQuat = useRef(new THREE.Quaternion())

  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as
    | {
        addEventListener: (type: 'start', listener: () => void) => void
        removeEventListener: (type: 'start', listener: () => void) => void
      }
    | null
  const viewAnim = useRef<{
    from: THREE.Vector3
    to: THREE.Vector3
    elapsed: number
  } | null>(null)
  const lastViewToken = useRef(0)
  const userOrbited = useRef(false)
  const idleSpinRef = useRef(props.idleSpin === true)
  const onBatchCompleteRef = useRef(props.onBatchComplete)
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches

  useEffect(() => {
    idleSpinRef.current = props.idleSpin === true
  }, [props.idleSpin])

  useEffect(() => {
    onBatchCompleteRef.current = props.onBatchComplete
  }, [props.onBatchComplete])

  // 视角预设：token 递增时开始一次相机 lerp（guard 保证重复渲染不重触发）
  useEffect(() => {
    if (!props.viewRequest) return
    if (props.viewRequest.token === lastViewToken.current) return
    lastViewToken.current = props.viewRequest.token
    const size = props.state ? sizeOf(props.state.cube) : 2
    const to = new THREE.Vector3(
      ...presetCameraPosition(props.viewRequest.preset, size),
    )
    if (reducedMotion) {
      // 偏好减少动效时跳过逐帧插值，直接落到 lerp 终点并中止动画
      camera.position.copy(to)
      viewAnim.current = null
      return
    }
    viewAnim.current = { from: camera.position.clone(), to, elapsed: 0 }
  }, [props.viewRequest, props.state, camera])

  // 用户开始拖动即中止相机 lerp，并停掉本轮待机自转
  useEffect(() => {
    if (!controls) return
    const onStart = () => {
      viewAnim.current = null
      userOrbited.current = true
    }
    controls.addEventListener('start', onStart)
    return () => controls.removeEventListener('start', onStart)
  }, [controls])

  useEffect(() => {
    pausedRef.current = props.paused
  }, [props.paused])

  useEffect(() => {
    speedRef.current = props.speed
  }, [props.speed])

  function repaint(state: CubeState) {
    const plans = new Map<string, Map<number, ColorName>>()
    for (const paint of paintPlan(state)) {
      let slotPlan = plans.get(paint.slot)
      if (!slotPlan) {
        slotPlan = new Map()
        plans.set(paint.slot, slotPlan)
      }
      slotPlan.set(materialIndex(paint.normal), paint.color)
    }
    for (const entry of entries.current) {
      const slotPlan = plans.get(slotKey(entry.slot))
      entry.materials.forEach((material, index) => {
        const color = slotPlan?.get(index)
        material.color.set(color ? colorHex(color) : DARK)
      })
    }
  }

  function place(entry: Entry, slot: Vec3) {
    entry.slot = slot
    entry.quat.identity()
    entry.mesh.position.set(slot[0] * UNIT, slot[1] * UNIT, slot[2] * UNIT)
    entry.mesh.quaternion.identity()
  }

  function snapTo(state: CubeState | null) {
    queue.current = []
    current.current = null
    latestTarget.current = state
    entries.current.forEach((entry) => {
      place(entry, slots[entry.index])
    })
    if (state) repaint(state)
  }

  useEffect(() => {
    const parent = group.current
    if (!parent) return
    const built: Entry[] = slots.map((slot, index) => {
      const geometry = new THREE.BoxGeometry(
        CUBIE_SIZE,
        CUBIE_SIZE,
        CUBIE_SIZE,
      )
      const materials = MATERIAL_NORMALS.map(
        () =>
          new THREE.MeshStandardMaterial({
            color: DARK,
            roughness: 0.45,
            metalness: 0,
          }),
      )
      const mesh = new THREE.Mesh(geometry, materials)
      mesh.position.set(slot[0] * UNIT, slot[1] * UNIT, slot[2] * UNIT)
      parent.add(mesh)
      return { index, mesh, materials, slot, quat: new THREE.Quaternion() }
    })
    entries.current = built
    if (latestTarget.current) repaint(latestTarget.current)
    return () => {
      for (const entry of built) {
        parent.remove(entry.mesh)
        entry.mesh.geometry.dispose()
        entry.materials.forEach((material) => material.dispose())
      }
      entries.current = []
    }
  }, [slots])

  // state 只在 resetToken 递增时吸附；实时 state 的更新不得打断动画。
  // 事件 id 在同一 run 内单调，换 run/换题会从 1 重来，所以吸附时清掉去重标记。
  useEffect(() => {
    lastBatchId.current = null
    userOrbited.current = false
    group.current?.rotation.set(0, 0, 0)
    snapTo(props.state)
  }, [props.resetToken])

  useEffect(() => {
    const batch = props.batch
    if (!batch) return
    if (batch.eventId === lastBatchId.current) return
    lastBatchId.current = batch.eventId
    latestTarget.current = batch.state
    queue.current.push(batch)
  }, [props.batch])

  useEffect(() => {
    if (props.skipToken > 0) snapTo(latestTarget.current)
  }, [props.skipToken])

  function beginMove(batch: MoveBatch, moveIndex: number): CurrentMove {
    const spec = parseMove(batch.moves[moveIndex], sizeOf(batch.state.cube))
    const keys = new Set(
      layerSlots(
        entries.current.map((entry) => entry.slot),
        spec,
      ).map(slotKey),
    )
    return {
      batch,
      moveIndex,
      spec,
      elapsed: 0,
      duration: BASE_DURATION_MS / speedRef.current,
      entries: entries.current.filter((entry) =>
        keys.has(slotKey(entry.slot)),
      ),
    }
  }

  function startNextMove() {
    const batch = queue.current[0]
    if (!batch) return
    current.current = beginMove(batch, 0)
  }

  function applyFrame(move: CurrentMove, angle: number) {
    const quat = scratchQuat.current.setFromAxisAngle(
      AXES[move.spec.axis],
      angle,
    )
    const position = scratchPosition.current
    for (const entry of move.entries) {
      const [x, y, z] = rotateOffset(entry.slot, move.spec.axis, angle)
      position.set(x * UNIT, y * UNIT, z * UNIT)
      entry.mesh.position.copy(position)
      entry.mesh.quaternion.copy(quat).multiply(entry.quat)
    }
  }

  function commitMove(move: CurrentMove) {
    const full = scratchQuat.current.setFromAxisAngle(
      AXES[move.spec.axis],
      specAngle(move.spec),
    )
    for (const entry of move.entries) {
      entry.quat.premultiply(full)
      entry.slot = rotateSlot(entry.slot, move.spec)
      entry.mesh.position.set(
        entry.slot[0] * UNIT,
        entry.slot[1] * UNIT,
        entry.slot[2] * UNIT,
      )
      entry.mesh.quaternion.copy(entry.quat)
    }
  }

  function finishMove(move: CurrentMove) {
    commitMove(move)
    const nextIndex = move.moveIndex + 1
    if (nextIndex < move.batch.moves.length) {
      current.current = beginMove(move.batch, nextIndex)
      return
    }
    queue.current.shift()
    current.current = null
    for (const entry of entries.current) {
      entry.quat.identity()
      entry.mesh.quaternion.identity()
    }
    repaint(move.batch.state)
    onBatchCompleteRef.current?.()
  }

  useFrame((_, delta) => {
    if (viewAnim.current) {
      viewAnim.current.elapsed += delta * 1000
      camera.position.lerpVectors(
        viewAnim.current.from,
        viewAnim.current.to,
        easeOutProgress(viewAnim.current.elapsed),
      )
      if (viewAnim.current.elapsed >= VIEW_LERP_MS) viewAnim.current = null
    }
    if (pausedRef.current) return
    if (speedRef.current >= INSTANT_SPEED) {
      if (current.current || queue.current.length > 0) {
        snapTo(latestTarget.current)
        // 瞬间分支同样消费了整批走法，须与 finishMove 一样补发批次完成回调
        // （交互层附加调用，不动 queue/current/snapTo 机制本身）：
        // 否则 EpisodePage 连播在 instant 速度下收不到 onBatchComplete，
        // playing 永卡第一步（eventId 已入去重表，切回 1× 也不会重播）。
        onBatchCompleteRef.current?.()
      }
    } else {
      if (!current.current) startNextMove()
      const move = current.current
      if (move) {
        move.elapsed += delta * 1000
        const progress = Math.min(1, move.elapsed / move.duration)
        const eased = progress * progress * (3 - 2 * progress)
        applyFrame(move, specAngle(move.spec) * eased)
        if (progress >= 1) finishMove(move)
      }
    }
    if (
      idleSpinRef.current &&
      !reducedMotion &&
      !userOrbited.current &&
      !current.current &&
      queue.current.length === 0 &&
      group.current
    ) {
      group.current.rotation.y += delta * 0.3
    }
  })

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[5, 8, 6]} intensity={1.5} />
      <directionalLight position={[-5, -4, -6]} intensity={0.55} />
      <group ref={group} />
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={4}
        maxDistance={14}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={(Math.PI * 5) / 6}
        enableDamping
      />
    </>
  )
}

export function CubeView(props: CubeViewProps) {
  const size = props.state ? sizeOf(props.state.cube) : 2
  // r3f 的 camera 只在 Canvas 挂载时生效，尺寸切换必须重建 Canvas。
  return (
    <div data-testid="cube-canvas" className="h-[420px] w-full">
      <Canvas
        key={size}
        camera={{ position: initialCameraPosition(size), fov: 45 }}
      >
        <Scene {...props} />
      </Canvas>
    </div>
  )
}
