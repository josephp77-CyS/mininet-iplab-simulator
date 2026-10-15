import { NetworkNode, NetworkLink, SimulationResult } from './types';
import { parseIpv4Cidr, isIpv4InSubnet, parseIpv6Cidr, isIpv6InSubnet, resolveInterfaceName } from './ipUtils';
import { computeOspfRoutes } from './ospfEngine';
import { computeBgpRoutes } from './bgpEngine';
import { getReachableL3Neighbors } from './vlanEngine';

interface RouteLookupResult {
  nextHopIp?: string;
  exitInterface: string;
  isTunnel?: boolean;
  tunnelRemoteIp?: string;
}

function findBestIpv4Route(
  nodeId: string,
  targetIp: string,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): RouteLookupResult | null {
  const node = nodes[nodeId];
  if (!node) return null;

  // 1. Directly Connected
  for (const [intfName, intf] of Object.entries(node.interfaces)) {
    if (intf.ip && intf.up) {
      const p = parseIpv4Cidr(intf.ip);
      if (p && isIpv4InSubnet(targetIp, p.network, p.prefix)) {
        return { exitInterface: intfName, nextHopIp: targetIp };
      }
    }
  }

  // 2. Static Routes (LPM)
  let bestStatic: { prefix: number; nextHop: string; exitInterface?: string } | null = null;
  for (const s of node.staticRoutes || []) {
    if (isIpv4InSubnet(targetIp, s.destination, s.prefix)) {
      if (!bestStatic || s.prefix > bestStatic.prefix) {
        bestStatic = { prefix: s.prefix, nextHop: s.nextHop, exitInterface: s.interfaceName };
      }
    }
  }
  if (bestStatic) {
    if (bestStatic.nextHop.toLowerCase() === 'null0') {
      return null; // dropped / blackhole
    }
    let exitIntf = bestStatic.exitInterface;
    if (!exitIntf) {
      for (const [intfName, intf] of Object.entries(node.interfaces)) {
        if (intf.ip && intf.up) {
          const p = parseIpv4Cidr(intf.ip);
          if (p && isIpv4InSubnet(bestStatic.nextHop, p.network, p.prefix)) {
            exitIntf = intfName;
            break;
          }
        }
      }
    }
    if (exitIntf) {
      return { exitInterface: exitIntf, nextHopIp: bestStatic.nextHop };
    }
  }

  // 3. OSPF Routes (LPM)
  const ospfRoutes = computeOspfRoutes(nodeId, nodes, links);
  let bestOspf: { prefix: number; nextHop?: string; exitInterface: string } | null = null;
  for (const r of ospfRoutes) {
    if (isIpv4InSubnet(targetIp, r.destination, r.prefix)) {
      if (!bestOspf || r.prefix > bestOspf.prefix) {
        bestOspf = { prefix: r.prefix, nextHop: r.nextHop, exitInterface: r.interfaceName };
      }
    }
  }
  if (bestOspf) {
    return { exitInterface: bestOspf.exitInterface, nextHopIp: bestOspf.nextHop };
  }

  // 4. BGP Routes (LPM)
  const bgpRoutes = computeBgpRoutes(nodeId, nodes, links);
  for (const b of bgpRoutes) {
    const parsedCidr = parseIpv4Cidr(b.prefix);
    if (parsedCidr && isIpv4InSubnet(targetIp, parsedCidr.network, parsedCidr.prefix)) {
      if (b.nextHop && b.nextHop !== '0.0.0.0') {
        const underlay = findBestIpv4Route(nodeId, b.nextHop, nodes, links);
        if (underlay) {
          return { exitInterface: underlay.exitInterface, nextHopIp: underlay.nextHopIp };
        }
      }
    }
  }

  // 5. Host Default Gateway
  if (node.defaultGateway) {
    for (const [intfName, intf] of Object.entries(node.interfaces)) {
      if (intf.ip && intf.up) {
        const p = parseIpv4Cidr(intf.ip);
        if (p && isIpv4InSubnet(node.defaultGateway, p.network, p.prefix)) {
          return { exitInterface: intfName, nextHopIp: node.defaultGateway };
        }
      }
    }
    // Fallback: pick first up interface if not in same subnet
    const firstUp = Object.keys(node.interfaces).find(k => node.interfaces[k].up);
    if (firstUp) {
      return { exitInterface: firstUp, nextHopIp: node.defaultGateway };
    }
  }

  return null;
}

