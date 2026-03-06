import { useRef, useState, useCallback } from 'react'
import { VLAWorld } from '../physics/VLAWorld'
import { callVLA, callVLAStep, StepHistory } from '../api/vla'
import { Metrics } from '../physics/types'

export type Status = 'idle' | 'thinking' | 'executing' | 'success' | 'error'
export type Mode = 'closed' | 'open'

const MAX_STEPS = 40

export function actionLabel(action: { type: string; x?: number | null; y?: number | null; width?: number | null }) {
  if (action.type === 'MOVE_TCP_TO') return `MOVE_TCP_TO(${Math.round(action.x ?? 0)}, ${Math.round(action.y ?? 0)})`
  if (action.type === 'SET_GRIP') return `SET_GRIP(${action.width})`
  return action.type
}

function waitForIdle(worldRef: React.MutableRefObject<VLAWorld | null>, extraMs = 400): Promise<void> {
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

export function useVLARunner(
  worldRef: React.MutableRefObject<VLAWorld | null>,
  captureRef: React.MutableRefObject<() => string>,
  instruction: string,
) {
  const cancelRef = useRef(false)

  const [mode, setMode] = useState<Mode>('closed')
  const [status, setStatus] = useState<Status>('idle')
  const [log, setLog] = useState<string[]>([])
  const [metrics, setMetrics] = useState<Metrics>(INITIAL_METRICS)

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev.slice(-60), `[${new Date().toLocaleTimeString()}] ${msg}`])
  }, [])

  // ---- open-loop ----

  const runOpenLoop = useCallback(async (w: VLAWorld) => {
    addLog('⚡ オープンループ: 全アクションを一括生成中...')
    setStatus('thinking')

    const image = captureRef.current()
    const state = w.getState()
    const res = await callVLA({ instruction, image, state })

    addLog(`🤖 Reasoning: ${res.reasoning}`)
    addLog(`📋 アクション数: ${res.actions.length}`)
    res.actions.forEach((a, i) => addLog(`  [${i}] ${actionLabel(a)}`))

    setStatus('executing')
    w.enqueueActions(res.actions)
    await waitForIdle(worldRef, 1000)

    if (res.target_object && res.target_zone) {
      return w.checkSuccess(res.target_zone, res.target_object)
    }
    for (const zone of w.getState().targetZones) {
      for (const obj of w.getState().objects) {
        if (w.checkSuccess(zone.id, obj.id)) return true
      }
    }
    return false
  }, [instruction, addLog, captureRef, worldRef])

  // ---- closed-loop ----

  const runClosedLoop = useCallback(async (w: VLAWorld) => {
    addLog('🔁 クローズドループ開始')
    const history: StepHistory[] = []
    let succeeded = false

    // 開始時点でゾーン内にあるブロックを記録（初期配置の誤検知を防ぐ）
    const initialSuccesses = new Set<string>()
    const loggedSuccesses = new Set<string>()
    let prevSuccessCount = 0
    let stepsSinceLastSuccess = 0

    for (const zone of w.getState().targetZones) {
      for (const obj of w.getState().objects) {
        if (w.checkSuccess(zone.id, obj.id)) initialSuccesses.add(`${obj.id}:${zone.id}`)
      }
    }

    for (let step = 0; step < MAX_STEPS; step++) {
      if (cancelRef.current) { addLog('⏹ 中断'); break }

      // 観測前チェック: 新規配置あり & グリッパー空 & 4ステップ以上変化なし → 完了
      // 閾値4: マルチステップで次ブロックを掴みに行く動作（MOVE×2〜3 + GRASP）の間は中断しない
      if (prevSuccessCount > 0 && !w.getState().gripper.isGrasping && stepsSinceLastSuccess >= 4) {
        succeeded = true
        addLog('✅ 全タスク完了（観測前確認）')
        break
      }

      setStatus('thinking')
      const image = captureRef.current()
      const state = w.getState()

      addLog(`🔍 Step ${step}${step === 0 ? ' (初期確認)' : ''}: 観測 → Claude...`)
      const res = await callVLAStep({ instruction, image, state, history, step })

      addLog(`🤖 Step ${step} [${actionLabel(res.action)}]: ${res.reasoning}`)
      history.push({ step, action: res.action, reasoning: res.reasoning })

      if (res.is_done) {
        addLog('✅ Claude DONE')
        if (w.getState().gripper.isGrasping) {
          addLog('🔄 把持中のためオートリリース')
          w.enqueueActions([{ type: 'RELEASE' }])
          await waitForIdle(worldRef, 800)
        }
        for (const zone of w.getState().targetZones) {
          for (const obj of w.getState().objects) {
            if (w.checkSuccess(zone.id, obj.id) && !initialSuccesses.has(`${obj.id}:${zone.id}`)) {
              succeeded = true
              addLog(`🎉 ${obj.label} → ${zone.label} 成功！`)
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
        for (const zone of w.getState().targetZones) {
          for (const obj of w.getState().objects) {
            const key = `${obj.id}:${zone.id}`
            if (w.checkSuccess(zone.id, obj.id) && !initialSuccesses.has(key)) {
              newCount++
              if (!loggedSuccesses.has(key)) {
                loggedSuccesses.add(key)
                addLog(`📦 ${obj.label} → ${zone.label} 配置済み`)
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
      addLog(`❌ エラー: ${e instanceof Error ? e.message : String(e)}`)
      setStatus('error')
      return
    }

    if (succeeded) {
      w.recordSuccess()
      addLog('🎉 成功！')
      setStatus('success')
    } else {
      w.recordFailure()
      addLog('⚠ 未達成')
      setStatus('idle')
    }
    setMetrics({ ...w.metrics })
  }, [instruction, mode, status, addLog, runOpenLoop, runClosedLoop, worldRef])

  const handleStop = useCallback(() => {
    cancelRef.current = true
    setStatus('idle')
    addLog('⏹ 手動中断')
  }, [addLog])

  const handleReset = useCallback(() => {
    cancelRef.current = true
    worldRef.current?.resetObjects()
    setStatus('idle')
    setLog([])
    addLog('🔄 リセット (デフォルト)')
  }, [addLog, worldRef])

  const handleRandomize = useCallback(() => {
    cancelRef.current = true
    worldRef.current?.randomizeScene()
    setStatus('idle')
    setLog([])
    addLog('🎲 シーンをランダム生成')
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
