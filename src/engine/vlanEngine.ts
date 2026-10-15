import { NetworkNode, NetworkLink } from './types';
import { resolveInterfaceName, parseIpv4Cidr, isIpv4InSubnet } from './ipUtils';

export interface VlanPortInfo {
  portName: string;
  tag?: number;
  type: 'access' | 'trunk';
}

export interface L3NeighborEndpoint {
  node: NetworkNode;
  interfaceName: string;
}

export function parseOvsShow(node: NetworkNode): string {
  if (node.type !== 'switch') return 'Error: Not a switch node.';

  const lines: string[] = [];
  lines.push(`d89c0201-3f1a-4d43-85dc-${node.id.padStart(12, '0')}`);
  lines.push(`    Bridge ${node.name}`);
  lines.push(`        Port ${node.name}`);
  lines.push(`            Interface ${node.name}`);
  lines.push(`                type: internal`);

  for (const [intfName, intf] of Object.entries(node.interfaces)) {
    lines.push(`        Port ${intfName}`);
    if (intf.vlanTag) {
      lines.push(`            tag: ${intf.vlanTag}`);
    }
    lines.push(`            Interface ${intfName}`);
  }

  lines.push(`    ovs_version: "2.17.0"`);
  return lines.join('\n');
}

export function setSwitchPortVlan(node: NetworkNode, portName: string, tag: number): boolean {
  if (node.type !== 'switch') return false;
  const resolved = resolveInterfaceName(node, portName);
  if (!node.interfaces[resolved]) {
    node.interfaces[resolved] = {
      name: resolved,
      mac: `00:00:00:${Math.floor(Math.random() * 90 + 10)}:${Math.floor(Math.random() * 90 + 10)}:03`,
      up: true,
      vlanTag: tag,
    };
    return true;
  }
  node.interfaces[resolved].vlanTag = tag;
  return true;
}

export function removeSwitchPortVlan(node: NetworkNode, portName: string): boolean {
  if (node.type !== 'switch') return false;
  const resolved = resolveInterfaceName(node, portName);
  if (!node.interfaces[resolved]) return false;
  delete node.interfaces[resolved].vlanTag;
  return true;
}

export function canSwitchForward(node: NetworkNode, inPortName: string, outPortName: string): boolean {
  if (node.type !== 'switch') return false;
  const inPort = node.interfaces[resolveInterfaceName(node, inPortName)];
  const outPort = node.interfaces[resolveInterfaceName(node, outPortName)];
  if (!inPort || !outPort) return false;

  const inTag = inPort.vlanTag;
  const outTag = outPort.vlanTag;

  // If both ports have explicit tags, they must match
  if (inTag !== undefined && outTag !== undefined) {
    return inTag === outTag;
  }

  // If either port is untagged (trunk/uplink to core router or unconfigured), allow forwarding
  return true;
}

/**
 * Discovers all Layer 3 neighbors (Routers/Hosts) reachable from (sourceNodeId, sourcePort)
 * Traversing Layer 2 switches and enforcing VLAN isolation rules.
 */
