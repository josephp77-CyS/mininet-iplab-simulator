'use client';

import React, { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getStraightPath } from '@xyflow/react';

interface CustomEdgeData {
  sourceHandle?: string;
  targetHandle?: string;
  latency?: number;
  status?: 'up' | 'down';
}

export const CustomEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style = {},
  markerEnd,
  data,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  const edgeData = (data || {}) as CustomEdgeData;
  const isUp = edgeData.status !== 'down';
  const sourceHandle = edgeData.sourceHandle || 'eth1';
  const targetHandle = edgeData.targetHandle || 'eth1';

  return (
    <>
      {/* Invisible wider stroke for easy hover trigger */}
      <path
        d={edgePath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={16}
        className="cursor-pointer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />

      {/* Solid straight slate cable (stroke #64748b, strokeWidth 2) */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        className="react-flow__edge-path"
        style={{
          ...style,
          stroke: isUp ? (isHovered ? '#2563eb' : '#64748b') : '#dc2626',
          strokeWidth: isHovered ? 3 : 2,
          transition: 'stroke 0.15s, stroke-width 0.15s',
        }}
      />

      {/* Edge interface mapping label on hover */}
      {isHovered && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className="transition-all duration-150 z-20"
          >
            <div className="bg-white/95 dark:bg-slate-800/95 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 text-[10px] px-2 py-0.5 rounded shadow-md font-mono whitespace-nowrap flex items-center gap-1.5">
              <span className="font-semibold text-blue-600 dark:text-blue-400">{sourceHandle}</span>
              <span className="text-slate-400">⟷</span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">{targetHandle}</span>
              {edgeData.latency && (
                <span className="text-slate-400 text-[9px] border-l border-slate-200 dark:border-slate-700 pl-1">
                  {edgeData.latency}ms
                </span>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