function findBestIpv6Route(
  nodeId: string,
  targetIpv6: string,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): RouteLookupResult | null {
  const node = nodes[nodeId];
  if (!node) return null;

  // 1. Directly Connected IPv6
  for (const [intfName, intf] of Object.entries(node.interfaces)) {
    if (intf.ipv6 && intf.up) {
      const p = parseIpv6Cidr(intf.ipv6);
      if (p && isIpv6InSubnet(targetIpv6, p.ip, p.prefix)) {
        return { exitInterface: intfName, nextHopIp: targetIpv6 };
      }
    }
  }

  // 2. Static IPv6 Routes
  for (const r of node.ipv6Routes || []) {
    if (isIpv6InSubnet(targetIpv6, r.destination, r.prefix)) {
      const exitIntf = r.interfaceName || Object.keys(node.interfaces)[0];
      const intf = node.interfaces[exitIntf];
      if (intf && intf.isTunnel && intf.tunnelConfig) {
        return {
          exitInterface: exitIntf,
          nextHopIp: r.nextHop || targetIpv6,
          isTunnel: true,
          tunnelRemoteIp: intf.tunnelConfig.remote,
        };
      }
      return { exitInterface: exitIntf, nextHopIp: r.nextHop };
    }
  }

  // 3. Default Gateway IPv6
  if (node.defaultGatewayV6) {
    for (const [intfName, intf] of Object.entries(node.interfaces)) {
      if (intf.ipv6 && intf.up) {
        return { exitInterface: intfName, nextHopIp: node.defaultGatewayV6 };
      }
    }
  }

  return null;
}

