import { useRef, useState, useCallback } from 'react'
import { VLAWorld3D } from '../physics3d/VLAWorld3D'
import { callVLA3D, callVLAStep3D, StepHistory3D } from '../api/vla3d'
import { Metrics, CaptureImages } from '../physics3d/types3d'

export type Status = 'idle' | 'thinking' | 'executing' | 'success' | 'error'
export type Mode   = 'closed' | 'open'

const MAX_STEPS = 40

export function actionLabel3D(action: { type: string; x?: number | null; y?: number | null; z?: number | null; width?: number | null }) {
  if (action.type === 'MOVE_TCP_TO')
    return `MOVE_TCP_TO(${(action.x ?? 0).toFixed(3)}, ${(action.y ?? 0).toFixed(3)}, ${(action.z ?? 0).toFixed(3)})`
  if (action.type === 'SET_GRIP') return `SET_GRIP(${(action.width ?? 0).toFixed(3)}m)`
  return action.type
}

function waitForIdle(worldRef: React.MutableRefObject<VLAWorld3D | null>, extraMs = 400): Promise<void> {
  return new Promise(resolve => {
    const check = () => {
      if (!worldRef.current || worldRef.current.isIdle) setTimeout(resolve, extraMs)
      else setTimeout(check, 50)
    }
    setTimeout(check, 50)
  })
}

const INITIAL_METRICS: Metrics = {
  successRate: 0, avgSteps: 0, dropCount: 0,
  collisionCount: 0, totalEpisodes: 0, successCount: 0, totalSteps: 0,
}

