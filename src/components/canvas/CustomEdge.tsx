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
  Terminal,
  Wrench,
  HelpCircle,
} from 'lucide-react';

interface CustomEdgeData {
  sourceHandle?: string;
  targetHandle?: string;
  latency?: number;
  status?: 'up' | 'down';
}

interface ConnectionDiagnostic {
  status: 'success' | 'warning' | 'error' | 'info';
  title: string;
  whySuccess?: string;
  whyError?: string;
  fixTargetDevice?: string;
  fixSteps?: string[];
  fixCommands?: string[];
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

  const sourceIpCidr = sourceIntf?.ip;
  const targetIpCidr = targetIntf?.ip;
  const sourceCidr = sourceIpCidr ? parseIpv4Cidr(sourceIpCidr) : null;
  const targetCidr = targetIpCidr ? parseIpv4Cidr(targetIpCidr) : null;

  // -------------------------------------------------------------
  // Comprehensive Diagnostics & Technical Explanation Engine
  // -------------------------------------------------------------
  const getDiagnostic = (): ConnectionDiagnostic => {
    // 1. Interface Administratively DOWN
    if ((sourceIntf && !sourceIntf.up) || (targetIntf && !targetIntf.up)) {
      const downNode = !sourceIntf?.up ? sourceNode : targetNode;
      const downPort = !sourceIntf?.up ? resolvedSourcePort : resolvedTargetPort;
      const isHost = downNode?.type === 'host';
      return {
        status: 'error',
        title: `Port ${downNode?.name}:${downPort} Berstatus DOWN`,
        whyError: `Antarmuka fisik ${downPort} sedang dalam kondisi non-aktif (administratively down). Pada standar jaringan IEEE 802.3, antarmuka yang mati tidak dapat melakukan link beat / carrier detection pada Layer 1 & 2, sehingga semua frame data Ethernet dan paket ping (ICMP) langsung ditolak.`,
        fixTargetDevice: downNode?.name,
        fixSteps: [
          `Buka terminal perangkat ${downNode?.name}.`,
          isHost 
            ? `Jalankan perintah iproute2 Linux untuk mengaktifkan antarmuka.` 
            : `Masuk ke mode konfigurasi antarmuka pada vtysh (FRRouting), lalu ketik "no shutdown".`
        ],
        fixCommands: isHost
          ? [`ip link set dev ${downPort.replace(`${downNode?.name}-`, '')} up`]
          : [
              `configure terminal`,
              `interface ${downPort}`,
              `no shutdown`,
              `end`
            ]
      };
    }

    // 2. Switch Link (Open vSwitch L2 Bridge & VLAN Isolation)
    if (sourceNode?.type === 'switch' || targetNode?.type === 'switch') {
      const switchNode = sourceNode?.type === 'switch' ? sourceNode : targetNode;
      const switchIntf = sourceNode?.type === 'switch' ? sourceIntf : targetIntf;
      const peerNode = sourceNode?.type === 'switch' ? targetNode : sourceNode;
      const vlan = switchIntf?.vlanTag;

      if (vlan && vlan !== 1) {
        return {
          status: 'info',
          title: `Switch Port ${switchIntf?.name} (VLAN ${vlan} Access)`,
          whySuccess: `Port ${switchIntf?.name} pada switch ${switchNode?.name} diberi tag VLAN ${vlan}. Standar IEEE 802.1Q mengisolasi broadcast domain port ini dari VLAN lain, sehingga lalu lintas hanya dapat mengalir ke port dengan VLAN tag yang sama atau menuju Core Router (Uplink/Trunk).`,
          fixTargetDevice: switchNode?.name,
          fixSteps: [
            `Jika Anda ingin mengubah nomor VLAN atau menghapus isolasi tag pada switch ini:`
          ],
          fixCommands: [
            `ovs-vsctl set port ${switchIntf?.name} tag=10`,
            `# Atau jadikan trunk tanpa tag (meneruskan seluruh VLAN):`,
            `ovs-vsctl clear port ${switchIntf?.name} tag`
          ]
        };
      } else {
        return {
          status: 'success',
          title: `Switch Port ${switchIntf?.name} (Trunk / Uplink Port)`,
          whySuccess: `Port ${switchIntf?.name} terhubung ke ${peerNode?.name} tanpa tag isolasi (native trunk). Port ini bertindak sebagai Uplink utama untuk meneruskan frame dari seluruh VLAN (VLAN 10, VLAN 20) menuju Core Router untuk keperluan Inter-VLAN Routing.`,
          fixTargetDevice: switchNode?.name,
          fixSteps: [
            `Port ini sudah berfungsi optimal sebagai jembatan L2 Uplink.`
          ]
        };
      }
    }

    // 3. Both Endpoints have IPv4 Addresses (L3 Connected Subnet Check)
    if (sourceCidr && targetCidr) {
      const isSameSubnet = sourceCidr.prefix === targetCidr.prefix && areIpsInSameSubnet(sourceCidr.ip, targetCidr.ip, sourceCidr.prefix);

      if (isSameSubnet) {
        // Subnet matches! Now check if Host has valid Default Gateway
        const hostNode = sourceNode?.type === 'host' ? sourceNode : (targetNode?.type === 'host' ? targetNode : null);
        const routerNode = sourceNode?.type === 'host' ? targetNode : sourceNode;
        const routerCidr = sourceNode?.type === 'host' ? targetCidr : sourceCidr;

        if (hostNode && routerNode && routerCidr) {
          if (!hostNode.defaultGateway) {
            return {
              status: 'warning',
              title: `Host ${hostNode.name} Belum Memiliki Default Gateway!`,
              whyError: `Ping lokal ke IP router (${routerCidr.ip}) akan BERHASIL karena berada dalam subnet yang sama. Namun ketika host mencoba ping ke luar subnet (misal ke Core Router atau host lain), Linux akan langsung menolak dengan error "connect: Network is unreachable" karena tidak ada rute gateway.`,
              fixTargetDevice: hostNode.name,
              fixSteps: [
                `Buka terminal host ${hostNode.name}.`,
                `Pasang default gateway yang mengarah ke IP interface router terdekat (${routerCidr.ip}).`
              ],
              fixCommands: [
                `ip route add default via ${routerCidr.ip}`
              ]
            };
          }

          if (hostNode.defaultGateway !== routerCidr.ip) {
            return {
              status: 'warning',
              title: `Gateway Host (${hostNode.defaultGateway}) Tidak Sesuai`,
              whyError: `Gateway host ${hostNode.name} saat ini diarahkan ke ${hostNode.defaultGateway}, sedangkan router pada tautan ini memiliki IP ${routerCidr.ip}. Paket tujuan eksternal akan salah kirim ke alamat yang tidak terhubung.`,
              fixTargetDevice: hostNode.name,
              fixSteps: [
                `Perbarui gateway agar mengarah ke ${routerCidr.ip}.`
              ],
              fixCommands: [
                `ip route replace default via ${routerCidr.ip}`
              ]
            };
          }
        }

        // 100% Successful Connected Link
        return {
          status: 'success',
          title: `Subnet Cocok: ${sourceCidr.network}/${sourceCidr.prefix} (0% Packet Loss)`,
          whySuccess: `1. Port Status: Kedua antarmuka (${resolvedSourcePort} & ${resolvedTargetPort}) berstatus UP di Layer 1 & 2.\n2. Subnet Identik: Kedua alamat IP berada di segmen jaringan lokal yang sama (${sourceCidr.network}/${sourceCidr.prefix}).\n3. Resolusi ARP: Protokol ARP langsung memetakan IP tujuan ke MAC address fisik tanpa perantara router tambahan.\n4. Ping Terjamin: Pengiriman paket ICMP Echo Request dan Echo Reply dijamin 100% tembus dengan latensi minimal.`
        };
      } else {
        // Subnet Mismatch!
        return {
          status: 'error',
          title: `Subnet Berbeda (${sourceCidr.network}/${sourceCidr.prefix} ≠ ${targetCidr.network}/${targetCidr.prefix})`,
          whyError: `Alamat IP ${sourceNode?.name} (${sourceIntf?.ip}) dan ${targetNode?.name} (${targetIntf?.ip}) berada pada subnet mask yang berbeda. Aturan addressing IPv4 menetapkan bahwa perangkat di subnet berbeda dianggap sebagai jaringan asing (Remote Network). Pengiriman ping lokal akan gagal (Destination Host Unreachable) karena kedua node tidak saling bertukar ARP.`,
          fixTargetDevice: sourceNode?.type === 'host' ? sourceNode?.name : targetNode?.name,
          fixSteps: [
            `Ubah alamat IP pada salah satu node agar berada dalam segmen subnet yang sama.`
          ],
          fixCommands: sourceNode?.type === 'host'
            ? [
                `ip addr flush dev ${resolvedSourcePort.replace(`${sourceNode?.name}-`, '')}`,
                `ip addr add ${targetCidr.network.slice(0, targetCidr.network.lastIndexOf('.'))}.2/${targetCidr.prefix} dev ${resolvedSourcePort.replace(`${sourceNode?.name}-`, '')}`
              ]
            : [
                `configure terminal`,
                `interface ${resolvedTargetPort}`,
                `ip address ${sourceCidr.network.slice(0, sourceCidr.network.lastIndexOf('.'))}.2/${sourceCidr.prefix}`,
                `no shutdown`,
                `end`
              ]
        };
      }
    }

    // 4. Missing IP Address on one or both sides
    const missingNode = !sourceCidr ? sourceNode : targetNode;
    const missingPort = !sourceCidr ? resolvedSourcePort : resolvedTargetPort;
    const otherNode = !sourceCidr ? targetNode : sourceNode;
    const otherIntf = !sourceCidr ? targetIntf : sourceIntf;
    const isHost = missingNode?.type === 'host';
    const p = otherIntf?.ip ? parseIpv4Cidr(otherIntf.ip) : null;
    const suggestedIp = p ? `${p.network.slice(0, p.network.lastIndexOf('.'))}.${p.ip.endsWith('1') ? '2' : '1'}/${p.prefix}` : '192.168.1.2/24';

    return {
      status: 'warning',
      title: `Alamat IP Belum Dikonfigurasi di ${missingNode?.name}`,
      whyError: `Kabel fisik sudah terpasang rapi di Layer 1, tetapi antarmuka ${missingPort} belum diberikan konfigurasi IPv4 di Layer 3. Tanpa IP, stack TCP/IP tidak dapat mengenali identitas jaringan dan tidak dapat memasang entri routing Connected (C) pada perangkat.`,
      fixTargetDevice: missingNode?.name,
      fixSteps: [
        `Buka terminal perangkat ${missingNode?.name}.`,
        `Tetapkan alamat IP dalam subnet yang sesuai dengan ${otherNode?.name}.`
      ],
      fixCommands: isHost
        ? [
            `ip addr add ${suggestedIp} dev ${missingPort.replace(`${missingNode?.name}-`, '')}`,
            ...(otherNode?.type === 'router' && p ? [`ip route add default via ${p.ip}`] : [])
          ]
        : [
            `configure terminal`,
            `interface ${missingPort}`,
            `ip address ${suggestedIp}`,
            `no shutdown`,
            `end`
          ]
    };
  };

