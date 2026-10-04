// 泳道式提交图（development-refinement.md §9.1 GitGraph；M4 替换 CommitPanel）
//
// 数据来自 `game/graph/gitGraph.readGraph()`（game 层采集，UI 只渲染 —— §2）。
// SVG 连线：节点按泳道横向定位、按时间纵向排列；parent 关系画竖线/斜线。
// 节点颜色按泳道（= 分支）取 token 变量，对齐 §9.2「代表分支的暖橙/青绿」。

import { useEffect, useState } from 'react'
import { readGraph, type GraphLayout, type GraphTag } from '../../../game/graph/gitGraph'
import styles from './GitGraph.module.css'

export interface GitGraphProps {
  /** 刷新流水号（每条命令执行后自增） */
  version: number
}

/** 泳道配色（按 index 循环取用；与 tokens.css 的分支色对齐） */
const LANE_COLORS = ['#7ee0c8', '#ffb37e', '#a9b8ff', '#ffd76e', '#ff9db1'];

export function GitGraph({ version }: GitGraphProps) {
  const [layout, setLayout] = useState<GraphLayout | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await readGraph()
      if (cancelled) return
      if (result.ok) {
        setLayout(result.layout)
        setFailed(false)
      } else {
        setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [version])

  if (failed) {
    return (
      <section className={styles.panel} data-testid="git-graph">
        <header className={styles.head}>
          <h2 className={styles.title}>提交图</h2>
        </header>
        <p className={styles.empty}>无法读取提交图（仓库尚未就绪）。</p>
      </section>
    )
  }

  const nodes = layout?.nodes ?? []
  const lanes = layout?.lanes ?? []
  const tagsByHash: ReadonlyMap<string, readonly GraphTag[]> = layout?.tagsByHash ?? new Map()
  // 节点 hash → 行下标（连线端点定位用）
  const rowOf = new Map(nodes.map((node, index) => [node.hash, index]))
  const laneX = (lane: number) => 24 + lane * 28

  return (
    <section className={styles.panel} data-testid="git-graph">
      <header className={styles.head}>
        <h2 className={styles.title}>提交图</h2>
        <span className={styles.meta}>{nodes.length} 个提交</span>
      </header>

      {nodes.length === 0 && <p className={styles.empty}>还没有提交记录。</p>}

      {nodes.length > 0 && (
        <svg
          className={styles.svg}
          role="img"
          aria-label={`提交图：${nodes.length} 个提交、${lanes.filter((lane) => lane.label).length} 条分支泳道`}
          width={Math.max(120, laneX(lanes.length + 1))}
          height={nodes.length * 36 + 16}
        >
          {/* 泳道分支名标注 */}
          {lanes.map((lane) =>
            lane.label ? (
              <text
                key={`lane-${lane.index}`}
                className={styles.laneLabel}
                x={laneX(lane.index)}
                y={10}
                fill={LANE_COLORS[lane.index % LANE_COLORS.length]}
              >
                {lane.label}
              </text>
            ) : null,
          )}

          {/* 连线：每个节点画到其各 parent 的线 */}
          {nodes.map((node, index) =>
            node.parents.map((parent, parentIndex) => {
              const parentRow = rowOf.get(parent)
              if (parentRow === undefined) return null
              const parentLane = nodes[parentRow].lane
              const x1 = laneX(node.lane)
              const y1 = 24 + index * 36
              const x2 = laneX(parentLane)
              const y2 = 24 + parentRow * 36
              const color = LANE_COLORS[node.lane % LANE_COLORS.length]
              return (
                <line
                  key={`${node.hash}-${parentIndex}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={color}
                  strokeWidth={2}
                  opacity={0.55}
                />
              )
            }),
          )}

          {/* 节点 */}
          {nodes.map((node, index) => {
            const nodeTags = tagsByHash.get(node.hash) ?? []
            return (
              <g key={node.hash} transform={`translate(${laneX(node.lane)}, ${24 + index * 36})`}>
                <circle
                  cx={0}
                  cy={0}
                  r={6}
                  fill={LANE_COLORS[node.lane % LANE_COLORS.length]}
                  className={styles.node}
                />
                <text className={styles.hash} x={12} y={4}>
                  {node.shortHash}
                </text>
                <text className={styles.message} x={64} y={4}>
                  {node.message}
                </text>
                {/* 标签徽标（M6）：排在提交信息右侧，注解实底 / 轻量描边 */}
                {nodeTags.map((tag, tagIndex) => {
                  // 徽标横向位置：前一枚的估宽 + 间距（标签名短，按 8px/字符估）
                  const offset =
                    64 +
                    node.message.length * 8 +
                    12 +
                    nodeTags.slice(0, tagIndex).reduce((sum, item) => sum + item.name.length * 7 + 18, 0)
                  return (
                    <g key={tag.name} transform={`translate(${offset}, -9)`}>
                      <rect
                        className={tag.annotated ? styles.tagAnnotated : styles.tagLight}
                        width={tag.name.length * 7 + 12}
                        height={16}
                        rx={8}
                      />
                      <text
                        className={tag.annotated ? styles.tagAnnotatedText : styles.tagLightText}
                        x={6}
                        y={11.5}
                      >
                        {tag.name}
                      </text>
                    </g>
                  )
                })}
              </g>
            )
          })}
        </svg>
      )}
    </section>
  )
}
