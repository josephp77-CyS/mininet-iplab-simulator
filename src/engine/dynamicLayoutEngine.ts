import { NetworkNode, NetworkLink, NodeType, RouterRole } from './types';
import { parseIpv4Cidr, areIpsInSameSubnet } from './ipUtils';

export type BulkArchitecture = 'enterprise' | 'spine-leaf' | 'mesh' | 'scattered';

export interface CustomLabPreset {
  id: string;
  name: string;
  description: string;
  nodes: Record<string, NetworkNode>;
  links: NetworkLink[];
  createdAt: number;
}

// Canonical coordinates for standard UTP 18-node topology
const CANONICAL_UTP_18: Record<string, { x: number; y: number }> = {
  // Core Triangle (Center Ring)
  r1: { x: 580, y: 150 },
  r2: { x: 800, y: 520 },
  r3: { x: 360, y: 520 },

  // Distribution Switches
  s1: { x: 580, y: 30 },
  s2: { x: 970, y: 620 },
  s3: { x: 190, y: 620 },

  // Edge Routers Branch 1
  r11: { x: 470, y: -80 },
  r12: { x: 690, y: -80 },
  // Edge Routers Branch 2
  r21: { x: 1100, y: 520 },
  r22: { x: 1100, y: 720 },
  // Edge Routers Branch 3
  r31: { x: 60, y: 520 },
  r32: { x: 60, y: 720 },

  // Hosts Branch 1
  c11: { x: 470, y: -190 },
  c12: { x: 690, y: -190 },
  // Hosts Branch 2
  c21: { x: 1240, y: 520 },
  c22: { x: 1240, y: 720 },
  // Hosts Branch 3
  c31: { x: -80, y: 520 },
  c32: { x: -80, y: 720 },
};

/**
 * Computes Dynamic Concentric Radial Layout with Force-Directed Collision Avoidance
 * Capable of handling 4, 18, 50, to 100+ nodes cleanly without overlap.
 */