  const diag = getDiagnostic();

  // Helper for Device Icon
  const renderDeviceIcon = (type?: string, role?: string) => {
    if (type === 'router') {
      return <Server className={`w-3.5 h-3.5 shrink-0 ${role === 'core' ? 'text-blue-500' : 'text-sky-500'}`} />;
    }
    if (type === 'switch') {
      return <SwitchIcon className="w-3.5 h-3.5 shrink-0 text-amber-500" />;
    }
    return <Monitor className="w-3.5 h-3.5 shrink-0 text-emerald-500" />;
  };

  // Smart Tooltip Clamping Position following Cursor
  let tooltipLeft = (mousePos?.x ?? 0) + 16;
  let tooltipTop = (mousePos?.y ?? 0) - 20;
  if (typeof window !== 'undefined') {
    const cardWidth = 330;
    const cardHeight = 260;
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
          filter: isHovered ? 'drop-shadow(0 0 6px rgba(59, 130, 246, 0.5))' : 'none',
          transition: 'stroke 0.15s, stroke-width 0.15s, filter 0.15s',
        }}
      />

      {/* Midpoint Target Guide Bead / Dot on the wire */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="z-20 flex items-center justify-center cursor-pointer"
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
        >
          <div
            className={`transition-all duration-150 flex items-center justify-center rounded-full cursor-pointer ${
              isHovered
                ? 'w-3.5 h-3.5 bg-blue-500 ring-4 ring-blue-500/25 shadow-md'
                : 'w-2 h-2 bg-slate-400 dark:bg-slate-500 border border-white dark:border-slate-800 shadow-xs hover:scale-150 hover:bg-blue-500'
            }`}
            title="Sorot kabel untuk inspeksi koneksi & troubleshooting"
          >
            {isHovered && <span className="w-1 h-1 rounded-full bg-white" />}
          </div>
        </div>
      </EdgeLabelRenderer>

      {/* Comprehensive Educational Diagnostics & Fix Guide Card anchored to Pointer */}
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
              className={`w-[325px] sm:w-[340px] p-2.5 rounded-xl shadow-2xl border backdrop-blur-md text-xs leading-normal ${
                isDarkMode
                  ? 'bg-slate-900/95 text-slate-100 border-slate-700/80 shadow-slate-950/70'
                  : 'bg-white/95 text-slate-900 border-slate-200/90 shadow-slate-400/25'
              }`}
            >
              {/* Header: Device A ⟷ Device B */}
              <div className="flex items-center justify-between border-b pb-1.5 mb-2 border-slate-200/80 dark:border-slate-800">
                <div className="flex items-center gap-1.5 font-bold text-[11px] truncate max-w-[130px]">
                  {renderDeviceIcon(sourceNode?.type, sourceNode?.role)}
                  <span className="font-mono">{sourceNode?.name || source}</span>
                  <span className="text-[10px] text-slate-400 font-normal truncate">
                    ({resolvedSourcePort.replace(`${sourceNode?.name}-`, '')})
                  </span>
                </div>

                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-mono shrink-0">
                  <ArrowLeftRight className="w-3 h-3 text-blue-500" />
                  <span>{edgeData.latency ? `${edgeData.latency}ms` : 'Link'}</span>
                </div>

                <div className="flex items-center gap-1.5 font-bold text-[11px] truncate max-w-[130px]">
                  {renderDeviceIcon(targetNode?.type, targetNode?.role)}
                  <span className="font-mono">{targetNode?.name || target}</span>
                  <span className="text-[10px] text-slate-400 font-normal truncate">
                    ({resolvedTargetPort.replace(`${targetNode?.name}-`, '')})
                  </span>
                </div>
              </div>

              {/* Addressing Grid */}
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono mb-2">
                <div className="bg-slate-50/90 dark:bg-slate-800/60 p-1.5 rounded-lg border border-slate-200/70 dark:border-slate-700/50">
                  <div className="text-slate-400 text-[9px] mb-0.5 truncate">{resolvedSourcePort}</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {sourceIntf?.ip || (sourceNode?.type === 'switch' && sourceIntf?.vlanTag ? `VLAN ${sourceIntf.vlanTag}` : <span className="text-amber-500 italic">No IP</span>)}
                  </div>
                  <div className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Status: <span className={sourceIntf?.up !== false ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold'}>{sourceIntf?.up !== false ? 'UP' : 'DOWN'}</span>
                  </div>
                </div>

                <div className="bg-slate-50/90 dark:bg-slate-800/60 p-1.5 rounded-lg border border-slate-200/70 dark:border-slate-700/50">
                  <div className="text-slate-400 text-[9px] mb-0.5 truncate">{resolvedTargetPort}</div>
                  <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {targetIntf?.ip || (targetNode?.type === 'switch' && targetIntf?.vlanTag ? `VLAN ${targetIntf.vlanTag}` : <span className="text-amber-500 italic">No IP</span>)}
                  </div>
                  <div className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Status: <span className={targetIntf?.up !== false ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold'}>{targetIntf?.up !== false ? 'UP' : 'DOWN'}</span>
                  </div>
                </div>
              </div>

              {/* SECTION: Mengapa Berhasil / Mengapa Error */}
              <div
                className={`p-2 rounded-lg border text-[11px] mb-2 ${
                  diag.status === 'success'
                    ? 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-200'
                    : diag.status === 'error'
                    ? 'bg-rose-50/90 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/70 text-rose-900 dark:text-rose-200'
                    : diag.status === 'warning'
                    ? 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/70 text-amber-900 dark:text-amber-200'
                    : 'bg-blue-50/90 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/70 text-blue-900 dark:text-blue-200'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold mb-1">
                  {diag.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />}
                  {diag.status === 'error' && <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />}
                  {diag.status === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />}
                  {diag.status === 'info' && <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />}
                  <span className="truncate">{diag.title}</span>
                </div>

                <div className="text-[10px] leading-relaxed opacity-95 whitespace-pre-line">
                  {diag.whySuccess || diag.whyError}
                </div>
              </div>

              {/* SECTION: Panduan & Cara Memperbaiki (Jika ada Error / Warning) */}
              {(diag.fixCommands || diag.fixSteps) && (
                <div className="p-2 rounded-lg bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 text-[10px]">
                  <div className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-200 mb-1">
                    <Wrench className="w-3 h-3 text-blue-500" />
                    <span>Panduan Perbaikan ({diag.fixTargetDevice}):</span>
                  </div>

                  {diag.fixSteps && diag.fixSteps.length > 0 && (
                    <ul className="list-disc list-inside space-y-0.5 text-slate-600 dark:text-slate-300 mb-1.5 opacity-90">
                      {diag.fixSteps.map((step, idx) => (
                        <li key={idx} className="leading-tight">{step}</li>
                      ))}
                    </ul>
                  )}

                  {diag.fixCommands && diag.fixCommands.length > 0 && (
                    <div className="space-y-0.5">
                      <div className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Perintah CLI untuk dijalankan:</div>
                      <div className="bg-slate-950 text-emerald-400 p-1.5 rounded-md font-mono text-[9.5px] space-y-0.5 border border-slate-800 shadow-inner overflow-x-auto">
                        {diag.fixCommands.map((cmd, idx) => (
                          <div key={idx} className="leading-tight select-all">
                            {cmd}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
