import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ColorName, CubeState } from '../api/types'
import { colorHex } from '../lib/format'
import { rotateOffset, specAngle } from './animation'
import { cubieSlots, sizeOf, slotKey, type Vec3 } from './facelets'
import { layerSlots, parseMove, rotateSlot, type MoveSpec } from './moves'
import { MATERIAL_NORMALS, materialIndex, paintPlan } from './repaint'

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
  }

  useFrame((_, delta) => {
    if (pausedRef.current) return
    if (speedRef.current >= INSTANT_SPEED) {
      if (current.current || queue.current.length > 0) {
        snapTo(latestTarget.current)
      }
      return
    }
    if (!current.current) startNextMove()
    const move = current.current
    if (!move) return
    move.elapsed += delta * 1000
    const progress = Math.min(1, move.elapsed / move.duration)
    const eased = progress * progress * (3 - 2 * progress)
    applyFrame(move, specAngle(move.spec) * eased)
    if (progress >= 1) finishMove(move)
  })

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[5, 8, 6]} intensity={1.5} />
      <directionalLight position={[-5, -4, -6]} intensity={0.55} />
      <group ref={group} />
      <OrbitControls
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
        camera={{
          position: size === 2 ? [3.2, 3.2, 4.2] : [5, 5, 6.5],
          fov: 45,
        }}
      >
        <Scene {...props} />
      </Canvas>
    </div>
  )
}
