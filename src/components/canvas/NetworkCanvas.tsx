'use client';

import React, { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Node,
  Edge,
  Connection,
  ConnectionMode,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useNetworkStore } from '../../store/useNetworkStore';
import { NetworkNode } from '../../engine/types';
import { RouterNode } from './RouterNode';
import { SwitchNode } from './SwitchNode';
import { HostNode } from './HostNode';
import { CustomEdge } from './CustomEdge';

const nodeTypes = {
  router: RouterNode,
  switch: SwitchNode,
  host: HostNode,
};

const edgeTypes = {
  custom: CustomEdge,
  straight: CustomEdge,
};

export const NetworkCanvas: React.FC = () => {
  const isDarkMode = useNetworkStore(state => state.isDarkMode);
  const nodes = useNetworkStore(state => state.nodes);
  const links = useNetworkStore(state => state.links);
  const selectedNodeId = useNetworkStore(state => state.selectedNodeId);
  const selectNode = useNetworkStore(state => state.selectNode);
  const openTerminal = useNetworkStore(state => state.openTerminal);
  const updateNodePosition = useNetworkStore(state => state.updateNodePosition);
  const addLink = useNetworkStore(state => state.addLink);
  const removeNode = useNetworkStore(state => state.removeNode);
  const removeLink = useNetworkStore(state => state.removeLink);
  const isSidebarCollapsed = useNetworkStore(state => state.isSidebarCollapsed);

  // Convert zustand nodes to React Flow nodes
  const flowNodes: Node[] = useMemo(() => {
    return Object.values(nodes).map(node => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: { node },
      selected: node.id === selectedNodeId,
    }));
  }, [nodes, selectedNodeId]);

  // Convert zustand links to React Flow edges (Straight lines)
  const flowEdges: Edge[] = useMemo(() => {
    return links.map(link => ({
      id: link.id,
      source: link.source,
      target: link.target,
      type: 'straight',
      style: { stroke: '#64748b', strokeWidth: 2 },
      data: {
        sourceHandle: link.sourceHandle,
        targetHandle: link.targetHandle,
        status: link.status,
        latency: link.latency,
      },
    }));
  }, [links]);

  // Real-time live dragging of nodes
  const onNodeDrag = useCallback((_: MouseEvent | TouchEvent, node: Node) => {
    updateNodePosition(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) });
  }, [updateNodePosition]);

  const onNodeDragStop = useCallback((_: MouseEvent | TouchEvent, node: Node) => {
    updateNodePosition(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) });
  }, [updateNodePosition]);

  // Manual interactive cable wiring
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return; // Prevent self-loops

    const sourceNode = nodes[connection.source];
    const targetNode = nodes[connection.target];
    if (!sourceNode || !targetNode) return;

    // Allocate next available physical port
    const getNextFreePort = (node: NetworkNode) => {
      const isHost = node.type === 'host';
      const prefix = `${node.name}-eth`;
      let num = isHost ? 0 : 1;
      while (true) {
        const candidate = `${prefix}${num}`;
        const inUse = links.some(
          l => (l.source === node.id && (l.sourceHandle === candidate || l.sourceHandle === `eth${num}`)) ||
               (l.target === node.id && (l.targetHandle === candidate || l.targetHandle === `eth${num}`))
        );
        if (!inUse) return candidate;
        num++;
      }
    };

    const sourcePort = getNextFreePort(sourceNode);
    const targetPort = getNextFreePort(targetNode);

    // Initialize interface objects if missing
    if (!sourceNode.interfaces[sourcePort]) {
      sourceNode.interfaces[sourcePort] = {
        name: sourcePort,
        mac: `00:00:00:${Math.floor(Math.random() * 90 + 10)}:${Math.floor(Math.random() * 90 + 10)}:01`,
        up: true,
        ospfCost: 10
      };
    }
    if (!targetNode.interfaces[targetPort]) {
      targetNode.interfaces[targetPort] = {
        name: targetPort,
        mac: `00:00:00:${Math.floor(Math.random() * 90 + 10)}:${Math.floor(Math.random() * 90 + 10)}:02`,
        up: true,
        ospfCost: 10
      };
    }

    const newLinkId = `link-${connection.source}-${sourcePort}-${connection.target}-${targetPort}-${Date.now().toString().slice(-4)}`;
    addLink({
      id: newLinkId,
      source: connection.source,
      sourceHandle: sourcePort,
      target: connection.target,
      targetHandle: targetPort,
      status: 'up',
      latency: 0.3,
      type: 'straight',
      style: { stroke: '#64748b', strokeWidth: 2 }
    });
  }, [nodes, links, addLink]);

  return (
    <div className="w-full h-full relative overflow-hidden">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        deleteKeyCode={['Backspace', 'Delete']}
        onNodesDelete={(deletedNodes) => {
          deletedNodes.forEach(n => removeNode(n.id));
        }}
        onEdgesDelete={(deletedEdges) => {
          deletedEdges.forEach(e => removeLink(e.id));
        }}
        onNodeClick={(_, node) => {
          selectNode(node.id);
          openTerminal(node.id);
        }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2.0}
        defaultEdgeOptions={{
          type: 'straight',
          style: { stroke: '#64748b', strokeWidth: 2 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        {/* Garis kisi-kisi grid nyata di latar belakang canvas (Hero Grid) */}
        <Background
          variant={BackgroundVariant.Lines}
          gap={32}
          size={1}
          color={isDarkMode ? '#1e293b' : '#cbd5e1'}
          className={isDarkMode ? 'bg-[#090d16]' : 'bg-[#f8fafc]'}
        />

        {/* Clean Controls docked at bottom-left */}
        <Controls
          position="bottom-left"
          className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 shadow-sm rounded-md fill-slate-700 dark:fill-slate-200 [&>button]:border-slate-200 dark:[&>button]:border-slate-700 [&>button]:fill-slate-700 dark:[&>button]:fill-slate-200"
        />
      </ReactFlow>

      {/* Floating Canvas Helper Info in Clean Theme */}
      <div
        className={`absolute top-3 ${
          isSidebarCollapsed ? 'left-28' : 'left-3'
        } pointer-events-none select-none bg-white/90 dark:bg-slate-900/90 backdrop-blur-xs px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-2 shadow-xs transition-all`}
      >
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        <span>Click node to open terminal • Pull ports to wire cables • Delete key to remove node</span>
      </div>
    </div>
  );
};
