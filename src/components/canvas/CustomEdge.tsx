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
  Activity,
  Server,
  Monitor,
  Network as SwitchIcon,
  ShieldAlert
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

  // Access network store to get live node and interface details
  const nodes = useNetworkStore(state => state.nodes);
  const isDarkMode = useNetworkStore(state => state.isDarkMode);

  const [edgePath, labelX, labelY] = getStraightPath({
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

  // Calculate endpoint positions for small port tags (22% and 78% along the wire)
  const distance = Math.hypot(targetX - sourceX, targetY - sourceY);
  const showEndpointPills = distance > 130;
  const p1X = sourceX + (targetX - sourceX) * 0.22;
  const p1Y = sourceY + (targetY - sourceY) * 0.22;
  const p2X = sourceX + (targetX - sourceX) * 0.78;
  const p2Y = sourceY + (targetY - sourceY) * 0.78;

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
    diagTitle = 'Antarmuka DOWN';
    diagMessage = `Port ${downPort} mati. Jalankan "no shutdown" di router atau "ip link set <intf> up" di host.`;
  }
  // Check 2: Switch Connection & VLAN Isolation
  else if (sourceNode?.type === 'switch' || targetNode?.type === 'switch') {
    diagStatus = 'info';
    const switchNode = sourceNode?.type === 'switch' ? sourceNode : targetNode;
    const switchIntf = sourceNode?.type === 'switch' ? sourceIntf : targetIntf;
    const peerNode = sourceNode?.type === 'switch' ? targetNode : sourceNode;
    const vlan = switchIntf?.vlanTag;

    if (vlan && vlan !== 1) {
      diagTitle = `VLAN Access Port (Tag ${vlan})`;
      diagMessage = `Port ${switchIntf?.name} di ${switchNode?.name} diberi tag VLAN ${vlan}. Terisolasi dari VLAN lain; hanya dapat menjangkau port dengan tag sama atau Core Router (Uplink).`;
    } else {
      diagTitle = 'Switch Trunk / Uplink Port';
      diagMessage = `Port ${switchIntf?.name} di ${switchNode?.name} bertindak sebagai trunk/uplink ke ${peerNode?.name}. Meneruskan lalu lintas inter-VLAN.`;
    }
  }
  // Check 3: Both L3 Endpoints have IP (Subnet Match Check)
  else if (sourceCidr && targetCidr) {
    const isSameSubnet = sourceCidr.prefix === targetCidr.prefix && areIpsInSameSubnet(sourceCidr.ip, targetCidr.ip, sourceCidr.prefix);

    if (isSameSubnet) {
      diagStatus = 'success';
      diagTitle = 'Subnet Cocok (Direct L3 OK)';
      diagMessage = `Kedua antarmuka berada di subnet ${sourceCidr.network}/${sourceCidr.prefix}. Ping langsung antar kedua node dijamin tembus (0% packet loss).`;

      // Check Host Default Gateway
      const hostNode = sourceNode?.type === 'host' ? sourceNode : (targetNode?.type === 'host' ? targetNode : null);
      const routerCidr = sourceNode?.type === 'host' ? targetCidr : sourceCidr;
      if (hostNode && routerCidr) {
        if (!hostNode.defaultGateway) {
          diagStatus = 'warning';
          diagTitle = 'Host Belum Memiliki Default Gateway!';
          diagMessage = `Host ${hostNode.name} belum memiliki gateway. Ping keluar subnet akan gagal. Ketik: "ip route add default via ${routerCidr.ip}".`;
        } else if (hostNode.defaultGateway !== routerCidr.ip) {
          diagStatus = 'warning';
          diagTitle = 'Default Gateway Berbeda dengan IP Router';
          diagMessage = `Gateway ${hostNode.name} (${hostNode.defaultGateway}) tidak sama dengan IP interface router (${routerCidr.ip}).`;
        }
      }
    } else {
      diagStatus = 'error';
      diagTitle = 'Subnet Berbeda (Subnet Mismatch)';
      diagMessage = `${sourceNode?.name} (${sourceCidr.network}/${sourceCidr.prefix}) ≠ ${targetNode?.name} (${targetCidr.network}/${targetCidr.prefix}). Ping lokal akan gagal (Destination Host Unreachable).`;
    }
  }
  // Check 4: Missing IP on one or both endpoints
  else if (!sourceCidr || !targetCidr) {
    diagStatus = 'warning';
    const missingNode = !sourceCidr ? sourceNode?.name : targetNode?.name;
    const missingPort = !sourceCidr ? resolvedSourcePort : resolvedTargetPort;
    diagTitle = 'Alamat IP Belum Diatur';
    diagMessage = `Port ${missingNode}:${missingPort} belum memiliki IP. Gunakan "ip addr add <ip>/<cidr> dev <intf>" untuk mengonfigurasi.`;
  }

  // Helper for Device Icon
  const renderDeviceIcon = (type?: string, role?: string) => {
    if (type === 'router') {
      return <Server className={`w-3.5 h-3.5 ${role === 'core' ? 'text-blue-500' : 'text-sky-500'}`} />;
    }
    if (type === 'switch') {
      return <SwitchIcon className="w-3.5 h-3.5 text-amber-500" />;
    }
    return <Monitor className="w-3.5 h-3.5 text-emerald-500" />;
  };

  return (
    <>
      {/* Invisible wider stroke (28px hit area) for effortless hover trigger */}
      <path
        d={edgePath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={28}
        className="cursor-pointer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />

      {/* Solid straight cable with smooth hover glow */}
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
          filter: isHovered ? 'drop-shadow(0 0 5px rgba(59, 130, 246, 0.45))' : 'none',
          transition: 'stroke 0.15s, stroke-width 0.15s, filter 0.15s',
        }}
      />

      {/* Interactive Diagnostics Tooltip & Port Badges on Hover */}
      {isHovered && (
        <EdgeLabelRenderer>
          {/* Endpoint Port Pill 1 (Near Source Node) */}
          {showEndpointPills && (
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${p1X}px,${p1Y}px)`,
                pointerEvents: 'none',
              }}
              className="z-30 select-none animate-in fade-in zoom-in-95 duration-100"
            >
              <div className="bg-slate-900/90 text-white dark:bg-slate-800/95 text-[9px] px-1.5 py-0.5 rounded shadow-sm border border-slate-700 font-mono whitespace-nowrap flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${sourceIntf?.up !== false ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span>{resolvedSourcePort}</span>
              </div>
            </div>
          )}

          {/* Endpoint Port Pill 2 (Near Target Node) */}
          {showEndpointPills && (
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${p2X}px,${p2Y}px)`,
                pointerEvents: 'none',
              }}
              className="z-30 select-none animate-in fade-in zoom-in-95 duration-100"
            >
              <div className="bg-slate-900/90 text-white dark:bg-slate-800/95 text-[9px] px-1.5 py-0.5 rounded shadow-sm border border-slate-700 font-mono whitespace-nowrap flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${targetIntf?.up !== false ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span>{resolvedTargetPort}</span>
              </div>
            </div>
          )}

          {/* Central Comprehensive Troubleshooting Diagnostics Card */}
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'none',
            }}
            className="z-40 select-none transition-all duration-150"
          >
            <div
              className={`min-w-[320px] max-w-[380px] p-2.5 rounded-xl shadow-2xl border backdrop-blur-md text-xs ${
                isDarkMode
                  ? 'bg-slate-900/95 text-slate-100 border-slate-700'
                  : 'bg-white/95 text-slate-900 border-slate-200'
              }`}
            >
              {/* Header: Device A ⟷ Device B */}
              <div className="flex items-center justify-between border-b pb-2 mb-2 border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-1.5 font-bold">
                  {renderDeviceIcon(sourceNode?.type, sourceNode?.role)}
                  <span className="font-mono text-xs">{sourceNode?.name || source}</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    ({sourceNode?.type === 'router' ? (sourceNode.role === 'core' ? 'Core Router' : 'Edge Router') : sourceNode?.type === 'switch' ? 'Switch' : 'Host'})
                  </span>
                </div>

                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-mono">
                  <ArrowLeftRight className="w-3 h-3 text-blue-500" />
                  <span>{edgeData.latency ? `${edgeData.latency}ms` : 'Link'}</span>
                </div>

                <div className="flex items-center gap-1.5 font-bold">
                  {renderDeviceIcon(targetNode?.type, targetNode?.role)}
                  <span className="font-mono text-xs">{targetNode?.name || target}</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    ({targetNode?.type === 'router' ? (targetNode.role === 'core' ? 'Core Router' : 'Edge Router') : targetNode?.type === 'switch' ? 'Switch' : 'Host'})
                  </span>
                </div>
              </div>

              {/* Side-by-Side Port & Addressing Details */}
              <div className="grid grid-cols-2 gap-2 text-[11px] mb-2 font-mono">
                {/* Left Side: Source Port Details */}
                <div className="p-1.5 rounded bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-blue-600 dark:text-blue-400 truncate">{resolvedSourcePort}</span>
                    <span className={`px-1 py-0.2 rounded text-[9px] font-bold ${sourceIntf?.up !== false ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'}`}>
                      {sourceIntf?.up !== false ? 'UP' : 'DOWN'}
                    </span>
                  </div>
                  <div className="space-y-0.5 text-[10px]">
                    <div className="text-slate-600 dark:text-slate-300 truncate">
                      <span className="text-slate-400">IP: </span>
                      {sourceIntf?.ip || <span className="text-amber-500 italic">None</span>}
                    </div>
                    {sourceIntf?.ipv6 && (
                      <div className="text-slate-600 dark:text-slate-300 truncate">
                        <span className="text-slate-400">IPv6: </span>
                        {sourceIntf.ipv6}
                      </div>
                    )}
                    {sourceNode?.type === 'switch' && sourceIntf?.vlanTag !== undefined && (
                      <div className="text-amber-600 dark:text-amber-400 font-semibold">
                        Tag: VLAN {sourceIntf.vlanTag}
                      </div>
                    )}
                    {sourceNode?.type === 'host' && sourceNode.defaultGateway && (
                      <div className="text-slate-600 dark:text-slate-300 truncate">
                        <span className="text-slate-400">GW: </span>
                        {sourceNode.defaultGateway}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Side: Target Port Details */}
                <div className="p-1.5 rounded bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-blue-600 dark:text-blue-400 truncate">{resolvedTargetPort}</span>
                    <span className={`px-1 py-0.2 rounded text-[9px] font-bold ${targetIntf?.up !== false ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'}`}>
                      {targetIntf?.up !== false ? 'UP' : 'DOWN'}
                    </span>
                  </div>
                  <div className="space-y-0.5 text-[10px]">
                    <div className="text-slate-600 dark:text-slate-300 truncate">
                      <span className="text-slate-400">IP: </span>
                      {targetIntf?.ip || <span className="text-amber-500 italic">None</span>}
                    </div>
                    {targetIntf?.ipv6 && (
                      <div className="text-slate-600 dark:text-slate-300 truncate">
                        <span className="text-slate-400">IPv6: </span>
                        {targetIntf.ipv6}
                      </div>
                    )}
                    {targetNode?.type === 'switch' && targetIntf?.vlanTag !== undefined && (
                      <div className="text-amber-600 dark:text-amber-400 font-semibold">
                        Tag: VLAN {targetIntf.vlanTag}
                      </div>
                    )}
                    {targetNode?.type === 'host' && targetNode.defaultGateway && (
                      <div className="text-slate-600 dark:text-slate-300 truncate">
                        <span className="text-slate-400">GW: </span>
                        {targetNode.defaultGateway}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Troubleshooting Diagnostic Banner (Bottom) */}
              <div
                className={`p-2 rounded-lg border text-[11px] flex items-start gap-2 ${
                  diagStatus === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200'
                    : diagStatus === 'error'
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/70 text-rose-800 dark:text-rose-200'
                    : diagStatus === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/70 text-amber-800 dark:text-amber-200'
                    : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/70 text-blue-800 dark:text-blue-200'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {diagStatus === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                  {diagStatus === 'error' && <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />}
                  {diagStatus === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />}
                  {diagStatus === 'info' && <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
                </div>
                <div>
                  <div className="font-bold text-[11px] leading-tight mb-0.5">{diagTitle}</div>
                  <div className="text-[10px] leading-snug opacity-90">{diagMessage}</div>
                </div>
              </div>
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
