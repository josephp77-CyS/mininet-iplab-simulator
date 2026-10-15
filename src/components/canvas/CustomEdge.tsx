'use client';

import React, { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getStraightPath } from '@xyflow/react';
import { useNetworkStore } from '../../store/useNetworkStore';
import { resolveInterfaceName, parseIpv4Cidr, areIpsInSameSubnet } from '../../engine/ipUtils';
import { 
  ArrowLeftRight, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Info,
  Server,
  Monitor,
  Network as SwitchIcon,
} from 'lucide-react';

interface CustomEdgeData {
  sourceHandle?: string;
  targetHandle?: string;
  latency?: number;
  status?: 'up' | 'down';
}

export const CustomEdge: React.FC<EdgeProps> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style = {},
  markerEnd,
  data,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // Access network store for live node and interface details
  const nodes = useNetworkStore(state => state.nodes);
  const isDarkMode = useNetworkStore(state => state.isDarkMode);

  const [edgePath] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  const edgeData = (data || {}) as CustomEdgeData;
  const isUp = edgeData.status !== 'down';

  // Get nodes at both ends
  const sourceNode = nodes[source];
  const targetNode = nodes[target];

  // Resolve interface names
  const rawSourcePort = edgeData.sourceHandle || (sourceNode ? `${sourceNode.name}-eth1` : 'eth1');
  const rawTargetPort = edgeData.targetHandle || (targetNode ? `${targetNode.name}-eth1` : 'eth1');

  const resolvedSourcePort = sourceNode ? resolveInterfaceName(sourceNode, rawSourcePort) : rawSourcePort;
  const resolvedTargetPort = targetNode ? resolveInterfaceName(targetNode, rawTargetPort) : rawTargetPort;

  const sourceIntf = sourceNode?.interfaces[resolvedSourcePort];
  const targetIntf = targetNode?.interfaces[resolvedTargetPort];

  // Diagnostics & Troubleshooting Engine
  let diagStatus: 'success' | 'warning' | 'error' | 'info' = 'success';
  let diagTitle = 'Koneksi Normal';
  let diagMessage = 'Jalur fisik dan antarmuka aktif.';

  const sourceIpCidr = sourceIntf?.ip;
  const targetIpCidr = targetIntf?.ip;
  const sourceCidr = sourceIpCidr ? parseIpv4Cidr(sourceIpCidr) : null;
  const targetCidr = targetIpCidr ? parseIpv4Cidr(targetIpCidr) : null;

  // Check 1: Interface UP/DOWN
  if ((sourceIntf && !sourceIntf.up) || (targetIntf && !targetIntf.up)) {
    diagStatus = 'error';
    const downPort = !sourceIntf?.up ? `${sourceNode?.name}:${resolvedSourcePort}` : `${targetNode?.name}:${resolvedTargetPort}`;
    diagTitle = 'Port DOWN';
    diagMessage = `${downPort} mati. Jalankan "no shutdown" atau "ip link set up".`;
  }
  // Check 2: Switch Connection & VLAN Isolation
  else if (sourceNode?.type === 'switch' || targetNode?.type === 'switch') {
    diagStatus = 'info';
    const switchNode = sourceNode?.type === 'switch' ? sourceNode : targetNode;
    const switchIntf = sourceNode?.type === 'switch' ? sourceIntf : targetIntf;
    const vlan = switchIntf?.vlanTag;

    if (vlan && vlan !== 1) {
      diagTitle = `VLAN ${vlan} (Access Port)`;
      diagMessage = `${switchNode?.name}:${switchIntf?.name} isolasi ke VLAN ${vlan}.`;
    } else {
      diagTitle = 'Trunk / Uplink Port';
      diagMessage = `${switchNode?.name}:${switchIntf?.name} meneruskan semua VLAN ke Core.`;
    }
  }
  // Check 3: Both L3 Endpoints have IP (Subnet Match Check)
  else if (sourceCidr && targetCidr) {
    const isSameSubnet = sourceCidr.prefix === targetCidr.prefix && areIpsInSameSubnet(sourceCidr.ip, targetCidr.ip, sourceCidr.prefix);

    if (isSameSubnet) {
      diagStatus = 'success';
      diagTitle = `Subnet Cocok: ${sourceCidr.network}/${sourceCidr.prefix}`;
      diagMessage = 'Direct L3 link OK • Ping lokal dijamin tembus.';

      // Check Host Default Gateway
      const hostNode = sourceNode?.type === 'host' ? sourceNode : (targetNode?.type === 'host' ? targetNode : null);
      const routerCidr = sourceNode?.type === 'host' ? targetCidr : sourceCidr;
      if (hostNode && routerCidr) {
        if (!hostNode.defaultGateway) {
          diagStatus = 'warning';
          diagTitle = 'Host Tanpa Gateway';
          diagMessage = `${hostNode.name} butuh: "ip route add default via ${routerCidr.ip}"`;
        } else if (hostNode.defaultGateway !== routerCidr.ip) {
          diagStatus = 'warning';
          diagTitle = 'Gateway Host Berbeda';
          diagMessage = `GW ${hostNode.name} (${hostNode.defaultGateway}) ≠ IP router (${routerCidr.ip}).`;
        }
      }
    } else {
      diagStatus = 'error';
      diagTitle = 'Subnet Mismatch!';
      diagMessage = `${sourceCidr.network}/${sourceCidr.prefix} ≠ ${targetCidr.network}/${targetCidr.prefix} • Ping lokal gagal.`;
    }
  }
  // Check 4: Missing IP on one or both endpoints
  else if (!sourceCidr || !targetCidr) {
    diagStatus = 'warning';
    const missingNode = !sourceCidr ? sourceNode?.name : targetNode?.name;
    const missingPort = !sourceCidr ? resolvedSourcePort : resolvedTargetPort;
    diagTitle = 'IP Belum Dikonfigurasi';
    diagMessage = `${missingNode}:${missingPort} belum ada IP.`;
  }

  // Device Icon Helper
  const renderDeviceIcon = (type?: string, role?: string) => {
    if (type === 'router') {
      return <Server className={`w-3 h-3 shrink-0 ${role === 'core' ? 'text-blue-500' : 'text-sky-500'}`} />;
    }
    if (type === 'switch') {
      return <SwitchIcon className="w-3 h-3 shrink-0 text-amber-500" />;
    }
    return <Monitor className="w-3 h-3 shrink-0 text-emerald-500" />;
  };

  // Smart Tooltip Positioning following Cursor
  let tooltipLeft = (mousePos?.x ?? 0) + 16;
  let tooltipTop = (mousePos?.y ?? 0) - 10;
  if (typeof window !== 'undefined') {
    const cardWidth = 275;
    const cardHeight = 115;
    if (tooltipLeft + cardWidth > window.innerWidth - 10) {
      tooltipLeft = (mousePos?.x ?? 0) - cardWidth - 14;
    }
    if (tooltipTop + cardHeight > window.innerHeight - 10) {
      tooltipTop = (mousePos?.y ?? 0) - cardHeight - 10;
    }
    if (tooltipTop < 60) {
      tooltipTop = 60;
    }
  }

  return (
    <>
      {/* Invisible wider stroke (24px hit area) for smooth, effortless hover trigger */}
      <path
        d={edgePath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={24}
        className="cursor-pointer"
        onMouseEnter={(e) => {
          setIsHovered(true);
          setMousePos({ x: e.clientX, y: e.clientY });
        }}
        onMouseMove={(e) => {
          setMousePos({ x: e.clientX, y: e.clientY });
        }}
        onMouseLeave={() => {
          setIsHovered(false);
          setMousePos(null);
        }}
      />

      {/* Solid straight cable with smooth luminous hover glow */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        className="react-flow__edge-path"
        style={{
          ...style,
          stroke: isUp 
            ? (isHovered ? (isDarkMode ? '#60a5fa' : '#2563eb') : (isDarkMode ? '#475569' : '#64748b'))
            : '#ef4444',
          strokeWidth: isHovered ? 3.5 : 2,
          filter: isHovered ? 'drop-shadow(0 0 5px rgba(59, 130, 246, 0.5))' : 'none',
          transition: 'stroke 0.15s, stroke-width 0.15s, filter 0.15s',
        }}
      />

      {/* Lightweight, Non-Intrusive HUD Tooltip Anchored Precisely to Pointer */}
      {isHovered && mousePos && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'fixed',
              left: `${tooltipLeft}px`,
              top: `${tooltipTop}px`,
              pointerEvents: 'none',
              zIndex: 99999,
            }}
            className="select-none transition-all duration-75 animate-in fade-in zoom-in-95 duration-100"
          >
            <div
              className={`w-[265px] p-2 rounded-lg shadow-xl border backdrop-blur-md text-xs leading-tight ${
                isDarkMode
                  ? 'bg-slate-900/95 text-slate-100 border-slate-700/80 shadow-slate-950/60'
                  : 'bg-white/95 text-slate-900 border-slate-200/90 shadow-slate-400/20'
              }`}
            >
              {/* Header: Compact Device A ⟷ Device B */}
              <div className="flex items-center justify-between border-b pb-1.5 mb-1.5 border-slate-200/80 dark:border-slate-800">
                <div className="flex items-center gap-1 font-semibold text-[11px] truncate max-w-[105px]">
                  {renderDeviceIcon(sourceNode?.type, sourceNode?.role)}
                  <span className="font-mono">{sourceNode?.name || source}</span>
                  <span className="text-[10px] text-slate-400 font-normal">:{resolvedSourcePort.replace(`${sourceNode?.name}-`, '')}</span>
                </div>

                <div className="flex items-center gap-1 px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 text-[9px] font-mono shrink-0">
                  <ArrowLeftRight className="w-2.5 h-2.5 text-blue-500" />
                  <span>{edgeData.latency ? `${edgeData.latency}ms` : 'Link'}</span>
                </div>

                <div className="flex items-center gap-1 font-semibold text-[11px] truncate max-w-[105px]">
                  {renderDeviceIcon(targetNode?.type, targetNode?.role)}
                  <span className="font-mono">{targetNode?.name || target}</span>
                  <span className="text-[10px] text-slate-400 font-normal">:{resolvedTargetPort.replace(`${targetNode?.name}-`, '')}</span>
                </div>
              </div>

              {/* Addressing Grid */}
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono mb-1.5">
                <div className="bg-slate-50/80 dark:bg-slate-800/50 p-1 rounded border border-slate-200/60 dark:border-slate-700/40">
                  <div className="text-slate-400 text-[9px] truncate">{resolvedSourcePort}</div>
                  <div className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                    {sourceIntf?.ip || (sourceNode?.type === 'switch' && sourceIntf?.vlanTag ? `VLAN ${sourceIntf.vlanTag}` : <span className="text-amber-500 italic">No IP</span>)}
                  </div>
                </div>

                <div className="bg-slate-50/80 dark:bg-slate-800/50 p-1 rounded border border-slate-200/60 dark:border-slate-700/40">
                  <div className="text-slate-400 text-[9px] truncate">{resolvedTargetPort}</div>
                  <div className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                    {targetIntf?.ip || (targetNode?.type === 'switch' && targetIntf?.vlanTag ? `VLAN ${targetIntf.vlanTag}` : <span className="text-amber-500 italic">No IP</span>)}
                  </div>
                </div>
              </div>

              {/* Concise Troubleshooting Diagnostics Status */}
              <div
                className={`px-1.5 py-1 rounded border text-[10px] flex items-center gap-1.5 ${
                  diagStatus === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-200'
                    : diagStatus === 'error'
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-200'
                    : diagStatus === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200'
                    : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60 text-blue-800 dark:text-blue-200'
                }`}
              >
                <div className="shrink-0">
                  {diagStatus === 'success' && <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
                  {diagStatus === 'error' && <XCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />}
                  {diagStatus === 'warning' && <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />}
                  {diagStatus === 'info' && <Info className="w-3 h-3 text-blue-600 dark:text-blue-400" />}
                </div>
                <div className="truncate">
                  <span className="font-bold">{diagTitle}: </span>
                  <span className="opacity-90">{diagMessage}</span>
                </div>
              </div>
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
