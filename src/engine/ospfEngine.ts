import { NetworkNode, NetworkLink, OspfNeighbor, RouteEntry } from './types';
import { parseIpv4Cidr, isIpv4InSubnet, getNetworkAddress, resolveInterfaceName } from './ipUtils';
import { getReachableL3Neighbors } from './vlanEngine';

export function getRouterId(node: NetworkNode): string {
  if (node.ospfRouterId) return node.ospfRouterId;
  // Loopback IP if exists
  if (node.interfaces['lo']?.ip) {
    const parsed = parseIpv4Cidr(node.interfaces['lo'].ip);
    if (parsed) return parsed.ip;
  }
  // Highest interface IP
  let highestIp = '0.0.0.0';
  for (const intf of Object.values(node.interfaces)) {
    if (intf.ip && intf.up) {
      const parsed = parseIpv4Cidr(intf.ip);
      if (parsed && parsed.ip > highestIp) {
        highestIp = parsed.ip;
      }
    }
  }
  return highestIp !== '0.0.0.0' ? highestIp : '1.1.1.1';
}

export function isInterfaceInOspf(node: NetworkNode, intfNameRaw: string): { inOspf: boolean; area?: number } {
  if (!node.ospfEnabled) return { inOspf: false };
  const intfName = resolveInterfaceName(node, intfNameRaw);
  const intf = node.interfaces[intfName];
  if (!intf || !intf.ip || !intf.up) return { inOspf: false };

  const parsed = parseIpv4Cidr(intf.ip);
  if (!parsed) return { inOspf: false };

  for (const net of node.ospfNetworks) {
    if (isIpv4InSubnet(parsed.ip, net.network, net.prefix)) {
      const normalizedArea = typeof net.area === 'string' && net.area === '0.0.0.0' ? 0 : Number(net.area) || 0;
      return { inOspf: true, area: normalizedArea };
    }
  }
  return { inOspf: false };
}

// Find connected peer interfaces taking switches and VLANs into account
export function findConnectedPeers(
  nodeId: string,
  intfName: string,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): Array<{ targetNodeId: string; targetIntfName: string }> {
  const reachable = getReachableL3Neighbors(nodeId, intfName, nodes, links);
  return reachable.map(ep => ({
    targetNodeId: ep.node.id,
    targetIntfName: ep.interfaceName,
  }));
}

// Compute OSPF Neighbors for a specific router
export function computeOspfNeighbors(
  nodeId: string,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): OspfNeighbor[] {
  const node = nodes[nodeId];
  if (!node || !node.ospfEnabled) return [];

  const neighbors: OspfNeighbor[] = [];
  const visitedPeers = new Set<string>();

  for (const [intfName, intf] of Object.entries(node.interfaces)) {
    if (!intf.ip || !intf.up) continue;
    const localOspf = isInterfaceInOspf(node, intfName);
    if (!localOspf.inOspf) continue;

    const localParsed = parseIpv4Cidr(intf.ip);
    if (!localParsed) continue;

    const peers = findConnectedPeers(nodeId, intfName, nodes, links);

    for (const peer of peers) {
      const peerNode = nodes[peer.targetNodeId];
      if (!peerNode || peerNode.type !== 'router' || !peerNode.ospfEnabled) continue;

      const peerIntfName = resolveInterfaceName(peerNode, peer.targetIntfName);
      const peerIntf = peerNode.interfaces[peerIntfName];
      if (!peerIntf || !peerIntf.ip || !peerIntf.up) continue;

      const peerOspf = isInterfaceInOspf(peerNode, peerIntfName);
      if (!peerOspf.inOspf || peerOspf.area !== localOspf.area) continue;

      const peerParsed = parseIpv4Cidr(peerIntf.ip);
      if (!peerParsed) continue;

      // Check if both IPs are in the same subnet
      if (isIpv4InSubnet(peerParsed.ip, localParsed.network, localParsed.prefix)) {
        const neighborRouterId = getRouterId(peerNode);
        if (!visitedPeers.has(neighborRouterId)) {
          visitedPeers.add(neighborRouterId);
          neighbors.push({
            neighborId: neighborRouterId,
            priority: 1,
            state: 'Full/DR',
            deadTime: '00:00:36',
            address: peerParsed.ip,
            interfaceName: intfName,
          });
        }
      }
    }
  }

  return neighbors;
}

