import { useEffect, useMemo, useRef } from 'react'
import { Tldraw, type TLOnMountHandler } from 'tldraw'
import type { TLStoreSnapshot } from '@tldraw/tlschema'
import type { RecordsDiff } from '@tldraw/store'
import { isRecordsDiffEmpty, squashRecordDiffs } from '@tldraw/store'

interface WhiteboardProps {
  boardId: string;
}

// 开发环境：前端跑在 5173，后端在 4000；
// 构建后的部署版：前端和后端是同一端口，直接用 location.host。
const WS_URL =
  import.meta.env.DEV
    ? `ws://${window.location.hostname}:4000/ws`
    : `ws://${window.location.host}/ws`;

export function Whiteboard({ boardId }: WhiteboardProps) {
  type ServerMessage =
    | { type: 'init'; boardId: string; snapshot: TLStoreSnapshot | null }
    | { type: 'snapshot'; snapshot: TLStoreSnapshot | null; clientId?: string | null }
    | { type: 'diff'; diff: RecordsDiff<any>; clientId?: string | null }

  const wsRef = useRef<WebSocket | null>(null)
  const editorRef = useRef<any>(null)
  const pendingSnapshotRef = useRef<TLStoreSnapshot | null>(null)
  const applyingRemoteRef = useRef(false)
  const clientIdRef = useRef<string>(Math.random().toString(36).slice(2, 10))
  const pendingSnapshotTimerRef = useRef<number | null>(null)
  const pendingDiffsRef = useRef<RecordsDiff<any>[]>([]) // 批量合并待应用的 diff
  const applyDiffsTimerRef = useRef<number | null>(null) // RAF 定时器
  
  // 性能优化：如果 diff 过大（超过阈值），降级为 snapshot 以避免卡顿
  const MAX_DIFF_RECORDS = 1000 // 单次 diff 最大记录数，超过则使用 snapshot
  const getDiffSize = (diff: RecordsDiff<any>): number => {
    const added = diff.added ? Object.keys(diff.added).length : 0
    const updated = diff.updated ? Object.keys(diff.updated).length : 0
    const removed = diff.removed ? Object.keys(diff.removed).length : 0
    return added + updated + removed
  }

  const sendSnapshot = () => {
    const ws = wsRef.current
    const editor = editorRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !editor) return

    // 只同步 document，避免把本地 selection / camera 等 session 状态同步给其他人
    const doc = editor.getSnapshot().document as TLStoreSnapshot
    ws.send(JSON.stringify({ type: 'snapshot', snapshot: doc, clientId: clientIdRef.current }))
  }

  const sendDiff = (diff: RecordsDiff<any>) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'diff', diff, clientId: clientIdRef.current }))
  }

  const onMount = useMemo<TLOnMountHandler>(() => {
    return (editor) => {
      editorRef.current = editor
      
      // 暴露编辑器实例到全局，方便测试脚本使用
      if (typeof window !== 'undefined') {
        (window as any).__tldrawEditor = editor
      }

      // 如果 WS init 先到，mount 后再补一把 load
      if (pendingSnapshotRef.current) {
        applyingRemoteRef.current = true
        editor.loadSnapshot({ document: pendingSnapshotRef.current }, { forceOverwriteSessionState: true })
        applyingRemoteRef.current = false
        pendingSnapshotRef.current = null
      }

      // 原生 tldraw 协同方式：同步 store 的 document diff（而不是频繁 loadSnapshot）
      // 只监听 user 对 document 的更改，并广播 diff；同时做一个较低频的 snapshot 兜底（用于新加入者 init）
      let sendDiffTimer: number | null = null
      let pendingDiff: RecordsDiff<any> | null = null // 暂存待发送的 diff
      let flushPendingTimer: number | null = null // 等待交互结束后再发送 diff（避免长笔画被拆段）
      let lastPointerDownTime = 0 // 记录最后一次指针按下的时间

      // 检查 diff 中是否包含 draw 类型的 shape（画笔绘制）
      const hasDrawShape = (diff: RecordsDiff<any>): boolean => {
        if (!diff) return false
        
        const checkRecord = (record: any): boolean => {
          if (!record || typeof record !== 'object') return false
          
          // updated 字段是 [oldValue, newValue] 元组格式
          if (Array.isArray(record) && record.length === 2) {
            const newValue = record[1]
            return newValue && typeof newValue === 'object' && newValue.type === 'draw'
          }
          
          // added 字段是直接的对象
          if (record.type === 'draw') {
            return true
          }
          
          return false
        }
        
        // 检查 added 字段
        if (diff.added) {
          for (const [id, record] of Object.entries(diff.added)) {
            if (checkRecord(record)) {
              if (import.meta.env.DEV) {
                console.log('[协同] 检测到 draw shape 新增:', id)
              }
              return true
            }
          }
        }
        
        // 检查 updated 字段（格式是 [oldValue, newValue]）
        if (diff.updated) {
          for (const [id, record] of Object.entries(diff.updated)) {
            if (checkRecord(record)) {
              // 检查是否是同一个 draw shape 的更新（而不是新增）
              const shapeId = id
              const existingShape = editor.store.get(shapeId as any)
              if (existingShape && existingShape.type === 'draw') {
                if (import.meta.env.DEV) {
                  console.log('[协同] 检测到 draw shape 更新:', shapeId)
                }
                return true
              }
            }
          }
        }
        
        return false
      }

      const flushPendingDiffWhenIdle = () => {
        const isPointerDown = Boolean((editor as any)?.inputs?.isPointerDown)
        const currentTime = Date.now()
        const timeSincePointerDown = currentTime - lastPointerDownTime
        
        // 检测当前工具是否是 draw 工具
        const currentToolId = (editor as any)?.getCurrentTool?.()?.id || ''
        const isDrawTool = currentToolId === 'draw' || currentToolId === 'drawing'
        
        // 如果指针仍在按下，或者距离按下时间很短（可能还在绘制），或者当前工具是 draw，继续等待
        if (isPointerDown || isDrawTool || timeSincePointerDown < 300) {
          if (import.meta.env.DEV) {
            console.log('[协同] 继续等待绘制完成:', {
              isPointerDown,
              isDrawTool,
              timeSincePointerDown,
              hasPendingDiff: !!pendingDiff
            })
          }
          flushPendingTimer = window.setTimeout(flushPendingDiffWhenIdle, 200)
          return
        }

        flushPendingTimer = null
        if (!pendingDiff) {
          if (import.meta.env.DEV) {
            console.log('[协同] 没有待发送的 diff')
          }
          return
        }

        const diffToSend = pendingDiff
        pendingDiff = null

        if (import.meta.env.DEV) {
          console.log('[协同] 发送暂存的 draw diff，大小:', getDiffSize(diffToSend))
        }

        const diffSize = getDiffSize(diffToSend)
        if (diffSize > MAX_DIFF_RECORDS) {
          sendSnapshot()
        } else {
          sendDiff(diffToSend)
        }
      }

      // 监听指针事件，更准确地检测绘制完成
      const handlePointerDown = () => {
        lastPointerDownTime = Date.now()
      }
      // 合并同一笔画产生的多个 draw shape（tldraw 原生行为会分割长笔画）
      const mergeDrawShapes = () => {
        try {
          const shapes = editor.getCurrentPageShapes()
          const drawShapes = shapes.filter(s => s.type === 'draw')
          
          if (drawShapes.length <= 1) return
          
          // 按创建时间排序，找出最近创建的连续 draw shapes
          const sortedDraws = drawShapes
            .map(s => ({ shape: s, createdAt: (s as any).createdAt || 0 }))
            .sort((a, b) => a.createdAt - b.createdAt)
          
          // 检查最近创建的 draw shapes 是否在短时间内创建（可能是同一笔画）
          const recentDraws = sortedDraws.slice(-5) // 检查最近 5 个
          const now = Date.now()
          const timeWindow = 2000 // 2 秒内的 draw shapes 视为同一笔画
          
          const sameStrokeDraws = recentDraws.filter(d => {
            const age = now - d.createdAt
            return age < timeWindow
          })
          
          if (sameStrokeDraws.length <= 1) return
          
          if (import.meta.env.DEV) {
            console.log('[协同] 检测到同一笔画的多个 draw shape，尝试合并:', sameStrokeDraws.length)
          }
          
          // 注意：tldraw 的 draw shape 合并比较复杂，需要合并 segments
          // 这里只是记录日志，实际合并需要更复杂的逻辑
          // 可以考虑在绘制完成后，通过 editor.updateShape 手动合并 segments
        } catch (e) {
          if (import.meta.env.DEV) {
            console.warn('[协同] 合并 draw shapes 失败:', e)
          }
        }
      }

      const handlePointerUp = () => {
        // 指针抬起后，等待一小段时间确保绘制完成，然后发送暂存的 diff
        if (import.meta.env.DEV && pendingDiff) {
          console.log('[协同] 指针抬起，准备发送暂存的 draw diff')
        }
        
        // 尝试合并同一笔画的多个 draw shape
        setTimeout(() => {
          mergeDrawShapes()
        }, 200)
        
        if (pendingDiff && flushPendingTimer == null) {
          // 清除之前的定时器（如果有）
          if (flushPendingTimer != null) {
            window.clearTimeout(flushPendingTimer)
          }
          flushPendingTimer = window.setTimeout(() => {
            flushPendingDiffWhenIdle()
          }, 100) // 增加到 100ms，确保绘制完全完成
        }
      }

      // 绑定指针事件监听器
      const container = editor.getContainer()
      if (container) {
        container.addEventListener('pointerdown', handlePointerDown)
        container.addEventListener('pointerup', handlePointerUp)
        container.addEventListener('pointercancel', handlePointerUp)
      }

      const unlisten = editor.store.listen(
        (entry: any) => {
          // 双重检查：确保是 user source 且不在应用远程变更
          if (applyingRemoteRef.current) {
            return
          }
          
          // 严格检查 source，只处理 'user' 来源的变更
          if (entry.source !== 'user') {
            return
          }
          
          const diff = entry.changes as RecordsDiff<any>
          if (!diff || isRecordsDiffEmpty(diff)) {
            return
          }

          // 检查是否是 draw 类型的变更（画笔绘制）
          const isDrawChange = hasDrawShape(diff)
          const isPointerDown = Boolean((editor as any)?.inputs?.isPointerDown)
          
          // 检测当前工具是否是 draw 工具（更可靠的检测方式）
          const currentToolId = (editor as any)?.getCurrentTool?.()?.id || ''
          const isDrawTool = currentToolId === 'draw' || currentToolId === 'drawing'
          
          if (import.meta.env.DEV && isDrawChange) {
            console.log('[协同] Draw 变更检测:', {
              isDrawChange,
              isPointerDown,
              isDrawTool,
              currentToolId,
              hasPendingDiff: !!pendingDiff,
              diffSize: getDiffSize(diff),
              diffKeys: {
                added: diff.added ? Object.keys(diff.added) : [],
                updated: diff.updated ? Object.keys(diff.updated) : [],
                removed: diff.removed ? Object.keys(diff.removed) : []
              }
            })
          }
          
          // 如果是 draw 类型的变更，无论指针状态如何，都延迟发送
          // 因为 tldraw 可能在绘制过程中多次更新，即使 isPointerDown 为 false
          // 我们需要等待一段时间，确保绘制完全完成后再发送
          if (isDrawChange) {
            // 用户正在绘制或刚完成绘制，暂存 diff，等待绘制完成后发送完整线条
            if (pendingDiff) {
              // 合并多个 diff（使用 squashRecordDiffs）
              pendingDiff = squashRecordDiffs([pendingDiff, diff])
              if (import.meta.env.DEV) {
                console.log('[协同] 合并 draw diff，暂存中...')
              }
            } else {
              pendingDiff = diff
              if (import.meta.env.DEV) {
                console.log('[协同] 暂存 draw diff，等待绘制完成')
              }
            }
            
            // 不在绘制过程中发送，等松手后再发（否则长笔画会被拆成多段）
            // 如果指针已抬起，等待更短时间；如果还在按下，等待更长时间
            const delay = isPointerDown || isDrawTool ? 300 : 150
            if (flushPendingTimer != null) {
              window.clearTimeout(flushPendingTimer)
            }
            flushPendingTimer = window.setTimeout(flushPendingDiffWhenIdle, delay)
            return
          }

          // 非 draw 类型或指针已抬起，立即处理（合并暂存的 diff）
          let diffToSend = diff
          if (pendingDiff) {
            diffToSend = squashRecordDiffs([pendingDiff, diff])
            pendingDiff = null
            // 清除等待定时器，因为现在要立即发送
            if (flushPendingTimer != null) {
              window.clearTimeout(flushPendingTimer)
              flushPendingTimer = null
            }
          }

          // 性能优化：如果 diff 过大，直接发送 snapshot 而不是 diff（避免卡顿）
          const diffSize = getDiffSize(diffToSend)
          if (diffSize > MAX_DIFF_RECORDS) {
            // 超大变更直接发送 snapshot，避免 diff 序列化/反序列化开销
            sendSnapshot()
            return
          }

          // 节流：避免频繁发送，合并短时间内的多个变更
          if (sendDiffTimer != null) {
            window.clearTimeout(sendDiffTimer)
          }
          
          sendDiffTimer = window.setTimeout(() => {
            sendDiffTimer = null
            sendDiff(diffToSend)

            // 兜底：在短时间无更多变更后发送一次 snapshot，保证服务器有较新快照供新客户端 init
            if (pendingSnapshotTimerRef.current != null) {
              window.clearTimeout(pendingSnapshotTimerRef.current)
            }
            pendingSnapshotTimerRef.current = window.setTimeout(() => {
              pendingSnapshotTimerRef.current = null
              sendSnapshot()
            }, 1000) // 1秒后发送 snapshot（降低频率）
          }, 16) // 16ms 节流（约 60fps），合并短时间内的多个变更
        },
        { source: 'user', scope: 'document' }
      )

      return () => {
        unlisten()
        // 移除指针事件监听器
        const container = editor.getContainer()
        if (container) {
          container.removeEventListener('pointerdown', handlePointerDown)
          container.removeEventListener('pointerup', handlePointerUp)
          container.removeEventListener('pointercancel', handlePointerUp)
        }
        // 清理所有定时器
        if (sendDiffTimer != null) {
          window.clearTimeout(sendDiffTimer)
        }
        if (flushPendingTimer != null) {
          window.clearTimeout(flushPendingTimer)
        }
        if (pendingSnapshotTimerRef.current != null) {
          window.clearTimeout(pendingSnapshotTimerRef.current)
        }
        if (applyDiffsTimerRef.current != null) {
          cancelAnimationFrame(applyDiffsTimerRef.current)
        }
      }
    }
  }, [])

  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}?boardId=${boardId}`)
    wsRef.current = ws

    ws.onopen = () => {
      // 连接建立（已移除调试日志）
    }

    ws.onerror = (error) => {
      console.error('[WebSocket] 连接错误:', error)
    }

    ws.onmessage = (event) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(event.data)
      } catch (e) {
        console.error('[WebSocket] 解析消息失败:', e)
        return
      }

      if (msg.type === 'init') {
        const snap = msg.snapshot ?? null
        const editor = editorRef.current
        if (snap && editor) {
          applyingRemoteRef.current = true
          editor.loadSnapshot({ document: snap }, { forceOverwriteSessionState: true })
          applyingRemoteRef.current = false
        } else if (snap) {
          pendingSnapshotRef.current = snap
        }
      } else if (msg.type === 'snapshot') {
        // 忽略自己发出的回显，避免本地工具状态被远端消息打断
        if (msg.clientId && msg.clientId === clientIdRef.current) {
          return
        }
        
        // 如果收到 snapshot，应用它（作为 diff 的兜底或超大变更的降级方案）
        const snap = msg.snapshot ?? null
        const editor = editorRef.current
        if (snap && editor) {
          try {
            applyingRemoteRef.current = true
            // 使用 mergeRemoteChanges 确保变更标记为 remote，不会被监听器捕获
            editor.store.mergeRemoteChanges(() => {
              editor.loadSnapshot({ document: snap }, { forceOverwriteSessionState: false })
            })
          } finally {
            // 延迟重置，确保所有变更都完成
            setTimeout(() => {
              applyingRemoteRef.current = false
            }, 0)
          }
        }
      } else if (msg.type === 'diff') {
        if (msg.clientId && msg.clientId === clientIdRef.current) {
          return // 忽略自己发出的 diff
        }
        
        const editor = editorRef.current
        if (!editor || !msg.diff) {
          return
        }

        // 验证并修复 diff 结构（确保 updated 字段是 [from, to] 元组格式）
        const diff = msg.diff as RecordsDiff<any>
        if (diff.updated) {
          for (const [id, value] of Object.entries(diff.updated)) {
            if (!Array.isArray(value) || value.length !== 2) {
              const existing = editor.store.get(id as any)
              if (existing) {
                diff.updated[id as any] = [existing, value]
          } else {
                delete diff.updated[id]
              }
            }
          }
        }

        // 性能优化：如果单个 diff 过大，直接忽略（等待 snapshot 兜底机制）
        const diffSize = getDiffSize(diff)
        if (diffSize > MAX_DIFF_RECORDS) {
          // 超大 diff 直接忽略，等待 snapshot 兜底（1秒后自动发送）
          return
        }

        // 将 diff 加入待应用队列，批量合并应用（性能优化）
        pendingDiffsRef.current.push(diff)
        
        // 使用 requestAnimationFrame 批量应用，避免每帧多次渲染
        if (applyDiffsTimerRef.current == null) {
          applyDiffsTimerRef.current = requestAnimationFrame(() => {
            applyDiffsTimerRef.current = null
            
            const editor = editorRef.current
            if (!editor || pendingDiffsRef.current.length === 0) return

            const diffs = pendingDiffsRef.current.splice(0) // 清空队列并获取所有待应用的 diff
            
            // 合并多个 diff 为一个，一次性应用（性能优化）
            const mergedDiff = diffs.length === 1 
              ? diffs[0] 
              : squashRecordDiffs(diffs)
            
            if (isRecordsDiffEmpty(mergedDiff)) {
              return
            }

            // 性能优化：合并后的 diff 如果仍然过大，直接忽略（等待 snapshot 兜底）
            const mergedSize = getDiffSize(mergedDiff)
            if (mergedSize > MAX_DIFF_RECORDS) {
              // 超大合并 diff 直接忽略，等待 snapshot 兜底机制
              return
            }

            try {
              applyingRemoteRef.current = true
              // 对于批量应用，使用 runCallbacks: false 可以减少回调触发，提升性能
              // 但可能影响某些依赖回调的功能，根据实际情况调整
              editor.store.mergeRemoteChanges(() => {
                editor.store.applyDiff(mergedDiff, { runCallbacks: mergedSize < 100 })
              })
              // 延迟重置，确保所有变更都完成且标记为 remote
              setTimeout(() => {
                applyingRemoteRef.current = false
              }, 0)
            } catch (error) {
              console.error('[协同] 应用 diff 失败:', error)
              applyingRemoteRef.current = false
            }
          })
        }
      }
    }

    ws.onclose = () => {
      wsRef.current = null
    }

    return () => {
      ws.close()
      // 清理待应用的 diff 队列和定时器
      pendingDiffsRef.current = []
      if (applyDiffsTimerRef.current != null) {
        cancelAnimationFrame(applyDiffsTimerRef.current)
        applyDiffsTimerRef.current = null
      }
    }
  }, [boardId])

  return (
    <div className="whiteboard-container">
      <div className="tldraw-wrapper">
        <Tldraw onMount={onMount} />
      </div>
    </div>
  )
}
