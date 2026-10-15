'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { NetworkNode } from '../../engine/types';
import { useNetworkStore } from '../../store/useNetworkStore';
import { NodeTooltip } from './NodeTooltip';

interface SwitchNodeProps {
  data: {
    node: NetworkNode;
  };
  selected: boolean;
}

export const SwitchNode: React.FC<SwitchNodeProps> = ({ data, selected }) => {
  const { node } = data;
  const selectNode = useNetworkStore(state => state.selectNode);
  const openTerminal = useNetworkStore(state => state.openTerminal);
  const removeNode = useNetworkStore(state => state.removeNode);

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
          title={`Hapus switch ${node.name}`}
        >
          ✕
        </button>
      )}

      {/* Interactive Drag Handles (Cardinal Ports, visible on hover) */}
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        className="!w-2.5 !h-2.5 !bg-amber-500 !border-2 !border-white dark:!border-slate-900 !rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair z-30"
        style={{ top: '-3px' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!w-2.5 !h-2.5 !bg-amber-500 !border-2 !border-white dark:!border-slate-900 !rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair z-30"
        style={{ right: '-3px', top: '24px' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!w-2.5 !h-2.5 !bg-amber-500 !border-2 !border-white dark:!border-slate-900 !rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair z-30"
        style={{ bottom: '20px' }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        className="!w-2.5 !h-2.5 !bg-amber-500 !border-2 !border-white dark:!border-slate-900 !rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair z-30"
        style={{ left: '-3px', top: '24px' }}
      />

      {/* Centered target handle for straight cables */}
      <Handle
        type="target"
        position={Position.Top}
        id="center"
        className="!w-1 !h-1 !opacity-0 !border-none !pointer-events-none"
        style={{ top: '24px', left: '50%', transform: 'translate(-50%, -50%)' }}
      />

      {/* Clean 48px Circle in Mininet Amber/Orange */}
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center bg-amber-500 border-2 border-amber-600 text-white shadow-sm transition-all duration-150 group-hover:scale-105 ${
          isSelected
            ? 'ring-3 ring-amber-500/60 ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-900'
            : 'hover:shadow-md'
        }`}
      >
        {/* Switch Icon: Horizontal Bi-directional Arrows */}
        <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current" strokeWidth="0">
          <path d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm0 2v8h16V8H4z" />
          <path d="M6 10h4v1.5H6zm8 0h4v1.5h-4zm-8 3h4v1.5H6zm8 0h4v1.5h-4z" />
        </svg>
      </div>

      {/* Node Name Label Below Circle */}
      <div className="mt-2.5 text-xs font-semibold text-slate-800 dark:text-slate-200 bg-white/95 dark:bg-slate-800/95 px-2 py-0.5 rounded shadow-xs border border-slate-200 dark:border-slate-700 tracking-tight select-none text-center whitespace-nowrap">
        {node.name}
      </div>
    </div>
  );
};