export function useVLARunner3D(
  worldRef: React.MutableRefObject<VLAWorld3D | null>,
  captureRef: React.MutableRefObject<() => CaptureImages>,
  instruction: string,
) {
  const cancelRef = useRef(false)
  const [mode, setMode]       = useState<Mode>('open')
  const [status, setStatus]   = useState<Status>('idle')
  const [log, setLog]         = useState<string[]>([])
  const [metrics, setMetrics] = useState<Metrics>(INITIAL_METRICS)

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev.slice(-60), `[${new Date().toLocaleTimeString()}] ${msg}`])
  }, [])

  // ---- open-loop ----
  const runOpenLoop = useCallback(async (w: VLAWorld3D) => {
    addLog('⚡ Open-loop: generating full plan...')
    setStatus('thinking')

    const { perspective, topdown } = captureRef.current()
    const state = w.getState()
    const res = await callVLA3D({ instruction, image: perspective, image_top: topdown, state })

    addLog(`🤖 Reasoning: ${res.reasoning}`)
    addLog(`📋 Actions: ${res.actions.length}`)
    res.actions.forEach((a, i) => addLog(`  [${i}] ${actionLabel3D(a)}`))

    setStatus('executing')
    w.enqueueActions(res.actions)
    await waitForIdle(worldRef, 1000)

    if (res.target_object && res.target_bin) {
      return w.checkSuccess(res.target_bin, res.target_object)
    }
    for (const bin of w.getState().targetBins) {
      for (const obj of w.getState().objects) {
        if (w.checkSuccess(bin.id, obj.id)) return true
      }
    }
    return false
  }, [instruction, addLog, captureRef, worldRef])

  // ---- closed-loop ----
  const runClosedLoop = useCallback(async (w: VLAWorld3D) => {
    addLog('🔁 Closed-loop start')
    const history: StepHistory3D[] = []
    let succeeded = false

    const initialSuccesses = new Set<string>()
    const loggedSuccesses  = new Set<string>()
    let prevSuccessCount = 0
    let stepsSinceLastSuccess = 0

    for (const bin of w.getState().targetBins) {
      for (const obj of w.getState().objects) {
        if (w.checkSuccess(bin.id, obj.id)) initialSuccesses.add(`${obj.id}:${bin.id}`)
      }
    }

    for (let step = 0; step < MAX_STEPS; step++) {
      if (cancelRef.current) { addLog('⏹ Cancelled'); break }

      if (prevSuccessCount > 0 && !w.getState().gripper.isGrasping && stepsSinceLastSuccess >= 4) {
        succeeded = true
        addLog('✅ Task complete (pre-obs check)')
        break
      }

      setStatus('thinking')
      const { perspective, topdown } = captureRef.current()
      const state = w.getState()

      addLog(`🔍 Step ${step}: observing → Claude...`)
      const res = await callVLAStep3D({ instruction, image: perspective, image_top: topdown, state, history, step })

      addLog(`🤖 Step ${step} [${actionLabel3D(res.action)}]: ${res.reasoning}`)
      history.push({ step, action: res.action, reasoning: res.reasoning })

      if (res.is_done) {
        addLog('✅ Claude DONE')
        if (w.getState().gripper.isGrasping) {
          addLog('🔄 Auto-release (still grasping)')
          w.enqueueActions([{ type: 'RELEASE' }])
          await waitForIdle(worldRef, 800)
        }
        // アクションを何も取らずに DONE した場合（= タスクが最初から完了していた）は
        // initialSuccesses フィルタを外す。そうしないと「最初からビンに入っていた物体を
        // 指示したケース」が成功扱いにならない。
        const anyActionTaken = history.some(h => h.action.type !== 'WAIT')
        for (const bin of w.getState().targetBins) {
          for (const obj of w.getState().objects) {
            const key = `${obj.id}:${bin.id}`
            if (w.checkSuccess(bin.id, obj.id) && (anyActionTaken ? !initialSuccesses.has(key) : true)) {
              succeeded = true
              addLog(`🎉 ${obj.label} → ${bin.label} success!`)
            }
          }
        }
        break
      }

      setStatus('executing')
      w.enqueueActions([res.action])
      await waitForIdle(worldRef, res.action.type === 'RELEASE' ? 800 : 300)

      if (res.action.type === 'RELEASE') {
        let newCount = 0
        for (const bin of w.getState().targetBins) {
          for (const obj of w.getState().objects) {
            const key = `${obj.id}:${bin.id}`
            if (w.checkSuccess(bin.id, obj.id) && !initialSuccesses.has(key)) {
              newCount++
              if (!loggedSuccesses.has(key)) {
                loggedSuccesses.add(key)
                addLog(`📦 ${obj.label} → ${bin.label} placed`)
              }
            }
          }
        }
        if (newCount > prevSuccessCount) {
          prevSuccessCount = newCount
          stepsSinceLastSuccess = 0
        } else {
          stepsSinceLastSuccess++
        }
      } else {
        stepsSinceLastSuccess++
      }
    }
    return succeeded
  }, [instruction, addLog, captureRef, worldRef])

  // ---- public handlers ----
  const handleRun = useCallback(async () => {
    const w = worldRef.current
    if (!w || !instruction.trim() || status === 'thinking' || status === 'executing') return
    cancelRef.current = false
    addLog(`📝 [${mode === 'closed' ? 'Closed-loop' : 'Open-loop'}] "${instruction}"`)

    let succeeded = false
    try {
      succeeded = mode === 'open' ? await runOpenLoop(w) : await runClosedLoop(w)
    } catch (e) {
      addLog(`❌ Error: ${e instanceof Error ? e.message : String(e)}`)
      setStatus('error')
      return
    }

    if (succeeded) {
      w.recordSuccess()
      addLog('🎉 Success!')
      setStatus('success')
    } else {
      w.recordFailure()
      addLog('⚠ Task not completed')
      setStatus('idle')
    }
    setMetrics({ ...w.metrics })
  }, [instruction, mode, status, addLog, runOpenLoop, runClosedLoop, worldRef])

  const handleStop = useCallback(() => {
    cancelRef.current = true
    setStatus('idle')
    addLog('⏹ Stopped')
  }, [addLog])

  const handleReset = useCallback(() => {
    cancelRef.current = true
    worldRef.current?.resetObjects()
    worldRef.current?.setCameraPreset('default')
    setStatus('idle')
    setLog([])
    addLog('🔄 Reset')
  }, [addLog, worldRef])

  const handleRandomize = useCallback(() => {
    cancelRef.current = true
    worldRef.current?.randomizeScene()
    worldRef.current?.setCameraPreset('default')
    setStatus('idle')
    setLog([])
    addLog('🎲 Scene randomized')
  }, [addLog, worldRef])

  return {
    mode, setMode,
    status,
    log,
    metrics,
    isRunning: status === 'thinking' || status === 'executing',
    handleRun,
    handleStop,
    handleReset,
    handleRandomize,
  }
}
