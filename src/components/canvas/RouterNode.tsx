'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { NetworkNode } from '../../engine/types';
import { useNetworkStore } from '../../store/useNetworkStore';
import { NodeTooltip } from './NodeTooltip';

interface RouterNodeProps {
  data: {
    node: NetworkNode;
  };
  selected: boolean;
}

export const RouterNode: React.FC<RouterNodeProps> = ({ data, selected }) => {
  const { node } = data;
  const selectNode = useNetworkStore(state => state.selectNode);
  const openTerminal = useNetworkStore(state => state.openTerminal);
  const removeNode = useNetworkStore(state => state.removeNode);

  const isCore = node.role === 'core';
  const isSelected = selected;

  return (
    <div
      onClick={() => {
        selectNode(node.id);
        openTerminal(node.id);
      }}
      className="group relative flex flex-col items-center justify-center cursor-pointer select-none"
    >
      {/* Floating Hover Tooltip */}
      <NodeTooltip node={node} />

      {/* Quick Delete Button on Selected Node */}
      {isSelected && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeNode(node.id);
          }}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center text-[10px] font-bold shadow-sm transition-all z-40 cursor-pointer"
          title={`Hapus node ${node.name}`}
        >
          ✕
        </button>
      )}

      {/* Interactive Drag Handles (Cardinal Ports, visible on hover) */}
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        className="!w-2.5 !h-2.5 !bg-blue-500 dark:!bg-blue-400 !border-2 !border-white dark:!border-slate-900 !rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair z-30"
        style={{ top: '-3px' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!w-2.5 !h-2.5 !bg-blue-500 dark:!bg-blue-400 !border-2 !border-white dark:!border-slate-900 !rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair z-30"
        style={{ right: '-3px', top: isCore ? '26px' : '24px' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!w-2.5 !h-2.5 !bg-blue-500 dark:!bg-blue-400 !border-2 !border-white dark:!border-slate-900 !rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair z-30"
        style={{ bottom: '20px' }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        className="!w-2.5 !h-2.5 !bg-blue-500 dark:!bg-blue-400 !border-2 !border-white dark:!border-slate-900 !rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair z-30"
        style={{ left: '-3px', top: isCore ? '26px' : '24px' }}
      />

      {/* Centered target/source handles for default straight-line edge routing */}
      <Handle
        type="target"
        position={Position.Top}
        id="center"
        className="!w-1 !h-1 !opacity-0 !border-none !pointer-events-none"
        style={{ top: isCore ? '26px' : '24px', left: '50%', transform: 'translate(-50%, -50%)' }}
      />

      {/* Clean Circular Node (Core 52px, Edge 48px) */}
      <div
        className={`flex items-center justify-center rounded-full text-white shadow-sm transition-all duration-150 group-hover:scale-105 ${
          isCore
            ? 'w-[52px] h-[52px] bg-blue-600 border-2 border-blue-700'
            : 'w-12 h-12 bg-sky-500 border-2 border-sky-600'
        } ${
          isSelected
            ? 'ring-3 ring-blue-500/60 ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-900'
            : 'hover:shadow-md'
        }`}
      >
        {/* Classic Router 4-Arrow Icon */}
        <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current" strokeWidth="0">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
          <path d="M7 11h3.59L8.3 8.71 9.71 7.3 14.41 12l-4.7 4.7-1.41-1.41L10.59 13H7v-2zm10 2h-3.59l2.29 2.29-1.41 1.41L9.59 12l4.7-4.7 1.41 1.41L13.41 11H17v2z" />
        </svg>
      </div>

      {/* Node Name Label Below Circle */}
      <div className="mt-2.5 text-xs font-semibold text-slate-800 dark:text-slate-200 bg-white/95 dark:bg-slate-800/95 px-2 py-0.5 rounded shadow-xs border border-slate-200 dark:border-slate-700 tracking-tight select-none text-center whitespace-nowrap">
        {node.name}
      </div>
    </div>
  );
};