// Dijkstra Shortest Path Calculation for OSPF Routes
export function computeOspfRoutes(
  nodeId: string,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): RouteEntry[] {
  const sourceNode = nodes[nodeId];
  if (!sourceNode || !sourceNode.ospfEnabled) return [];

  // Graph vertices: all routers in OSPF
  const ospfRouters = Object.values(nodes).filter(n => n.type === 'router' && n.ospfEnabled);
  const distances: Record<string, number> = {};
  const previous: Record<string, { routerId: string; nextHopIp: string; exitInterface: string } | null> = {};
  const unvisited = new Set<string>();

  for (const r of ospfRouters) {
    distances[r.id] = Infinity;
    previous[r.id] = null;
    unvisited.add(r.id);
  }

  distances[nodeId] = 0;

  while (unvisited.size > 0) {
    // Find vertex with min distance
    let currentId: string | null = null;
    let minDist = Infinity;
    for (const id of unvisited) {
      if (distances[id] < minDist) {
        minDist = distances[id];
        currentId = id;
      }
    }

    if (!currentId || minDist === Infinity) break;
    unvisited.delete(currentId);

    const currentNode = nodes[currentId];
    if (!currentNode) continue;

    // Explore neighbors
    for (const [intfName, intf] of Object.entries(currentNode.interfaces)) {
      if (!intf.ip || !intf.up) continue;
      const currentOspf = isInterfaceInOspf(currentNode, intfName);
      if (!currentOspf.inOspf) continue;

      const cost = intf.ospfCost || 10;
      const peers = findConnectedPeers(currentId, intfName, nodes, links);

      for (const peer of peers) {
        const peerNode = nodes[peer.targetNodeId];
        if (!peerNode || !unvisited.has(peerNode.id) || !peerNode.ospfEnabled) continue;

        const peerIntfName = resolveInterfaceName(peerNode, peer.targetIntfName);
        const peerIntf = peerNode.interfaces[peerIntfName];
        if (!peerIntf || !peerIntf.ip || !peerIntf.up) continue;

        const peerOspf = isInterfaceInOspf(peerNode, peerIntfName);
        if (!peerOspf.inOspf || peerOspf.area !== currentOspf.area) continue;

        const peerParsed = parseIpv4Cidr(peerIntf.ip);
        if (!peerParsed) continue;

        const alt = distances[currentId] + cost;
        if (alt < distances[peerNode.id]) {
          distances[peerNode.id] = alt;

          // Next hop from source
          if (currentId === nodeId) {
            previous[peerNode.id] = {
              routerId: currentId,
              nextHopIp: peerParsed.ip,
              exitInterface: intfName,
            };
          } else {
            previous[peerNode.id] = previous[currentId];
          }
        }
      }
    }
  }

  // Generate routes to networks advertised by other routers
  const ospfRoutes: RouteEntry[] = [];
  const localNetworks = new Set<string>();

  for (const intf of Object.values(sourceNode.interfaces)) {
    if (intf.ip) {
      const p = parseIpv4Cidr(intf.ip);
      if (p) localNetworks.add(`${p.network}/${p.prefix}`);
    }
  }

  for (const r of ospfRouters) {
    if (r.id === nodeId) continue;
    const pathInfo = previous[r.id];
    if (!pathInfo || distances[r.id] === Infinity) continue;

    // Check all networks r is advertising
    for (const [rIntfName, rIntf] of Object.entries(r.interfaces)) {
      if (!rIntf.ip || !rIntf.up) continue;
      const rOspf = isInterfaceInOspf(r, rIntfName);
      if (!rOspf.inOspf) continue;

      const parsed = parseIpv4Cidr(rIntf.ip);
      if (!parsed) continue;

      const netKey = `${parsed.network}/${parsed.prefix}`;
      if (!localNetworks.has(netKey)) {
        const existingIdx = ospfRoutes.findIndex(rt => rt.destination === parsed.network && rt.prefix === parsed.prefix);
        const metric = distances[r.id];

        if (existingIdx === -1) {
          ospfRoutes.push({
            type: 'O',
            destination: parsed.network,
            prefix: parsed.prefix,
            nextHop: pathInfo.nextHopIp,
            interfaceName: pathInfo.exitInterface,
            metric: metric,
          });
        } else if ((ospfRoutes[existingIdx].metric || 9999) > metric) {
          ospfRoutes[existingIdx] = {
            type: 'O',
            destination: parsed.network,
            prefix: parsed.prefix,
            nextHop: pathInfo.nextHopIp,
            interfaceName: pathInfo.exitInterface,
            metric: metric,
          };
        }
      }
    }
  }

  return ospfRoutes;
}
