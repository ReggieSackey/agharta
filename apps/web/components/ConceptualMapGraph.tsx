'use client';

/**
 * Interactive conceptual-map visualization (brief §10).
 *
 * - 2D layout is a deterministic projection for EXPLORATION only — the
 *   displayed geometry does not capture every learned dimension (stated in
 *   the UI). Edges carry the actual learned compatibility + evidence.
 * - Clicking a node/edge opens the evidence panel: which learning runs moved
 *   it, α/β counts, last-update provenance.
 */
import { useMemo, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  type Node, type Edge, type NodeMouseHandler, type EdgeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export interface MapNodeLite {
  id: string;
  kind: 'structure_tag' | 'mechanism' | 'transfer_type';
  label: string;
}
export interface MapEdgeLite {
  from: string;
  to: string;
  compatibility: number;
  alpha: number;
  beta: number;
  automatedEvidenceCount: number;
  humanEvidenceCount: number;
  lastUpdatedByLearningRun?: string;
}

interface Props {
  nodes: MapNodeLite[];
  edges: MapEdgeLite[];
}

/** Deterministic circular layout: tags inner ring, mechanisms outer ring. */
function project(nodes: MapNodeLite[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const tags = nodes.filter((n) => n.kind === 'structure_tag');
  const mechs = nodes.filter((n) => n.kind === 'mechanism');
  const place = (arr: typeof nodes, cx: number, cy: number, r: number, phase: number) => {
    arr.forEach((n, i) => {
      const θ = phase + (2 * Math.PI * i) / arr.length;
      pos.set(n.id, { x: cx + r * Math.cos(θ), y: cy + r * Math.sin(θ) });
    });
  };
  place(tags, 0, 0, 200, 0);
  place(mechs, 0, 0, 460, (2 * Math.PI) / (2 * Math.max(mechs.length, 1)));
  return pos;
}

const kindColor: Record<MapNodeLite['kind'], string> = {
  structure_tag: '#2563eb',
  mechanism: '#059669',
  transfer_type: '#9333ea',
};

export function ConceptualMapGraph({ nodes, edges }: Props) {
  const [selectedNode, setSelectedNode] = useState<MapNodeLite | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<MapEdgeLite | null>(null);

  const { flowNodes, flowEdges, pos } = useMemo(() => {
    const p = project(nodes);
    const fn: Node[] = nodes.map((n) => ({
      id: n.id,
      position: p.get(n.id) ?? { x: 0, y: 0 },
      data: { label: n.label },
      style: {
        fontSize: 10,
        width: 120,
        background: selectedNode?.id === n.id ? '#fef3c7' : '#fff',
        border: `1px solid ${kindColor[n.kind]}`,
        borderRadius: 6,
        padding: 4,
      },
    }));
    // only draw edges with some evidence or above-neutral compatibility
    const fe: Edge[] = edges
      .filter((e) => e.automatedEvidenceCount + e.humanEvidenceCount > 0 || Math.abs(e.compatibility - 0.5) > 0.08)
      .map((e) => ({
        id: `${e.from}→${e.to}`,
        source: e.from,
        target: e.to,
        animated: selectedEdge && selectedEdge.from === e.from && selectedEdge.to === e.to ? true : false,
        style: {
          stroke: e.compatibility >= 0.5 ? '#059669' : '#dc2626',
          strokeWidth: 1 + Math.min(4, e.automatedEvidenceCount + e.humanEvidenceCount) * 0.6,
          opacity: 0.35 + Math.abs(e.compatibility - 0.5) * 1.4,
        },
      }));
    return { flowNodes: fn, flowEdges: fe, pos: p };
  }, [nodes, edges, selectedNode, selectedEdge]);

  const onNodeClick: NodeMouseHandler = (_, node) => {
    const n = nodes.find((x) => x.id === node.id) ?? null;
    setSelectedNode(n);
    setSelectedEdge(null);
  };

  const onEdgeClick: EdgeMouseHandler = (_, edge) => {
    const from = edge.source;
    const to = edge.target;
    const e = edges.find((x) => x.from === from && x.to === to) ?? null;
    setSelectedEdge(e);
    setSelectedNode(null);
  };

  const nodeEdges = selectedNode
    ? edges.filter((e) => e.from === selectedNode.id || e.to === selectedNode.id)
    : [];

  return (
    <div>
      <p className="text-[11px] text-neutral-400 mb-2">
        2D positions are a readability projection, not the learned space. Click a node or edge to
        inspect the evidence behind it. Green = learned compatibility &gt; 0.5, red &lt; 0.5;
        thickness = evidence count. Thin gray edges are near-prior.
      </p>
      <div className="border rounded" style={{ height: 480 }}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          fitView
          proOptions={{ hideAttribution: true }}
          nodesDraggable
        >
          <Background gap={24} />
          <MiniMap pannable zoomable />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {(selectedNode || selectedEdge) && (
        <div className="border rounded p-4 mt-3 bg-neutral-50">
          {selectedNode && (
            <div>
              <p className="text-sm font-semibold">{selectedNode.label}</p>
              <p className="text-[11px] text-neutral-500 mb-2">
                {selectedNode.kind} · <span className="font-mono">{selectedNode.id}</span>
              </p>
              {nodeEdges.length === 0 ? (
                <p className="text-xs text-neutral-400">No learned edges touch this node yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      <th className="py-1">relation</th>
                      <th>compat</th>
                      <th>evidence</th>
                      <th>updated by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodeEdges.slice(0, 10).map((e) => (
                      <tr key={`${e.from}→${e.to}`} className="border-t">
                        <td className="py-1 font-mono text-[10px]">
                          {e.from === selectedNode.id ? `→ ${e.to}` : `← ${e.from}`}
                        </td>
                        <td className={e.compatibility >= 0.5 ? 'text-green-700' : 'text-red-700'}>
                          {e.compatibility.toFixed(2)}
                        </td>
                        <td className="text-neutral-500">
                          α{e.alpha.toFixed(1)} β{e.beta.toFixed(1)} · {e.automatedEvidenceCount}a/{e.humanEvidenceCount}h
                        </td>
                        <td className="text-neutral-400 font-mono text-[10px]">
                          {e.lastUpdatedByLearningRun?.split(':')[0] ?? 'seed'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {selectedEdge && (
            <div>
              <p className="text-sm font-semibold">
                <span className="font-mono text-xs">{selectedEdge.from.replace('tag:', '')}</span>
                <span className="mx-2 text-neutral-400">→</span>
                <span className="font-mono text-xs">{selectedEdge.to}</span>
              </p>
              <p className="text-xs mt-1">
                learned compatibility <b>{selectedEdge.compatibility.toFixed(3)}</b> · posterior α
                {selectedEdge.alpha.toFixed(1)} β{selectedEdge.beta.toFixed(1)} · evidence{' '}
                {selectedEdge.automatedEvidenceCount} automated / {selectedEdge.humanEvidenceCount} human
              </p>
              <p className="text-[11px] text-neutral-400 mt-1">
                last update: {selectedEdge.lastUpdatedByLearningRun ?? 'seed library'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