export function getReachableL3Neighbors(
  sourceNodeId: string,
  sourcePortRaw: string,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): L3NeighborEndpoint[] {
  const sourceNode = nodes[sourceNodeId];
  if (!sourceNode) return [];

  const sourcePort = resolveInterfaceName(sourceNode, sourcePortRaw);
  const endpoints: L3NeighborEndpoint[] = [];
  const visitedEndpoints = new Set<string>();

  interface DirectHop {
    neighborId: string;
    neighborPort: string;
  }
  const directHops: DirectHop[] = [];

  for (const link of links) {
    if (link.status === 'down') continue;
    let nId = '';
    let nPortRaw = '';
    let myPortRaw = '';

    if (link.source === sourceNodeId) {
      nId = link.target;
      nPortRaw = link.targetHandle;
      myPortRaw = link.sourceHandle;
    } else if (link.target === sourceNodeId) {
      nId = link.source;
      nPortRaw = link.sourceHandle;
      myPortRaw = link.targetHandle;
    }

    if (!nId) continue;
    const nNode = nodes[nId];
    if (!nNode) continue;

    const resolvedMyPort = resolveInterfaceName(sourceNode, myPortRaw);
    const resolvedNPort = resolveInterfaceName(nNode, nPortRaw);

    const isDirectMatch =
      resolvedMyPort === sourcePort ||
      myPortRaw === sourcePort ||
      Object.keys(sourceNode.interfaces).length === 1;

    if (isDirectMatch) {
      directHops.push({ neighborId: nId, neighborPort: resolvedNPort });
    }
  }

  // Fallback: If no direct match by port handle, check if any link connects sourceNodeId to a neighbor
  // that shares an IP subnet with sourcePort interface
  if (directHops.length === 0) {
    const myIntf = sourceNode.interfaces[sourcePort];
    const myIpParsed = myIntf?.ip ? parseIpv4Cidr(myIntf.ip) : null;
    if (myIpParsed) {
      for (const link of links) {
        if (link.status === 'down') continue;
        let nId = '';
        let nPortRaw = '';
        if (link.source === sourceNodeId) {
          nId = link.target;
          nPortRaw = link.targetHandle;
        } else if (link.target === sourceNodeId) {
          nId = link.source;
          nPortRaw = link.sourceHandle;
        }
        if (!nId) continue;
        const nNode = nodes[nId];
        if (!nNode) continue;
        const resolvedNPort = resolveInterfaceName(nNode, nPortRaw);

        // Check if neighbor has matching subnet on any interface
        let hasSubnetMatch = false;
        for (const [nIntfKey, nIntf] of Object.entries(nNode.interfaces)) {
          if (nIntf.ip) {
            const nParsed = parseIpv4Cidr(nIntf.ip);
            if (nParsed && isIpv4InSubnet(nParsed.ip, myIpParsed.network, myIpParsed.prefix)) {
              hasSubnetMatch = true;
              directHops.push({ neighborId: nId, neighborPort: resolveInterfaceName(nNode, nIntfKey) });
              break;
            }
          }
        }
        if (hasSubnetMatch) break;
      }
    }
  }

  // Process each direct hop: if router/host, add to endpoints; if switch, traverse via BFS
  for (const hop of directHops) {
    const neighborNode = nodes[hop.neighborId];
    if (!neighborNode) continue;

    if (neighborNode.type === 'router' || neighborNode.type === 'host') {
      const key = `${neighborNode.id}__${hop.neighborPort}`;
      if (!visitedEndpoints.has(key)) {
        visitedEndpoints.add(key);
        endpoints.push({ node: neighborNode, interfaceName: hop.neighborPort });
      }
    } else if (neighborNode.type === 'switch') {
      // BFS through switch(es)
      const switchQueue: Array<{ switchId: string; entryPort: string }> = [
        { switchId: neighborNode.id, entryPort: hop.neighborPort }
      ];
      const visitedSwitchEntries = new Set<string>();
      visitedSwitchEntries.add(`${neighborNode.id}__${hop.neighborPort}`);

      while (switchQueue.length > 0) {
        const { switchId, entryPort } = switchQueue.shift()!;
        const currentSwitch = nodes[switchId];
        if (!currentSwitch || currentSwitch.type !== 'switch') continue;

        const inTag = currentSwitch.interfaces[entryPort]?.vlanTag;

        // Find all other links on this switch
        for (const swLink of links) {
          if (swLink.status === 'down') continue;
          let otherId = '';
          let otherPortRaw = '';
          let swPortRaw = '';

          if (swLink.source === switchId) {
            swPortRaw = swLink.sourceHandle;
            otherId = swLink.target;
            otherPortRaw = swLink.targetHandle;
          } else if (swLink.target === switchId) {
            swPortRaw = swLink.targetHandle;
            otherId = swLink.source;
            otherPortRaw = swLink.sourceHandle;
          }

          if (!otherId || otherId === sourceNodeId) continue;
          const otherNode = nodes[otherId];
          if (!otherNode) continue;

          const swPort = resolveInterfaceName(currentSwitch, swPortRaw);
          const otherPort = resolveInterfaceName(otherNode, otherPortRaw);

          // Cannot hairpin back out the same switch port
          if (swPort === entryPort) continue;

          // VLAN forwarding check on current switch
          const outTag = currentSwitch.interfaces[swPort]?.vlanTag;

          let canForward = true;
          if (inTag !== undefined && outTag !== undefined) {
            canForward = inTag === outTag;
          }

          if (!canForward) continue;

          if (otherNode.type === 'switch') {
            const entryKey = `${otherId}__${otherPort}`;
            if (!visitedSwitchEntries.has(entryKey)) {
              visitedSwitchEntries.add(entryKey);
              switchQueue.push({ switchId: otherId, entryPort: otherPort });
            }
          } else if (otherNode.type === 'router' || otherNode.type === 'host') {
            const epKey = `${otherNode.id}__${otherPort}`;
            if (!visitedEndpoints.has(epKey)) {
              visitedEndpoints.add(epKey);
              endpoints.push({ node: otherNode, interfaceName: otherPort });
            }
          }
        }
      }
    }
  }

  return endpoints;
}