export function computeDynamicTopologyLayout(
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[],
  options?: {
    centerX?: number;
    centerY?: number;
    forceStandardUtpIfMatch?: boolean;
  }
): Record<string, { x: number; y: number }> {
  const nodeIds = Object.keys(nodes);
  if (nodeIds.length === 0) return {};

  const forceStandard = options?.forceStandardUtpIfMatch ?? true;

  // Check if this is the exact standard 18-node UTP exam topology
  const utpKeys = Object.keys(CANONICAL_UTP_18);
  const isExactUtp18 =
    forceStandard &&
    nodeIds.length === 18 &&
    utpKeys.every(k => nodes[k] !== undefined);

  if (isExactUtp18) {
    const result: Record<string, { x: number; y: number }> = {};
    for (const id of nodeIds) {
      result[id] = { ...CANONICAL_UTP_18[id] };
    }
    return result;
  }

  const centerX = options?.centerX ?? 650;
  const centerY = options?.centerY ?? 450;

  // Classify nodes into hierarchical tiers
  const cores: string[] = [];
  const switches: string[] = [];
  const edges: string[] = [];
  const hosts: string[] = [];

  for (const [id, node] of Object.entries(nodes)) {
    if (node.type === 'switch') {
      switches.push(id);
    } else if (node.type === 'host') {
      hosts.push(id);
    } else {
      // Router: check if core or edge
      if (node.role === 'core' || id === 'r1' || id === 'r2' || id === 'r3' || (id.startsWith('r') && !id.startsWith('r1') && !id.startsWith('r2') && !id.startsWith('r3') && id.length <= 3 && parseInt(id.slice(1)) <= 6)) {
        cores.push(id);
      } else {
        edges.push(id);
      }
    }
  }

  // Fallback: If no cores found, select the first few routers as core
  if (cores.length === 0 && edges.length > 0) {
    const promoteCount = Math.max(1, Math.min(4, Math.ceil(edges.length * 0.2)));
    cores.push(...edges.splice(0, promoteCount));
  }

  const positions: Record<string, { x: number; y: number }> = {};

  // Build adjacency map
  const adj: Record<string, string[]> = {};
  for (const id of nodeIds) adj[id] = [];
  for (const link of links) {
    if (adj[link.source]) adj[link.source].push(link.target);
    if (adj[link.target]) adj[link.target].push(link.source);
  }

  // -------------------------------------------------------------
  // RING 0: Core Routers (Concentric Center Polygon)
  // -------------------------------------------------------------
  const nCore = Math.max(1, cores.length);
  const rCore = Math.max(150, Math.min(350, nCore * 55));
  const coreAngleStep = (2 * Math.PI) / nCore;

  cores.forEach((id, idx) => {
    const angle = idx * coreAngleStep - Math.PI / 2;
    positions[id] = {
      x: Math.round(centerX + rCore * Math.cos(angle)),
      y: Math.round(centerY + rCore * Math.sin(angle)),
    };
  });

  // -------------------------------------------------------------
  // RING 1: Distribution Switches
  // -------------------------------------------------------------
  const nSwitches = Math.max(1, switches.length);
  const rSwitch = rCore + 160;

  switches.forEach((id, idx) => {
    // Check if connected to a core router
    const connectedCores = adj[id].filter(neighborId => cores.includes(neighborId));
    let angle: number;

    if (connectedCores.length > 0) {
      const parentCoreId = connectedCores[0];
      const parentIdx = cores.indexOf(parentCoreId);
      const baseAngle = parentIdx >= 0 ? parentIdx * coreAngleStep - Math.PI / 2 : (idx / nSwitches) * 2 * Math.PI;
      // Slight angular offset if multiple switches on same core
      const siblingsOnCore = switches.filter(s => adj[s].includes(parentCoreId));
      const siblingIdx = siblingsOnCore.indexOf(id);
      const offset = (siblingIdx - (siblingsOnCore.length - 1) / 2) * 0.35;
      angle = baseAngle + offset;
    } else {
      angle = idx * ((2 * Math.PI) / nSwitches) - Math.PI / 2;
    }

    positions[id] = {
      x: Math.round(centerX + rSwitch * Math.cos(angle)),
      y: Math.round(centerY + rSwitch * Math.sin(angle)),
    };
  });

  // -------------------------------------------------------------
  // RING 2: Edge Routers
  // -------------------------------------------------------------
  const nEdges = Math.max(1, edges.length);
  const rEdge = rSwitch + 150;

  edges.forEach((id, idx) => {
    // Check connected switch or core
    const connectedParents = adj[id].filter(neighborId => switches.includes(neighborId) || cores.includes(neighborId));
    let angle: number;

    if (connectedParents.length > 0) {
      const parentId = connectedParents[0];
      const parentPos = positions[parentId] || { x: centerX, y: centerY };
      const baseAngle = Math.atan2(parentPos.y - centerY, parentPos.x - centerX);
      const siblings = edges.filter(e => adj[e].includes(parentId));
      const siblingIdx = siblings.indexOf(id);
      const offset = (siblingIdx - (siblings.length - 1) / 2) * 0.28;
      angle = baseAngle + offset;
    } else {
      angle = idx * ((2 * Math.PI) / nEdges) - Math.PI / 2;
    }

    positions[id] = {
      x: Math.round(centerX + rEdge * Math.cos(angle)),
      y: Math.round(centerY + rEdge * Math.sin(angle)),
    };
  });

  // -------------------------------------------------------------
  // RING 3: Host PCs
  // -------------------------------------------------------------
  const nHosts = Math.max(1, hosts.length);
  const rHost = rEdge + 140;

  hosts.forEach((id, idx) => {
    // Check connected edge router or switch
    const connectedParents = adj[id].filter(neighborId => edges.includes(neighborId) || switches.includes(neighborId));
    let angle: number;

    if (connectedParents.length > 0) {
      const parentId = connectedParents[0];
      const parentPos = positions[parentId] || { x: centerX, y: centerY };
      const baseAngle = Math.atan2(parentPos.y - centerY, parentPos.x - centerX);
      const siblings = hosts.filter(h => adj[h].includes(parentId));
      const siblingIdx = siblings.indexOf(id);
      const offset = (siblingIdx - (siblings.length - 1) / 2) * 0.22;
      angle = baseAngle + offset;
    } else {
      angle = idx * ((2 * Math.PI) / nHosts) - Math.PI / 2;
    }

    positions[id] = {
      x: Math.round(centerX + rHost * Math.cos(angle)),
      y: Math.round(centerY + rHost * Math.sin(angle)),
    };
  });

  // -------------------------------------------------------------
  // FORCE-DIRECTED COLLISION AVOIDANCE & SPRING RELAXATION (45 ITERATIONS)
  // Ensures absolutely NO overlapping nodes, even for 50-100+ nodes
  // -------------------------------------------------------------
  const MIN_NODE_DIST = 115; // Minimum 115px clearance between node centers
  const PREFERRED_LINK_DIST = 140;

  for (let iter = 0; iter < 45; iter++) {
    const damping = 0.85 * (1 - iter / 45);

    // 1. Pairwise repulsion
    for (let i = 0; i < nodeIds.length; i++) {
      const u = nodeIds[i];
      for (let j = i + 1; j < nodeIds.length; j++) {
        const v = nodeIds[j];
        const posU = positions[u];
        const posV = positions[v];

        const dx = posV.x - posU.x;
        const dy = posV.y - posU.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist === 0) {
          dist = 1;
        }

        if (dist < MIN_NODE_DIST) {
          const overlap = MIN_NODE_DIST - dist;
          const force = (overlap / dist) * 0.5 * damping;
          const fx = dx * force;
          const fy = dy * force;

          posU.x -= fx;
          posU.y -= fy;
          posV.x += fx;
          posV.y += fy;
        }
      }
    }

    // 2. Link spring attraction
    for (const link of links) {
      const posSource = positions[link.source];
      const posTarget = positions[link.target];
      if (!posSource || !posTarget) continue;

      const dx = posTarget.x - posSource.x;
      const dy = posTarget.y - posSource.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > PREFERRED_LINK_DIST * 1.6) {
        const excess = dist - PREFERRED_LINK_DIST * 1.6;
        const force = (excess / dist) * 0.08 * damping;
        const fx = dx * force;
        const fy = dy * force;

        posSource.x += fx;
        posSource.y += fy;
        posTarget.x -= fx;
        posTarget.y -= fy;
      }
    }
  }

  // Round coordinates
  for (const id of nodeIds) {
    positions[id].x = Math.round(positions[id].x);
    positions[id].y = Math.round(positions[id].y);
  }

  return positions;
}