export function simulatePing(
  sourceNodeId: string,
  targetIp: string,
  isIpv6: boolean,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): SimulationResult {
  const sourceNode = nodes[sourceNodeId];
  if (!sourceNode) {
    return { success: false, rtt: 0, hops: [], error: 'Source node not found' };
  }

  // 1. Self-Ping Check (Loopback or Local Interface)
  if (targetIp === '127.0.0.1' || targetIp === '::1') {
    return {
      success: true,
      rtt: 0.04,
      hops: [{ nodeId: sourceNode.id, nodeName: sourceNode.name, ip: targetIp, rtt: 0.04 }]
    };
  }

  for (const intf of Object.values(sourceNode.interfaces)) {
    if (intf.up) {
      if (!isIpv6 && intf.ip) {
        const p = parseIpv4Cidr(intf.ip);
        if (p && p.ip === targetIp) {
          return {
            success: true,
            rtt: 0.04,
            hops: [{ nodeId: sourceNode.id, nodeName: sourceNode.name, ip: targetIp, rtt: 0.04 }]
          };
        }
      } else if (isIpv6 && intf.ipv6) {
        const p = parseIpv6Cidr(intf.ipv6);
        if (p && isIpv6InSubnet(targetIp, p.ip, 128)) {
          return {
            success: true,
            rtt: 0.04,
            hops: [{ nodeId: sourceNode.id, nodeName: sourceNode.name, ip: targetIp, rtt: 0.04 }]
          };
        }
      }
    }
  }

  // Find destination node in topology
  let destNode: NetworkNode | null = null;
  for (const n of Object.values(nodes)) {
    for (const intf of Object.values(n.interfaces)) {
      if (intf.up) {
        if (!isIpv6 && intf.ip) {
          const p = parseIpv4Cidr(intf.ip);
          if (p && p.ip === targetIp) {
            destNode = n;
            break;
          }
        } else if (isIpv6 && intf.ipv6) {
          const p = parseIpv6Cidr(intf.ipv6);
          if (p && isIpv6InSubnet(targetIp, p.ip, 128)) {
            destNode = n;
            break;
          }
        }
      }
    }
    if (destNode) break;
  }

  if (!destNode) {
    return {
      success: false,
      rtt: 0,
      hops: [],
      error: 'Destination Host Unreachable (Address not assigned in topology)',
    };
  }

  // Identify source IP for return path validation:
  // 1. Prefer interface on sourceNode in the same subnet as targetIp
  let sourceIp = '';
  for (const intf of Object.values(sourceNode.interfaces)) {
    if (!intf.up) continue;
    if (!isIpv6 && intf.ip) {
      const p = parseIpv4Cidr(intf.ip);
      if (p && isIpv4InSubnet(targetIp, p.network, p.prefix)) {
        sourceIp = p.ip;
        break;
      }
    } else if (isIpv6 && intf.ipv6) {
      const p = parseIpv6Cidr(intf.ipv6);
      if (p && isIpv6InSubnet(targetIp, p.ip, p.prefix)) {
        sourceIp = p.ip;
        break;
      }
    }
  }

  // 2. If no direct subnet match, pick first physical non-loopback interface
  if (!sourceIp) {
    for (const intf of Object.values(sourceNode.interfaces)) {
      if (!intf.up || intf.name === 'lo') continue;
      if (!isIpv6 && intf.ip) {
        const p = parseIpv4Cidr(intf.ip);
        if (p) { sourceIp = p.ip; break; }
      } else if (isIpv6 && intf.ipv6) {
        const p = parseIpv6Cidr(intf.ipv6);
        if (p) { sourceIp = p.ip; break; }
      }
    }
  }

  // 3. Fallback to any interface (including lo)
  if (!sourceIp) {
    for (const intf of Object.values(sourceNode.interfaces)) {
      if (!intf.up) continue;
      if (!isIpv6 && intf.ip) {
        const p = parseIpv4Cidr(intf.ip);
        if (p) { sourceIp = p.ip; break; }
      } else if (isIpv6 && intf.ipv6) {
        const p = parseIpv6Cidr(intf.ipv6);
        if (p) { sourceIp = p.ip; break; }
      }
    }
  }

  const hops: SimulationResult['hops'] = [];
  let currentNodeId = sourceNodeId;
  const visited = new Set<string>();
  let totalLatency = 0.2; // base RTT

  let ttl = 30;
  while (ttl > 0) {
    const currentNode = nodes[currentNodeId];
    if (!currentNode) {
      return { success: false, rtt: totalLatency, hops, error: 'Network routing failed: node lost' };
    }

    hops.push({
      nodeId: currentNode.id,
      nodeName: currentNode.name,
      ip: targetIp,
      rtt: Math.round(totalLatency * 100) / 100,
    });

    // Destination Reached! Verify Return Path (Symmetric Reachability)
    if (currentNode.id === destNode.id) {
      if (sourceIp) {
        // Test if destNode has path back to sourceIp
        let returnPathOk = false;
        // Direct subnet check on destination
        for (const intf of Object.values(destNode.interfaces)) {
          if (!intf.up) continue;
          if (isIpv6 && intf.ipv6) {
            const p6 = parseIpv6Cidr(intf.ipv6);
            if (p6 && isIpv6InSubnet(sourceIp, p6.ip, p6.prefix)) {
              returnPathOk = true;
              break;
            }
          } else if (!isIpv6 && intf.ip) {
            const p4 = parseIpv4Cidr(intf.ip);
            if (p4 && isIpv4InSubnet(sourceIp, p4.network, p4.prefix)) {
              returnPathOk = true;
              break;
            }
          }
        }

        if (!returnPathOk) {
          if (destNode.type === 'host') {
            if (isIpv6 ? destNode.defaultGatewayV6 : destNode.defaultGateway) {
              returnPathOk = true;
            }
          } else {
            const returnRoute = isIpv6
              ? findBestIpv6Route(destNode.id, sourceIp, nodes, links)
              : findBestIpv4Route(destNode.id, sourceIp, nodes, links);
            if (returnRoute) returnPathOk = true;
          }
        }

        if (!returnPathOk) {
          return {
            success: false,
            rtt: totalLatency,
            hops,
            error: 'Request timed out (Return path from destination failed - check return route / default gateway)'
          };
        }
      }

      return {
        success: true,
        rtt: Math.round(totalLatency * 100) / 100,
        hops,
      };
    }

    visited.add(currentNodeId);
    ttl--;

    // -----------------------------------------------------------------
    // Step A: Directly Connected Subnet Check (Hosts & Routers)
    // -----------------------------------------------------------------
    let directNextHopNodeId = '';
    if (!isIpv6) {
      for (const [intfName, intf] of Object.entries(currentNode.interfaces)) {
        if (!intf.up || !intf.ip) continue;
        const p = parseIpv4Cidr(intf.ip);
        if (!p) continue;

        if (isIpv4InSubnet(targetIp, p.network, p.prefix)) {
          const l3Neighbors = getReachableL3Neighbors(currentNode.id, intfName, nodes, links);
          for (const nb of l3Neighbors) {
            for (const nbIntf of Object.values(nb.node.interfaces)) {
              if (nbIntf.up && nbIntf.ip) {
                const nbP = parseIpv4Cidr(nbIntf.ip);
                if (nbP && nbP.ip === targetIp) {
                  directNextHopNodeId = nb.node.id;
                  break;
                }
              }
            }
            if (directNextHopNodeId) break;
          }
        }
        if (directNextHopNodeId) break;
      }
    } else {
      for (const [intfName, intf] of Object.entries(currentNode.interfaces)) {
        if (!intf.up || !intf.ipv6) continue;
        const p = parseIpv6Cidr(intf.ipv6);
        if (!p) continue;

        if (isIpv6InSubnet(targetIp, p.ip, p.prefix)) {
          const l3Neighbors = getReachableL3Neighbors(currentNode.id, intfName, nodes, links);
          for (const nb of l3Neighbors) {
            for (const nbIntf of Object.values(nb.node.interfaces)) {
              if (nbIntf.up && nbIntf.ipv6) {
                const nbP = parseIpv6Cidr(nbIntf.ipv6);
                if (nbP && isIpv6InSubnet(targetIp, nbP.ip, 128)) {
                  directNextHopNodeId = nb.node.id;
                  break;
                }
              }
            }
            if (directNextHopNodeId) break;
          }
        }
        if (directNextHopNodeId) break;
      }
    }

    if (directNextHopNodeId) {
      totalLatency += 0.35;
      currentNodeId = directNextHopNodeId;
      continue;
    }

    // -----------------------------------------------------------------
    // Step B: Host Forwarding (Linux default gateway / static routes)
    // -----------------------------------------------------------------
    if (currentNode.type === 'host') {
      const gw = isIpv6 ? currentNode.defaultGatewayV6 : currentNode.defaultGateway;
      if (!gw) {
        return {
          success: false,
          rtt: totalLatency,
          hops,
          error: 'connect: Network is unreachable (Missing default gateway on host)'
        };
      }

      // Find which reachable L3 neighbor owns or is adjacent to gw
      let gwNodeId = '';
      for (const intfName of Object.keys(currentNode.interfaces)) {
        const neighbors = getReachableL3Neighbors(currentNode.id, intfName, nodes, links);
        for (const nb of neighbors) {
          for (const nbIntf of Object.values(nb.node.interfaces)) {
            if (nbIntf.up && (isIpv6 ? nbIntf.ipv6 : nbIntf.ip)) {
              const p = isIpv6 ? parseIpv6Cidr(nbIntf.ipv6!) : parseIpv4Cidr(nbIntf.ip!);
              if (p && p.ip === gw) {
                gwNodeId = nb.node.id;
                break;
              }
            }
          }
          if (gwNodeId) break;
        }
        if (gwNodeId) break;
      }

      // If neighbor didn't match exact IP but is a connected router, use it
      if (!gwNodeId) {
        for (const intfName of Object.keys(currentNode.interfaces)) {
          const neighbors = getReachableL3Neighbors(currentNode.id, intfName, nodes, links);
          const routerNb = neighbors.find(n => n.node.type === 'router');
          if (routerNb) {
            gwNodeId = routerNb.node.id;
            break;
          }
        }
      }

      if (!gwNodeId || visited.has(gwNodeId)) {
        return {
          success: false,
          rtt: totalLatency,
          hops,
          error: `Destination Host Unreachable (Default gateway ${gw} unreachable from ${currentNode.name})`
        };
      }

      totalLatency += 0.45;
      currentNodeId = gwNodeId;
      continue;
    }

    // -----------------------------------------------------------------
    // Step C: Router Forwarding (Routing Table Lookup)
    // -----------------------------------------------------------------
    const route = isIpv6
      ? findBestIpv6Route(currentNodeId, targetIp, nodes, links)
      : findBestIpv4Route(currentNodeId, targetIp, nodes, links);

    if (!route) {
      return {
        success: false,
        rtt: totalLatency,
        hops,
        error: `From ${currentNode.name}: Destination Net Unreachable`,
      };
    }

    // Handle 6in4 SIT Tunnel Encapsulation
    if (route.isTunnel && route.tunnelRemoteIp) {
      const underlayRoute = findBestIpv4Route(currentNodeId, route.tunnelRemoteIp, nodes, links);
      if (!underlayRoute) {
        return {
          success: false,
          rtt: totalLatency,
          hops,
          error: `6in4 Tunnel encapsulation error: no IPv4 route to remote endpoint ${route.tunnelRemoteIp}`,
        };
      }

      let remoteEndpointNode: NetworkNode | null = null;
      for (const n of Object.values(nodes)) {
        for (const intf of Object.values(n.interfaces)) {
          if (intf.ip && intf.up) {
            const p = parseIpv4Cidr(intf.ip);
            if (p && p.ip === route.tunnelRemoteIp) {
              remoteEndpointNode = n;
              break;
            }
          }
        }
        if (remoteEndpointNode) break;
      }

      if (!remoteEndpointNode) {
        return {
          success: false,
          rtt: totalLatency,
          hops,
          error: `6in4 Tunnel remote endpoint ${route.tunnelRemoteIp} not found in topology`,
        };
      }

      totalLatency += 1.2;
      currentNodeId = remoteEndpointNode.id;
      continue;
    }

    // Follow link from exitInterface using getReachableL3Neighbors
    const reachablePeers = getReachableL3Neighbors(currentNodeId, route.exitInterface, nodes, links);
    if (reachablePeers.length === 0) {
      return {
        success: false,
        rtt: totalLatency,
        hops,
        error: `Link down or unplugged on interface ${route.exitInterface} of ${currentNode.name}`,
      };
    }

    let nextHopNodeId = '';
    if (route.nextHopIp) {
      for (const p of reachablePeers) {
        const pNode = p.node;
        let matches = false;
        for (const pIntf of Object.values(pNode.interfaces)) {
          if (!pIntf.up) continue;
          if (pIntf.ip) {
            const parsed = parseIpv4Cidr(pIntf.ip);
            if (parsed && (parsed.ip === route.nextHopIp || isIpv4InSubnet(route.nextHopIp, parsed.network, parsed.prefix))) {
              matches = true;
              break;
            }
          }
          if (pIntf.ipv6) {
            const parsed = parseIpv6Cidr(pIntf.ipv6);
            if (parsed && (parsed.ip === route.nextHopIp || isIpv6InSubnet(route.nextHopIp, parsed.ip, parsed.prefix))) {
              matches = true;
              break;
            }
          }
        }
        if (matches || pNode.id === destNode.id) {
          nextHopNodeId = pNode.id;
          break;
        }
      }
    }

    if (!nextHopNodeId && reachablePeers.length > 0) {
      nextHopNodeId = reachablePeers[0].node.id;
    }

    if (!nextHopNodeId || visited.has(nextHopNodeId)) {
      return {
        success: false,
        rtt: totalLatency,
        hops,
        error: `Routing loop or black hole detected at ${currentNode.name}`,
      };
    }

    totalLatency += 0.45;
    currentNodeId = nextHopNodeId;
  }

  return {
    success: false,
    rtt: totalLatency,
    hops,
    error: 'Time to live exceeded',
  };
}

export function simulateTraceroute(
  sourceNodeId: string,
  targetIp: string,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): SimulationResult {
  const isIpv6 = targetIp.includes(':');
  return simulatePing(sourceNodeId, targetIp, isIpv6, nodes, links);
}
