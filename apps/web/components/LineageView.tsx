'use client';

import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export interface LineageIdea {
  id: string;
  title: string;
  operatorId: string;
  generation: number;
  parentIds: string[];
  selectionState?: string;
}

const OPERATOR_COLORS: Record<string, string> = {
  divergent: '#436a7c',
  analogy: '#a56750',
  inversion: '#527a62',
  recombination: '#8a6d3b',
};

/**
 * Interactive lineage visualization (node-edge diagram). Nodes positioned by
 * generation columns; selection-state shown by border style + label (never
 * color alone).
 */
export function LineageView({
  ideas,
  onSelect,
  selectedId,
}: {
  ideas: LineageIdea[];
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  const { nodes, edges } = useMemo(() => {
    const byGen = new Map<number, LineageIdea[]>();
    for (const idea of ideas) {
      const arr = byGen.get(idea.generation) ?? [];
      arr.push(idea);
      byGen.set(idea.generation, arr);
    }
    const ns: Node[] = [];
    for (const [gen, arr] of byGen) {
      arr.forEach((idea, i) => {
        const color = OPERATOR_COLORS[idea.operatorId] ?? '#6d726c';
        ns.push({
          id: idea.id,
          position: { x: gen * 300, y: i * 110 },
          data: {
            label: `${idea.title.slice(0, 42)}${idea.title.length > 42 ? '…' : ''}`,
          },
          style: {
            border: `1px solid ${color}`,
            borderLeft: `4px solid ${color}`,
            borderRadius: 4,
            background: selectedId === idea.id ? '#eef3f5' : '#fffefb',
            width: 220,
            fontSize: 11,
            padding: 6,
            boxShadow: idea.selectionState === 'selected' ? `0 0 0 1px ${color}` : undefined,
            fontStyle: idea.selectionState === 'selected' ? 'italic' : undefined,
          },
        });
      });
    }
    const es: Edge[] = [];
    for (const idea of ideas) {
      for (const pid of idea.parentIds) {
        es.push({
          id: `${pid}->${idea.id}`,
          source: pid,
          target: idea.id,
          animated: false,
          style: { stroke: '#b9b5a8' },
        });
      }
    }
    return { nodes: ns, edges: es };
  }, [ideas, selectedId]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_e, node) => onSelect(node.id),
    [onSelect]
  );

  if (ideas.length === 0) {
    return (
      <div className="lineage-flow flex items-center justify-center text-xs text-[var(--color-muted)]">
        lineage appears once ideas exist
      </div>
    );
  }

  return (
    <div className="lineage-flow">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={handleNodeClick}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        minZoom={0.2}
      >
        <Background gap={20} color="#e8e6df" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