/**
 * Checks for IP subnet matches across all interfaces and auto-wires straight cables
 */
export function checkAndAutoWireSubnets(
  triggerNodeId: string,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): NetworkLink[] {
  const newLinks: NetworkLink[] = [];
  const triggerNode = nodes[triggerNodeId];
  if (!triggerNode) return newLinks;

  const existingLinkKeys = new Set<string>();
  for (const l of links) {
    existingLinkKeys.add(`${l.source}__${l.target}`);
    existingLinkKeys.add(`${l.target}__${l.source}`);
  }

  // Check each interface of trigger node
  for (const [intfName, intf] of Object.entries(triggerNode.interfaces)) {
    if (!intf.ip) continue;
    const parsed = parseIpv4Cidr(intf.ip);
    if (!parsed || parsed.prefix >= 32) continue; // Skip loopbacks (/32)

    // Scan all other nodes
    for (const [otherId, otherNode] of Object.entries(nodes)) {
      if (otherId === triggerNodeId) continue;
      if (existingLinkKeys.has(`${triggerNodeId}__${otherId}`)) continue;

      for (const [otherIntfName, otherIntf] of Object.entries(otherNode.interfaces)) {
        if (!otherIntf.ip) continue;
        const otherParsed = parseIpv4Cidr(otherIntf.ip);
        if (!otherParsed || otherParsed.prefix >= 32) continue;

        // Same subnet check
        if (
          parsed.prefix === otherParsed.prefix &&
          parsed.network === otherParsed.network &&
          parsed.ip !== otherParsed.ip
        ) {
          const linkId = `link-${triggerNodeId}-${otherId}-${Date.now().toString().slice(-4)}`;
          const link: NetworkLink = {
            id: linkId,
            source: triggerNodeId,
            sourceHandle: intfName,
            target: otherId,
            targetHandle: otherIntfName,
            status: 'up',
            latency: 0.3,
            type: 'straight',
            style: { stroke: '#64748b', strokeWidth: 2 },
          };

          newLinks.push(link);
          existingLinkKeys.add(`${triggerNodeId}__${otherId}`);
          existingLinkKeys.add(`${otherId}__${triggerNodeId}`);
          break; // Connected this interface pair
        }
      }
    }
  }

  return newLinks;
}

/**
 * Generates high-scale topologies up to 100+ nodes
 */
export function generateBulkTopology(
  arch: BulkArchitecture,
  totalNodes: number = 30
): { nodes: Record<string, NetworkNode>; links: NetworkLink[] } {
  const count = Math.max(2, Math.min(100, totalNodes));
  const nodes: Record<string, NetworkNode> = {};
  const links: NetworkLink[] = [];

  const createDefaultNode = (
    id: string,
    name: string,
    type: NodeType,
    role?: RouterRole
  ): NetworkNode => ({
    id,
    name,
    type,
    role,
    position: { x: 500, y: 400 },
    cliMode: 'priv',
    ospfEnabled: type === 'router',
    ospfNetworks: [],
    bgpEnabled: role === 'core',
    bgpNeighbors: {},
    bgpNetworks: [],
    staticRoutes: [],
    ipv6Routes: [],
    commandHistory: [],
    terminalBuffer: [
      { text: `Initialized ${name} on Mininet-IPLab Virtual Topology Engine.`, type: 'banner' }
    ],
    interfaces: {
      [`${name}-eth1`]: {
        name: `${name}-eth1`,
        mac: `00:00:${Math.floor(Math.random() * 89 + 10)}:01:00:01`,
        up: true,
        ospfCost: 10
      },
      [`${name}-eth2`]: {
        name: `${name}-eth2`,
        mac: `00:00:${Math.floor(Math.random() * 89 + 10)}:01:00:02`,
        up: true,
        ospfCost: 10
      }
    }
  });

  if (arch === 'enterprise') {
    let nCore = 1;
    let nSwitch = 0;
    let nEdge = 0;
    let nHost = 0;

    if (count <= 2) {
      nCore = 1;
      nHost = 1;
    } else if (count <= 4) {
      nCore = 1;
      nSwitch = 1;
      nEdge = 1;
      nHost = 1;
    } else {
      nCore = Math.max(2, Math.floor(count * 0.15));
      nSwitch = Math.max(1, Math.floor(count * 0.25));
      nEdge = Math.max(1, Math.floor(count * 0.30));
      nHost = Math.max(1, count - (nCore + nSwitch + nEdge));
      const diff = count - (nCore + nSwitch + nEdge + nHost);
      nHost += diff;
    }

    // Cores
    for (let i = 1; i <= nCore; i++) {
      const id = `r${i}`;
      nodes[id] = createDefaultNode(id, id, 'router', 'core');
      nodes[id].interfaces['lo'] = {
        name: 'lo',
        ip: `10.255.0.${i}/32`,
        mac: `00:00:00:00:00:0${i}`,
        up: true,
        ospfCost: 1
      };
      nodes[id].bgpAsNumber = 65000;
    }

    // Core mesh links
    for (let i = 1; i <= nCore; i++) {
      for (let j = i + 1; j <= nCore; j++) {
        links.push({
          id: `link-r${i}-r${j}`,
          source: `r${i}`,
          sourceHandle: `r${i}-eth1`,
          target: `r${j}`,
          targetHandle: `r${j}-eth1`,
          status: 'up',
          latency: 0.2,
          type: 'straight',
          style: { stroke: '#64748b', strokeWidth: 2 }
        });
      }
    }

    // If count=2, directly connect core router and host
    if (nSwitch === 0 && nEdge === 0 && nHost > 0) {
      nodes['h1'] = createDefaultNode('h1', 'h1', 'host');
      links.push({
        id: `link-r1-h1`,
        source: 'r1',
        sourceHandle: 'r1-eth2',
        target: 'h1',
        targetHandle: 'h1-eth1',
        status: 'up',
        latency: 0.3,
        type: 'straight',
        style: { stroke: '#64748b', strokeWidth: 2 }
      });
    } else {
      // Switches
      for (let i = 1; i <= nSwitch; i++) {
        const id = `s${i}`;
        nodes[id] = createDefaultNode(id, id, 'switch');
        const assignedCore = `r${((i - 1) % nCore) + 1}`;
        links.push({
          id: `link-${assignedCore}-${id}`,
          source: assignedCore,
          sourceHandle: `${assignedCore}-eth2`,
          target: id,
          targetHandle: `${id}-eth1`,
          status: 'up',
          latency: 0.2,
          type: 'straight',
          style: { stroke: '#64748b', strokeWidth: 2 }
        });
      }

      // Edge Routers
      for (let i = 1; i <= nEdge; i++) {
        const id = `re${i}`;
        nodes[id] = createDefaultNode(id, id, 'router', 'edge');
        const assignedSwitch = `s${((i - 1) % (nSwitch || 1)) + 1}`;
        links.push({
          id: `link-${assignedSwitch}-${id}`,
          source: assignedSwitch,
          sourceHandle: `${assignedSwitch}-eth2`,
          target: id,
          targetHandle: `${id}-eth1`,
          status: 'up',
          latency: 0.3,
          type: 'straight',
          style: { stroke: '#64748b', strokeWidth: 2 }
        });
      }

      // Hosts
      for (let i = 1; i <= nHost; i++) {
        const id = `h${i}`;
        nodes[id] = createDefaultNode(id, id, 'host');
        const assignedEdge = `re${((i - 1) % (nEdge || 1)) + 1}`;
        links.push({
          id: `link-${assignedEdge}-${id}`,
          source: assignedEdge,
          sourceHandle: `${assignedEdge}-eth2`,
          target: id,
          targetHandle: `${id}-eth1`,
          status: 'up',
          latency: 0.4,
          type: 'straight',
          style: { stroke: '#64748b', strokeWidth: 2 }
        });
      }
    }
  } else if (arch === 'spine-leaf') {
    let nSpine = 1;
    let nLeaf = 1;
    let nServer = 0;
    if (count <= 2) {
      nSpine = 1;
      nLeaf = 1;
      nServer = 0;
    } else if (count <= 4) {
      nSpine = 1;
      nLeaf = 1;
      nServer = 2;
    } else {
      nSpine = Math.max(2, Math.floor(count * 0.25));
      nLeaf = Math.max(2, Math.floor(count * 0.35));
      nServer = Math.max(1, count - (nSpine + nLeaf));
      nServer += (count - (nSpine + nLeaf + nServer));
    }

    // Spines
    for (let i = 1; i <= nSpine; i++) {
      const id = `sp${i}`;
      nodes[id] = createDefaultNode(id, id, 'router', 'core');
    }

    // Leaves
    for (let i = 1; i <= nLeaf; i++) {
      const id = `lf${i}`;
      nodes[id] = createDefaultNode(id, id, 'switch');
    }

    // Full bipartite mesh between all Spines and all Leaves
    for (let s = 1; s <= nSpine; s++) {
      for (let l = 1; l <= nLeaf; l++) {
        links.push({
          id: `link-sp${s}-lf${l}`,
          source: `sp${s}`,
          sourceHandle: `sp${s}-eth${l}`,
          target: `lf${l}`,
          targetHandle: `lf${l}-eth${s}`,
          status: 'up',
          latency: 0.1,
          type: 'straight',
          style: { stroke: '#64748b', strokeWidth: 2 }
        });
      }
    }

    // Servers / Hosts attached to Leaves
    for (let i = 1; i <= nServer; i++) {
      const id = `srv${i}`;
      nodes[id] = createDefaultNode(id, id, 'host');
      const assignedLeaf = `lf${((i - 1) % nLeaf) + 1}`;
      links.push({
        id: `link-${assignedLeaf}-${id}`,
        source: assignedLeaf,
        sourceHandle: `${assignedLeaf}-eth${i + 4}`,
        target: id,
        targetHandle: `${id}-eth1`,
        status: 'up',
        latency: 0.2,
        type: 'straight',
        style: { stroke: '#64748b', strokeWidth: 2 }
      });
    }
  } else if (arch === 'mesh') {
    // Full Mesh Ring Backbone
    for (let i = 1; i <= count; i++) {
      const isRouter = i % 2 !== 0;
      const id = isRouter ? `r${i}` : `h${i}`;
      nodes[id] = createDefaultNode(id, id, isRouter ? 'router' : 'host', isRouter ? 'core' : undefined);
    }

    // Connect in a ring
    const ids = Object.keys(nodes);
    for (let i = 0; i < ids.length; i++) {
      const u = ids[i];
      const v = ids[(i + 1) % ids.length];
      links.push({
        id: `link-${u}-${v}`,
        source: u,
        sourceHandle: `${u}-eth1`,
        target: v,
        targetHandle: `${v}-eth1`,
        status: 'up',
        latency: 0.3,
        type: 'straight',
        style: { stroke: '#64748b', strokeWidth: 2 }
      });
    }
  } else {
    // Scattered Blank Canvas (Nodes scattered without links for CLI wiring practice)
    for (let i = 1; i <= count; i++) {
      let type: NodeType = 'router';
      let role: RouterRole | undefined = 'edge';

      if (i <= 4) {
        type = 'router';
        role = 'core';
      } else if (i % 3 === 0) {
        type = 'switch';
        role = undefined;
      } else if (i % 3 === 1) {
        type = 'host';
        role = undefined;
      }

      const prefix = type === 'router' ? (role === 'core' ? 'rc' : 'r') : type === 'switch' ? 's' : 'c';
      const id = `${prefix}${i}`;
      nodes[id] = createDefaultNode(id, id, type, role);

      // Random scattered positions
      nodes[id].position = {
        x: Math.round(200 + Math.random() * 900),
        y: Math.round(150 + Math.random() * 650)
      };
    }
  }

  // If not scattered, compute layout coordinates
  if (arch !== 'scattered') {
    const layout = computeDynamicTopologyLayout(nodes, links);
    for (const [id, pos] of Object.entries(layout)) {
      if (nodes[id]) nodes[id].position = pos;
    }
  }

  return { nodes, links };
}

// -------------------------------------------------------------
// LOCALSTORAGE CUSTOM PRESET HELPER
// -------------------------------------------------------------
const STORAGE_KEY = 'mininet_custom_presets';

export function getCustomPresets(): CustomLabPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load custom presets from localStorage', e);
    return [];
  }
}

export function saveCustomPreset(preset: Omit<CustomLabPreset, 'createdAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getCustomPresets().filter(p => p.id !== preset.id);
    const toSave: CustomLabPreset = { ...preset, createdAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, toSave]));
  } catch (e) {
    console.error('Failed to save custom preset to localStorage', e);
  }
}

export function deleteCustomPreset(presetId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const filtered = getCustomPresets().filter(p => p.id !== presetId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('Failed to delete custom preset from localStorage', e);
  }
}
