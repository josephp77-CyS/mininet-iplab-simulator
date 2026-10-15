import { NetworkNode, NetworkLink } from './types';
import { parseIpv4Cidr, parseIpv6Cidr, netmaskToPrefix, resolveInterfaceName } from './ipUtils';
import { computeOspfNeighbors, computeOspfRoutes, getRouterId } from './ospfEngine';
import { computeBgpNeighbors, computeBgpRoutes, getBgpRouterId } from './bgpEngine';
import { parseOvsShow, setSwitchPortVlan, removeSwitchPortVlan } from './vlanEngine';
import { addSitTunnel, formatTunnelShow } from './tunnelEngine';
import { simulatePing, simulateTraceroute } from './packetSimulator';

export interface CliExecutionResult {
  output: string;
  type?: 'output' | 'error' | 'success' | 'info' | 'system' | 'banner';
  clear?: boolean;
  createdLink?: {
    sourceNodeId: string;
    sourceInterface: string;
    targetNodeId: string;
    targetInterface: string;
  };
}

export function getPrompt(node: NetworkNode): string {
  if (node.type === 'host') {
    return `root@${node.name}:~# `;
  }
  if (node.type === 'switch') {
    return `${node.name}# `;
  }
  // Router
  switch (node.cliMode) {
    case 'exec':
      return `${node.name}> `;
    case 'priv':
      return `${node.name}# `;
    case 'config':
      return `${node.name}(config)# `;
    case 'config-if':
      return `${node.name}(config-if)# `;
    case 'config-router-ospf':
    case 'config-router-bgp':
      return `${node.name}(config-router)# `;
    case 'config-route-map':
      return `${node.name}(config-route-map)# `;
    default:
      return `${node.name}# `;
  }
}

export function executeCommand(
  rawCommand: string,
  nodeId: string,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): CliExecutionResult {
  const node = nodes[nodeId];
  if (!node) return { output: 'Node not found', type: 'error' };

  const trimmed = rawCommand.trim();
  if (!trimmed) return { output: '' };

  node.commandHistory.push(trimmed);

  // Global cross-node connect command: connect <local_intf> <target_node> <target_intf>
  const parts = trimmed.split(/\s+/);
  const verb = parts[0].toLowerCase();

  if (verb === 'connect' && parts.length >= 4) {
    const localIntf = parts[1];
    const targetQuery = parts[2];
    const targetIntf = parts[3];

    const targetNode = Object.values(nodes).find(
      n => n.id.toLowerCase() === targetQuery.toLowerCase() || n.name.toLowerCase() === targetQuery.toLowerCase()
    );

    if (!targetNode) {
      return { output: `% Target node '${targetQuery}' not found in topology`, type: 'error' };
    }

    // Auto-create local interface if missing
    if (!node.interfaces[localIntf]) {
      node.interfaces[localIntf] = {
        name: localIntf,
        mac: `00:00:00:${Math.floor(Math.random() * 90 + 10)}:${Math.floor(Math.random() * 90 + 10)}:01`,
        up: true,
        ospfCost: 10
      };
    }

    // Auto-create target interface if missing
    if (!targetNode.interfaces[targetIntf]) {
      targetNode.interfaces[targetIntf] = {
        name: targetIntf,
        mac: `00:00:00:${Math.floor(Math.random() * 90 + 10)}:${Math.floor(Math.random() * 90 + 10)}:02`,
        up: true,
        ospfCost: 10
      };
    }

    return {
      output: `[OK] Connected ${node.name}:${localIntf} <---> ${targetNode.name}:${targetIntf}`,
      type: 'success',
      createdLink: {
        sourceNodeId: node.id,
        sourceInterface: localIntf,
        targetNodeId: targetNode.id,
        targetInterface: targetIntf
      }
    };
  }

  // Router CLI
  if (node.type === 'router') {
    return handleRouterCommand(trimmed, node, nodes, links);
  }

  // Switch CLI (Open vSwitch)
  if (node.type === 'switch') {
    return handleSwitchCommand(trimmed, node, nodes, links);
  }

  // Host CLI (Linux)
  return handleHostCommand(trimmed, node, nodes, links);
}

// -------------------------------------------------------------
// HELPER: Interface Normalization & Dynamic Creation
// -------------------------------------------------------------
function resolveOrCreateInterface(node: NetworkNode, rawName: string): string {
  const resolved = resolveInterfaceName(node, rawName);
  if (node.interfaces[resolved]) {
    return resolved;
  }
  let name = resolved;
  if (!name.includes('-') && !name.toLowerCase().startsWith('lo') && /^eth\d+$/i.test(name)) {
    name = `${node.name}-${name}`;
  }
  if (!node.interfaces[name]) {
    node.interfaces[name] = {
      name,
      mac: `00:00:00:${Math.floor(Math.random() * 90 + 10)}:${Math.floor(Math.random() * 90 + 10)}:01`,
      up: true,
      ospfCost: 10
    };
  }
  return name;
}

// -------------------------------------------------------------
// ROUTER CLI HANDLER (FRRouting vtysh style + Smart Auto-Elevation)
// -------------------------------------------------------------
function handleRouterCommand(
  cmd: string,
  node: NetworkNode,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): CliExecutionResult {
  const parts = cmd.split(/\s+/);
  const verb = parts[0].toLowerCase();

  // vtysh friendly banner
  if (verb === 'vtysh') {
    return {
      output: 'Hello, this is FRRouting (version 8.1).\nCopyright 1996-2005 Kunihiro Ishiguro, et al.',
      type: 'banner'
    };
  }

  // Clear screen
  if (verb === 'clear' && parts.length === 1) {
    return { output: '', clear: true };
  }

  // Handle 'do <cmd>' in any configuration mode
  if (verb === 'do') {
    const doCmd = parts.slice(1).join(' ');
    const originalMode = node.cliMode;
    node.cliMode = 'priv';
    const res = handleRouterCommand(doCmd, node, nodes, links);
    node.cliMode = originalMode;
    return res;
  }

  // Forgiving Show / Ping / Traceroute execution directly from sub-modes without requiring 'do'
  const isShowOrDiagnostic =
    verb === 'show' ||
    verb === 'sh' ||
    verb === 'ping' ||
    verb === 'ping6' ||
    verb === 'traceroute' ||
    verb === 'wr' ||
    cmd.match(/^write(\s+m(emory)?)?$/i) ||
    cmd.match(/^copy\s+(run|running-config)\s+(start|startup-config)$/i);

  if (
    isShowOrDiagnostic &&
    (node.cliMode === 'config' ||
      node.cliMode === 'config-if' ||
      node.cliMode === 'config-router-ospf' ||
      node.cliMode === 'config-router-bgp' ||
      node.cliMode === 'config-route-map')
  ) {
    const originalMode = node.cliMode;
    node.cliMode = 'priv';
    const res = handleRouterCommand(cmd, node, nodes, links);
    node.cliMode = originalMode;
    return res;
  }

  // Mode Navigation
  if (verb === 'enable' || verb === 'en') {
    node.cliMode = 'priv';
    return { output: '' };
  }
  if (verb === 'disable') {
    node.cliMode = 'exec';
    return { output: '' };
  }

  // Smart conf t: switches to config from ANY mode
  if (cmd.match(/^conf(igure)?(\s+t(erminal)?)?$/i) || cmd === 'config' || cmd === 'config t') {
    node.cliMode = 'config';
    return { output: '' };
  }

  // Exit / Quit / Q (Step down one level)
  if (verb === 'exit' || verb === 'quit' || verb === 'q') {
    if (node.cliMode === 'config-route-map') {
      node.cliMode = 'config';
      node.activeRouteMap = undefined;
      return { output: '' };
    }
    if (
      node.cliMode === 'config-if' ||
      node.cliMode === 'config-router-ospf' ||
      node.cliMode === 'config-router-bgp'
    ) {
      node.cliMode = 'config';
      return { output: '' };
    }
    if (node.cliMode === 'config') {
      node.cliMode = 'priv';
      return { output: '' };
    }
    if (node.cliMode === 'priv') {
      node.cliMode = 'exec';
      return { output: '' };
    }
    return { output: '' };
  }

  // End / Ctrl+Z: return immediately to priv
  if (verb === 'end' || cmd === '^Z' || cmd === 'ctrl+z') {
    node.cliMode = 'priv';
    node.activeRouteMap = undefined;
    return { output: '' };
  }

  // Hostname change
  if (verb === 'hostname' && parts.length >= 2) {
    node.name = parts[1];
    return { output: '' };
  }

  // Save Config: write memory, wr, copy run start
  if (
    cmd.match(/^wr(ite)?(\s+m(emory)?)?$/i) ||
    cmd.match(/^copy\s+(run|running-config)\s+(start|startup-config)$/i)
  ) {
    return {
      output: 'Building Configuration...\nIntegrated configuration saved to /etc/frr/frr.conf\n[OK]',
      type: 'success'
    };
  }

  // -----------------------------------------------------------
  // SMART AUTO-ELEVATION: Config commands entered without 'conf t'
  // -----------------------------------------------------------
  const isInterfaceCmd = verb === 'interface' || verb === 'int';
  const isRouterOspfCmd = cmd.match(/^router\s+ospf/i);
  const isRouterBgpCmd = cmd.match(/^router\s+bgp/i);
  const isRouteMapCmd = cmd.match(/^route-map\s+/i);
  const isIpRouteConfig = cmd.match(/^ip\s+route\s+/i) && parts.length >= 4;

  if (isInterfaceCmd || isRouterOspfCmd || isRouterBgpCmd || isRouteMapCmd || isIpRouteConfig) {
    // If user is currently in exec or priv, auto-elevate without throwing error
    if (node.cliMode === 'exec' || node.cliMode === 'priv') {
      node.cliMode = 'config';
    }
  }

  // Interface Selection: `interface <name>` / `int <name>`
  if (isInterfaceCmd && parts.length >= 2) {
    const rawName = parts[1];
    const resolved = resolveOrCreateInterface(node, rawName);
    node.selectedInterface = resolved;
    node.cliMode = 'config-if';
    return { output: '' };
  }

  // Interface Reset: `no interface <name>`
  if (cmd.match(/^no\s+(interface|int)\s+/i) && parts.length >= 3) {
    const target = parts[2];
    if (node.interfaces[target]) {
      node.interfaces[target].ip = undefined;
      node.interfaces[target].ipv6 = undefined;
      node.interfaces[target].up = false;
      return { output: `% Interface ${target} reset` };
    }
    return { output: '' };
  }

  // Router OSPF command: `router ospf`
  if (isRouterOspfCmd) {
    node.ospfEnabled = true;
    node.cliMode = 'config-router-ospf';
    return { output: '' };
  }

  // Reset OSPF: `no router ospf`
  if (cmd.match(/^no\s+router\s+ospf/i)) {
    node.ospfEnabled = false;
    node.ospfNetworks = [];
    node.cliMode = 'config';
    return { output: '' };
  }

  // Router BGP command: `router bgp <asn>`
  if (isRouterBgpCmd && parts.length >= 3) {
    const asn = parseInt(parts[2], 10);
    if (isNaN(asn)) return { output: '% Invalid AS number', type: 'error' };
    node.bgpEnabled = true;
    node.bgpAsNumber = asn;
    node.cliMode = 'config-router-bgp';
    return { output: '' };
  }

  // Reset BGP: `no router bgp`
  if (cmd.match(/^no\s+router\s+bgp/i)) {
    node.bgpEnabled = false;
    node.bgpNetworks = [];
    node.bgpNeighbors = {};
    node.cliMode = 'config';
    return { output: '' };
  }

  // Route-Map: `route-map <name> <permit|deny> <seq>`
  if (isRouteMapCmd && parts.length >= 4) {
    const mapName = parts[1];
    const action = parts[2].toLowerCase() === 'deny' ? 'deny' : 'permit';
    const seq = parseInt(parts[3], 10) || 10;

    node.routeMaps = node.routeMaps || {};
    node.routeMaps[mapName] = node.routeMaps[mapName] || [];

    let entry = node.routeMaps[mapName].find(e => e.sequence === seq);
    if (!entry) {
      entry = { name: mapName, action, sequence: seq };
      node.routeMaps[mapName].push(entry);
    } else {
      entry.action = action;
    }

    node.activeRouteMap = { name: mapName, action, seq };
    node.cliMode = 'config-route-map';
    return { output: '' };
  }

  // Submode: Route-Map Configuration (`config-route-map`)
  if (node.cliMode === 'config-route-map' && node.activeRouteMap) {
    const mapName = node.activeRouteMap.name;
    const seq = node.activeRouteMap.seq;
    const entry = node.routeMaps?.[mapName]?.find(e => e.sequence === seq);

    if (entry) {
      if (cmd.match(/^match\s+ip\s+address/i)) {
        entry.matchIpAddress = parts.slice(3).join(' ');
        return { output: '' };
      }
      if (cmd.match(/^set\s+local-pref(erence)?/i) && parts.length >= 3) {
        entry.setLocalPref = parseInt(parts[2], 10);
        return { output: '' };
      }
      if (cmd.match(/^set\s+metric/i) && parts.length >= 3) {
        entry.setMetric = parseInt(parts[2], 10);
        return { output: '' };
      }
      if (cmd.match(/^set\s+as-path\s+prepend/i)) {
        entry.setAsPathPrepend = parts.slice(3).join(' ');
        return { output: '' };
      }
    }
  }

  // Submode: Interface Configuration (`config-if`)
  if (node.cliMode === 'config-if' && node.selectedInterface) {
    const intf = node.interfaces[node.selectedInterface];

    // `ip address <ip>/<prefix>` or `ip address <ip> <netmask>`
    if (cmd.match(/^ip\s+addr(ess)?/i)) {
      if (parts.length >= 3) {
        let ipCidr = parts[2];
        if (parts.length >= 4 && !ipCidr.includes('/')) {
          const prefix = netmaskToPrefix(parts[3]);
          ipCidr = `${parts[2]}/${prefix}`;
        }
        const parsed = parseIpv4Cidr(ipCidr);
        if (parsed) {
          intf.ip = ipCidr;
          intf.up = true;
          return { output: '', type: 'success' };
        } else {
          return { output: '% Malformed IPv4 address/prefix', type: 'error' };
        }
      }
    }

    // `no ip address`
    if (cmd.match(/^no\s+ip\s+addr(ess)?/i)) {
      delete intf.ip;
      return { output: '' };
    }

    // `ipv6 address <ip>/<prefix>`
    if (cmd.match(/^ipv6\s+addr(ess)?/i) && parts.length >= 3) {
      const parsed = parseIpv6Cidr(parts[2]);
      if (parsed) {
        intf.ipv6 = parts[2];
        intf.up = true;
        return { output: '', type: 'success' };
      }
      return { output: '% Malformed IPv6 address/prefix', type: 'error' };
    }

    // `no ipv6 address`
    if (cmd.match(/^no\s+ipv6\s+addr(ess)?/i)) {
      delete intf.ipv6;
      return { output: '' };
    }

    // `no shutdown` / `no shut`
    if (cmd.match(/^no\s+shut(down)?/i)) {
      intf.up = true;
      return { output: `% Interface ${node.selectedInterface} state changed to UP` };
    }

    // `shutdown` / `shut`
    if (cmd.match(/^shut(down)?/i)) {
      intf.up = false;
      return { output: `% Interface ${node.selectedInterface} state changed to DOWN` };
    }

    // `ip ospf cost <cost>`
    if (cmd.match(/^ip\s+ospf\s+cost/i) && parts.length >= 4) {
      const cost = parseInt(parts[3], 10);
      if (!isNaN(cost) && cost > 0) {
        intf.ospfCost = cost;
        return { output: '' };
      }
      return { output: '% Invalid OSPF cost', type: 'error' };
    }

    // `no ip ospf cost`
    if (cmd.match(/^no\s+ip\s+ospf\s+cost/i)) {
      intf.ospfCost = 10;
      return { output: '' };
    }

    // `description <text>`
    if (cmd.match(/^description\s+/i)) {
      intf.description = parts.slice(1).join(' ');
      return { output: '' };
    }
  }

  // Submode: OSPF Configuration (`config-router-ospf`)
  if (node.cliMode === 'config-router-ospf') {
    // `ospf router-id <id>` or `router-id <id>`
    if ((cmd.match(/^ospf\s+router-id/i) || cmd.match(/^router-id/i)) && parts.length >= 2) {
      node.ospfRouterId = parts[parts.length - 1];
      return { output: '' };
    }

    // `network <net>/<prefix> area <area>` or `network <ip> <wildcard> area <area>`
    if (cmd.match(/^network/i)) {
      const areaIdx = parts.findIndex(p => p.toLowerCase() === 'area');
      if (areaIdx >= 2 && areaIdx + 1 < parts.length) {
        const areaNum = parseInt(parts[areaIdx + 1], 10);
        let netCidr = parts[1];
        if (!netCidr.includes('/') && areaIdx === 3) {
          const wildcard = parts[2].split('.').map(Number);
          const mask = wildcard.map(w => 255 - w).join('.');
          const prefix = netmaskToPrefix(mask);
          netCidr = `${parts[1]}/${prefix}`;
        }
        const parsed = parseIpv4Cidr(netCidr);
        if (parsed) {
          node.ospfNetworks = node.ospfNetworks || [];
          node.ospfNetworks.push({ network: parsed.network, prefix: parsed.prefix, area: areaNum });
          return { output: '' };
        }
      }
      return { output: '% Incomplete or malformed network command', type: 'error' };
    }

    // `no network ...`
    if (cmd.match(/^no\s+network/i)) {
      node.ospfNetworks = [];
      return { output: '' };
    }

    // `passive-interface <intf>`
    if (cmd.match(/^passive-interface\s+/i) && parts.length >= 2) {
      node.passiveInterfaces = node.passiveInterfaces || [];
      const intf = resolveOrCreateInterface(node, parts[1]);
      if (!node.passiveInterfaces.includes(intf)) {
        node.passiveInterfaces.push(intf);
      }
      return { output: '' };
    }

    // `no passive-interface <intf>`
    if (cmd.match(/^no\s+passive-interface\s+/i) && parts.length >= 3) {
      node.passiveInterfaces = node.passiveInterfaces?.filter(i => i !== parts[2]);
      return { output: '' };
    }

    // `redistribute connected | static | bgp`
    if (cmd.match(/^redistribute\s+/i)) {
      const proto = parts[1].toLowerCase();
      node.redistributeOspf = node.redistributeOspf || {};
      if (proto === 'connected') node.redistributeOspf.connected = true;
      if (proto === 'static') node.redistributeOspf.static = true;
      if (proto === 'bgp') node.redistributeOspf.bgp = true;
      return { output: '' };
    }
  }

  // Submode: BGP Configuration (`config-router-bgp`)
  if (node.cliMode === 'config-router-bgp') {
    // `bgp router-id <id>` or `router-id <id>`
    if ((cmd.match(/^bgp\s+router-id/i) || cmd.match(/^router-id/i)) && parts.length >= 2) {
      node.bgpRouterId = parts[parts.length - 1];
      return { output: '' };
    }

    // `neighbor <ip> remote-as <asn>`
    if (cmd.match(/^neighbor\s+[\d\.]+\s+remote-as/i) && parts.length >= 4) {
      const ip = parts[1];
      const remoteAs = parseInt(parts[3], 10);
      node.bgpNeighbors = node.bgpNeighbors || {};
      if (!node.bgpNeighbors[ip]) {
        node.bgpNeighbors[ip] = { ip, remoteAs, state: 'Active' };
      } else {
        node.bgpNeighbors[ip].remoteAs = remoteAs;
      }
      return { output: '' };
    }

    // `no neighbor <ip>`
    if (cmd.match(/^no\s+neighbor\s+[\d\.]+/i)) {
      const ip = parts[2];
      if (node.bgpNeighbors?.[ip]) {
        delete node.bgpNeighbors[ip];
      }
      return { output: '' };
    }

    // `neighbor <ip> update-source <intf>`
    if (cmd.match(/^neighbor\s+[\d\.]+\s+update-source/i) && parts.length >= 4) {
      const ip = parts[1];
      const sourceIntf = parts[3];
      if (node.bgpNeighbors?.[ip]) {
        node.bgpNeighbors[ip].updateSource = sourceIntf;
      }
      return { output: '' };
    }

    // `neighbor <ip> next-hop-self`
    if (cmd.match(/^neighbor\s+[\d\.]+\s+next-hop-self/i)) {
      const ip = parts[1];
      if (node.bgpNeighbors?.[ip]) {
        node.bgpNeighbors[ip].nextHopSelf = true;
      }
      return { output: '' };
    }

    // `neighbor <ip> route-map <map_name> <in|out>`
    if (cmd.match(/^neighbor\s+[\d\.]+\s+route-map/i) && parts.length >= 5) {
      const ip = parts[1];
      const mapName = parts[3];
      const dir = parts[4].toLowerCase();
      if (node.bgpNeighbors?.[ip]) {
        if (dir === 'in') node.bgpNeighbors[ip].routeMapIn = mapName;
        if (dir === 'out') node.bgpNeighbors[ip].routeMapOut = mapName;
      }
      return { output: '' };
    }

    // `neighbor <ip> description <desc>`
    if (cmd.match(/^neighbor\s+[\d\.]+\s+description/i) && parts.length >= 4) {
      const ip = parts[1];
      if (node.bgpNeighbors?.[ip]) {
        node.bgpNeighbors[ip].description = parts.slice(3).join(' ');
      }
      return { output: '' };
    }

    // `neighbor <ip> activate`
    if (cmd.match(/^neighbor\s+[\d\.]+\s+activate/i)) {
      return { output: '' };
    }

    // `address-family ipv4 unicast` / `exit-address-family`
    if (cmd.match(/^(address-family|exit-address-family)/i)) {
      return { output: '' };
    }

    // `network <net>/<prefix>` or `network <ip> mask <netmask>`
    if (cmd.match(/^network/i)) {
      let netCidr = parts[1];
      if (parts.length >= 4 && parts[2].toLowerCase() === 'mask') {
        const prefix = netmaskToPrefix(parts[3]);
        netCidr = `${parts[1]}/${prefix}`;
      }
      const parsed = parseIpv4Cidr(netCidr);
      if (parsed) {
        node.bgpNetworks = node.bgpNetworks || [];
        node.bgpNetworks.push({ network: parsed.network, prefix: parsed.prefix });
        return { output: '' };
      }
      return { output: '% Malformed network command', type: 'error' };
    }

    // `no network ...`
    if (cmd.match(/^no\s+network/i)) {
      node.bgpNetworks = [];
      return { output: '' };
    }

    // `redistribute connected | ospf | static`
    if (cmd.match(/^redistribute\s+/i)) {
      const proto = parts[1].toLowerCase();
      node.redistributeBgp = node.redistributeBgp || {};
      if (proto === 'connected') node.redistributeBgp.connected = true;
      if (proto === 'ospf') node.redistributeBgp.ospf = true;
      if (proto === 'static') node.redistributeBgp.static = true;
      return { output: '' };
    }
  }

  // Static Routing: `ip route <dest>/<prefix> <next_hop|Null0|blackhole>`
  if (cmd.match(/^ip\s+route\s+/i) && parts.length >= 3) {
    let destCidr = parts[2];
    let nextHop = parts[3] || 'Null0';

    if (parts.length >= 5 && !destCidr.includes('/')) {
      const prefix = netmaskToPrefix(parts[3]);
      destCidr = `${parts[2]}/${prefix}`;
      nextHop = parts[4];
    }

    const parsed = parseIpv4Cidr(destCidr);
    if (parsed) {
      node.staticRoutes = node.staticRoutes || [];
      // Normalize Null0 or blackhole
      const isBlackhole =
        nextHop.toLowerCase() === 'null0' ||
        nextHop.toLowerCase() === 'blackhole' ||
        nextHop.toLowerCase() === 'reject';

      node.staticRoutes.push({
        destination: parsed.network,
        prefix: parsed.prefix,
        nextHop: isBlackhole ? 'Null0' : nextHop
      });
      return { output: '' };
    }
    return { output: '% Invalid IP route syntax', type: 'error' };
  }

  // `no ip route <dest> ...`
  if (cmd.match(/^no\s+ip\s+route\s+/i) && parts.length >= 4) {
    const dest = parts[3];
    node.staticRoutes = (node.staticRoutes || []).filter(
      s => s.destination !== dest && `${s.destination}/${s.prefix}` !== dest
    );
    return { output: '' };
  }

  // -----------------------------------------------------------
  // LINUX IPROUTE2 PASSTHROUGH ON ROUTER
  // (Allows bash commands like `ip addr add`, `ip route add`, `ip link`, `ip tunnel`, `ifconfig`)
  // -----------------------------------------------------------
  if (
    cmd.match(/^ip\s+(addr|a|link|route|r|tunnel|-6)\s+/i) ||
    cmd === 'ifconfig' ||
    cmd === 'ip a' ||
    cmd === 'ip addr' ||
    cmd === 'ip route' ||
    cmd === 'ip r' ||
    cmd === 'route -n'
  ) {
    return handleHostCommand(cmd, node, nodes, links);
  }

  // -----------------------------------------------------------
  // SHOW COMMANDS (Support all abbreviations and variations)
  // -----------------------------------------------------------
  if (verb === 'show' || verb === 'sh') {
    const sub = parts.slice(1).join(' ').toLowerCase();

    // `show ip interface brief` / `show int br` / `show interface brief`
    if ((sub.includes('int') && sub.includes('br')) || sub === 'ip int brief') {
      return { output: formatShowInterfaceBrief(node) };
    }

    // `show interface` / `sh int`
    if (sub === 'interface' || sub === 'interfaces' || sub === 'int') {
      return { output: formatShowInterfaceBrief(node) };
    }

    // `show ip ospf neighbor`
    if (sub.includes('ospf') && (sub.includes('neigh') || sub.includes('ne'))) {
      return { output: formatShowOspfNeighbors(node, nodes, links) };
    }

    // `show ip ospf ...`
    if (sub.includes('ospf')) {
      if (sub.includes('interface')) {
        return { output: formatShowOspfInterfaces(node) };
      }
      return { output: formatShowOspfGeneral(node, nodes, links) };
    }

    // `show ip route ospf`
    if (sub.includes('route') && sub.includes('ospf')) {
      return { output: formatShowIpRoute(node, nodes, links, 'ospf') };
    }

    // `show ip route bgp`
    if (sub.includes('route') && sub.includes('bgp')) {
      return { output: formatShowIpRoute(node, nodes, links, 'bgp') };
    }

    // `show ip route static`
    if (sub.includes('route') && sub.includes('static')) {
      return { output: formatShowIpRoute(node, nodes, links, 'static') };
    }

    // `show ip route`
    if (sub.includes('route')) {
      return { output: formatShowIpRoute(node, nodes, links) };
    }

    // `show ipv6 route` / `sh ipv6 route`
    if (sub.includes('ipv6') && sub.includes('route')) {
      return { output: formatShowIpv6Route(node) };
    }

    // `show ip bgp summary` / `show bgp summary`
    if (sub.includes('bgp') && sub.includes('sum')) {
      return { output: formatShowBgpSummary(node, nodes, links) };
    }

    // `show ip bgp` / `show bgp`
    if (sub.includes('bgp')) {
      return { output: formatShowBgp(node, nodes, links) };
    }

    // `show route-map` / `sh route-map`
    if (sub.includes('route-map')) {
      return { output: formatShowRouteMap(node) };
    }

    // `show running-config` / `show run` / `write terminal`
    if (sub.includes('run') || sub === 'running') {
      return { output: formatShowRunningConfig(node) };
    }
  }

  if (cmd === 'write terminal') {
    return { output: formatShowRunningConfig(node) };
  }

  // Ping & Traceroute
  if (verb === 'ping' && parts.length >= 2) {
    let target = parts[1];
    if (target === '-c' && parts.length >= 4) target = parts[3];
    return handlePingCommand(target, false, node, nodes, links);
  }
  if (verb === 'ping6' && parts.length >= 2) {
    let target = parts[1];
    if (target === '-c' && parts.length >= 4) target = parts[3];
    return handlePingCommand(target, true, node, nodes, links);
  }
  if (verb === 'traceroute' && parts.length >= 2) {
    return handleTracerouteCommand(parts[1], node, nodes, links);
  }

  // Help
  if (cmd === '?' || cmd === 'help' || cmd === 'list') {
    return { output: formatRouterHelp(node.cliMode) };
  }

  return { output: `% Unknown command: "${cmd}". Type '?' or 'help' for options.`, type: 'error' };
}

// -------------------------------------------------------------
// SWITCH CLI HANDLER (Open vSwitch)
// -------------------------------------------------------------
function handleSwitchCommand(
  cmd: string,
  node: NetworkNode,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): CliExecutionResult {
  const parts = cmd.split(/\s+/);
  const verb = parts[0].toLowerCase();

  if (verb === 'clear') return { output: '', clear: true };

  // `ovs-vsctl show`
  if (cmd.match(/^ovs-vsctl\s+show/i)) {
    return { output: parseOvsShow(node) };
  }

  // `ovs-vsctl add-br <br>`
  if (cmd.match(/^ovs-vsctl\s+add-br/i) && parts.length >= 3) {
    return { output: '' };
  }

  // `ovs-vsctl add-port <br> <port> [tag=<id>]`
  if (cmd.match(/^ovs-vsctl\s+add-port/i) && parts.length >= 4) {
    const portName = parts[3];
    const tagArg = parts[4];
    let tag: number | undefined;
    if (tagArg && tagArg.startsWith('tag=')) {
      tag = parseInt(tagArg.replace('tag=', ''), 10);
    }
    if (!node.interfaces[portName]) {
      node.interfaces[portName] = {
        name: portName,
        mac: `00:00:00:${Math.floor(Math.random() * 90 + 10)}:${Math.floor(Math.random() * 90 + 10)}:03`,
        up: true,
        vlanTag: tag
      };
    } else if (tag !== undefined) {
      node.interfaces[portName].vlanTag = tag;
    }
    return { output: '' };
  }

  // `ovs-vsctl set port <port> tag=<id>`
  if (cmd.match(/^ovs-vsctl\s+set\s+port/i)) {
    const portName = parts[3];
    const tagArg = parts[4];
    if (portName && tagArg && tagArg.startsWith('tag=')) {
      const tag = parseInt(tagArg.replace('tag=', ''), 10);
      if (!isNaN(tag)) {
        const ok = setSwitchPortVlan(node, portName, tag);
        if (ok) return { output: '', type: 'success' };
        // If not found, auto-create port on the switch
        node.interfaces[portName] = {
          name: portName,
          mac: `00:00:00:${Math.floor(Math.random() * 90 + 10)}:${Math.floor(Math.random() * 90 + 10)}:03`,
          up: true,
          vlanTag: tag
        };
        return { output: '', type: 'success' };
      }
    }
    return { output: 'ovs-vsctl: invalid arguments for set port', type: 'error' };
  }

  // `ovs-vsctl remove port <port> tag` / `ovs-vsctl clear port <port> tag`
  if (cmd.match(/^ovs-vsctl\s+(remove|clear)\s+port/i)) {
    const portName = parts[3];
    removeSwitchPortVlan(node, portName);
    return { output: '' };
  }

  // `ovs-ofctl dump-flows <bridge>` / `ovs-ofctl show <bridge>`
  if (cmd.match(/^ovs-ofctl\s+(dump-flows|show)/i)) {
    return {
      output: `NXST_FLOW reply (xid=0x4):
 cookie=0x0, duration=234.12s, table=0, n_packets=82, n_bytes=6888, actions=NORMAL`
    };
  }

  // Interface inspection
  if (cmd.match(/^show\s+int/i) || cmd === 'ifconfig') {
    return { output: formatShowInterfaceBrief(node) };
  }

  if (cmd === 'help' || cmd === '?') {
    return {
      output: `Open vSwitch Commands:
  ovs-vsctl show                           - Show OVS bridges and ports
  ovs-vsctl set port <port> tag=<vlan_id>   - Set VLAN tag on port (e.g. s1-eth2 tag=10)
  ovs-vsctl remove port <port> tag <id>    - Remove VLAN tag from port
  ovs-ofctl dump-flows <bridge>            - Dump OpenFlow table flows
  show interface                           - View port states and tags
  connect <local_intf> <node> <node_intf>  - Wire cable directly from CLI
  clear                                    - Clear screen`
    };
  }

  return { output: `${verb}: command not found. Type 'help' for available commands.`, type: 'error' };
}

// -------------------------------------------------------------
// HOST CLI HANDLER (Linux Bash & iproute2)
// -------------------------------------------------------------
function handleHostCommand(
  cmd: string,
  node: NetworkNode,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): CliExecutionResult {
  const parts = cmd.split(/\s+/);
  const verb = parts[0].toLowerCase();

  if (verb === 'clear') return { output: '', clear: true };

  // `ip addr add <ip>/<prefix> dev <intf>` / `ip a add ...`
  if (cmd.match(/^ip\s+(addr|a)\s+add/i)) {
    const ipCidr = parts[3];
    const devIdx = parts.indexOf('dev');
    const devRaw = devIdx !== -1 ? parts[devIdx + 1] : Object.keys(node.interfaces)[0] || `${node.name}-eth0`;
    const devName = resolveOrCreateInterface(node, devRaw);

    if (ipCidr.includes(':')) {
      const parsed = parseIpv6Cidr(ipCidr);
      if (parsed) {
        node.interfaces[devName].ipv6 = ipCidr;
        node.interfaces[devName].up = true;
        return { output: '' };
      }
    } else {
      const parsed = parseIpv4Cidr(ipCidr);
      if (parsed) {
        node.interfaces[devName].ip = ipCidr;
        node.interfaces[devName].up = true;
        return { output: '' };
      }
    }
    return { output: `RTNETLINK answers: Invalid argument`, type: 'error' };
  }

  // `ip addr del <ip>/<prefix> dev <intf>` / `ip address flush dev <intf>`
  if (cmd.match(/^ip\s+(addr|a)\s+(del|flush)/i)) {
    const devIdx = parts.indexOf('dev');
    if (devIdx !== -1 && parts[devIdx + 1]) {
      const devName = resolveInterfaceName(node, parts[devIdx + 1]);
      if (node.interfaces[devName]) {
        delete node.interfaces[devName].ip;
        delete node.interfaces[devName].ipv6;
        return { output: '' };
      }
    }
  }

  // `ip -6 addr add <ip>/<prefix> dev <intf>`
  if (cmd.match(/^ip\s+-6\s+(addr|a)\s+add/i)) {
    const ipCidr = parts[4];
    const devIdx = parts.indexOf('dev');
    const devRaw = devIdx !== -1 ? parts[devIdx + 1] : Object.keys(node.interfaces)[0] || `${node.name}-eth0`;
    const devName = resolveOrCreateInterface(node, devRaw);

    const parsed = parseIpv6Cidr(ipCidr);
    if (parsed) {
      node.interfaces[devName].ipv6 = ipCidr;
      node.interfaces[devName].up = true;
      return { output: '' };
    }
    return { output: `RTNETLINK answers: Invalid argument`, type: 'error' };
  }

  // `ip link set <intf> up/down`
  if (cmd.match(/^ip\s+link\s+set/i)) {
    const devIdx = parts.indexOf('dev');
    const devRaw = devIdx !== -1 ? parts[devIdx + 1] : parts[3];
    const dev = resolveInterfaceName(node, devRaw);
    const action = parts[parts.length - 1];
    if (node.interfaces[dev]) {
      node.interfaces[dev].up = action === 'up';
      return { output: '' };
    }
    return { output: `Cannot find device "${devRaw}"`, type: 'error' };
  }

  // `ip route add default via <ip>` / `ip route replace default via <ip>` / `route add default gw <ip>`
  if (cmd.match(/^(ip\s+r(oute)?\s+(add|replace)\s+default\s+via|route\s+add\s+default\s+gw)/i)) {
    const viaIdx = parts.findIndex(p => p.toLowerCase() === 'via' || p.toLowerCase() === 'gw');
    if (viaIdx !== -1 && viaIdx + 1 < parts.length) {
      node.defaultGateway = parts[viaIdx + 1];
      return { output: '' };
    }
  }

  // `ip route add <dest>/<prefix> via <next_hop>` or `ip route add <dest>/<prefix> dev <intf>`
  if (cmd.match(/^ip\s+r(oute)?\s+(add|replace)\s+[\d\.]+\/\d+/i)) {
    const p = parseIpv4Cidr(parts[3]);
    const viaIdx = parts.indexOf('via');
    const devIdx = parts.indexOf('dev');
    const nextHop = viaIdx !== -1 ? parts[viaIdx + 1] : devIdx !== -1 ? parts[devIdx + 1] : 'unknown';
    const devName = devIdx !== -1 ? resolveInterfaceName(node, parts[devIdx + 1]) : undefined;

    if (p) {
      node.staticRoutes = (node.staticRoutes || []).filter(
        s => !(s.destination === p.network && s.prefix === p.prefix)
      );
      node.staticRoutes.push({ destination: p.network, prefix: p.prefix, nextHop, interfaceName: devName });
      return { output: '' };
    }
  }

  // `ip route del <prefix>` / `ip route del default`
  if (cmd.match(/^ip\s+r(oute)?\s+del/i)) {
    if (cmd.includes('default')) {
      node.defaultGateway = undefined;
      return { output: '' };
    }
    const dest = parts[3];
    node.staticRoutes = (node.staticRoutes || []).filter(
      s => s.destination !== dest && `${s.destination}/${s.prefix}` !== dest
    );
    return { output: '' };
  }

  // `ip -6 route add default via <gw>`
  if (cmd.match(/^ip\s+-6\s+r(oute)?\s+(add|replace)\s+default\s+via/i)) {
    const viaIdx = parts.findIndex(p => p.toLowerCase() === 'via');
    if (viaIdx !== -1 && viaIdx + 1 < parts.length) {
      node.defaultGatewayV6 = parts[viaIdx + 1];
      return { output: '' };
    }
  }

  // `ip -6 route add <dest>/<prefix> via <gw>` or `dev <intf>`
  if (cmd.match(/^ip\s+-6\s+r(oute)?\s+add/i)) {
    const destCidr = parts[4];
    const viaIdx = parts.indexOf('via');
    const devIdx = parts.indexOf('dev');
    const nextHop = viaIdx !== -1 ? parts[viaIdx + 1] : undefined;
    const devName = devIdx !== -1 ? resolveInterfaceName(node, parts[devIdx + 1]) : undefined;
    const p = parseIpv6Cidr(destCidr);
    if (p) {
      node.ipv6Routes = (node.ipv6Routes || []).filter(
        r => !(r.destination === p.ip && r.prefix === p.prefix)
      );
      node.ipv6Routes.push({ destination: p.ip, prefix: p.prefix, nextHop, interfaceName: devName });
      return { output: '' };
    }
  }

  // `ip -6 route add <ipv6_prefix> dev <tun_name>` / `via <nexthop>`
  if (cmd.match(/^(ip\s+-6\s+route\s+add|ip\s+route\s+add)\s+[0-9a-fA-F:]+\/\d+/i)) {
    const destIpv6 = parts[cmd.includes('-6') ? 4 : 3];
    const devIdx = parts.indexOf('dev');
    const devName = devIdx !== -1 ? parts[devIdx + 1] : '';
    const parsed = parseIpv6Cidr(destIpv6);
    if (parsed && (node.interfaces[devName] || !devName)) {
      node.ipv6Routes = node.ipv6Routes || [];
      node.ipv6Routes.push({
        destination: parsed.ip,
        prefix: parsed.prefix,
        interfaceName: devName || 'sit1'
      });
      return { output: '' };
    }
    return { output: `RTNETLINK answers: No such device or route`, type: 'error' };
  }

  // `ip tunnel add <tun_name> mode sit remote <remote_ip> local <local_ip> [ttl <ttl>]`
  if (cmd.match(/^ip\s+tunnel\s+add/i)) {
    const tunName = parts[3];
    const modeIdx = parts.indexOf('mode');
    const remoteIdx = parts.indexOf('remote');
    const localIdx = parts.indexOf('local');
    const ttlIdx = parts.indexOf('ttl');

    const remoteIp = remoteIdx !== -1 ? parts[remoteIdx + 1] : '';
    const localIp = localIdx !== -1 ? parts[localIdx + 1] : '';
    const ttl = ttlIdx !== -1 ? parseInt(parts[ttlIdx + 1], 10) : 255;

    if (tunName && remoteIp && localIp) {
      const res = addSitTunnel(node, tunName, localIp, remoteIp, ttl);
      return { output: res.message, type: res.success ? 'success' : 'error' };
    }
    return { output: 'ip tunnel: invalid arguments', type: 'error' };
  }

  // `ip tunnel del <tun_name>`
  if (cmd.match(/^ip\s+tunnel\s+del/i) && parts.length >= 4) {
    const tunName = parts[3];
    delete node.interfaces[tunName];
    node.tunnels = (node.tunnels || []).filter(t => t.name !== tunName);
    return { output: '' };
  }

  // `ip tunnel show` / `ip tunnel`
  if (cmd.match(/^ip\s+tunnel/i)) {
    return { output: formatTunnelShow(node) };
  }

  // `ip addr show` / `ip addr` / `ip a` / `ifconfig`
  if (cmd.match(/^ip\s+(addr|a)/i) || cmd === 'ifconfig') {
    return { output: formatHostIpAddrShow(node) };
  }

  // `ip route show` / `ip route` / `ip r` / `route -n`
  if (cmd.match(/^ip\s+(route|r)/i) || cmd.match(/^route/i)) {
    return { output: formatHostIpRouteShow(node) };
  }

  // `ip -6 addr show` / `ip -6 a`
  if (cmd.match(/^ip\s+-6\s+(addr|a)/i)) {
    return { output: formatHostIpv6AddrShow(node) };
  }

  // `ip -6 route show` / `ip -6 route` / `ip -6 r`
  if (cmd.match(/^ip\s+-6\s+(route|r)/i)) {
    return { output: formatHostIpv6RouteShow(node) };
  }

  // Ping & Traceroute
  if (verb === 'ping' && parts.length >= 2) {
    let target = parts[1];
    if (target === '-c' && parts.length >= 4) target = parts[3];
    return handlePingCommand(target, false, node, nodes, links);
  }
  if (verb === 'ping6' && parts.length >= 2) {
    let target = parts[1];
    if (target === '-c' && parts.length >= 4) target = parts[3];
    return handlePingCommand(target, true, node, nodes, links);
  }
  if (verb === 'traceroute' && parts.length >= 2) {
    return handleTracerouteCommand(parts[1], node, nodes, links);
  }

  if (verb === 'cat' || verb === 'ls' || verb === 'uname') {
    if (verb === 'uname') return { output: 'Linux ' + node.name + ' 5.15.0-89-generic #99-Ubuntu SMP' };
    if (verb === 'ls') return { output: 'lab_config.sh  notes.txt' };
    if (verb === 'cat') return { output: '# Mininet-IPLab simulation active.' };
  }

  if (verb === 'help') {
    return {
      output: `Linux Host Commands:
  ip addr add <ip>/<prefix> dev <intf>                     - Configure IPv4 address
  ip -6 addr add <ipv6>/<prefix> dev <intf>                - Configure IPv6 address
  ip link set <intf> up                                   - Bring up interface
  ip route add default via <ip>                            - Set default gateway
  ip tunnel add <tun> mode sit remote <rem> local <loc>    - Create 6in4 SIT Tunnel
  ip route add <ipv6_prefix> dev <tun>                     - Route IPv6 prefix through tunnel
  connect <local_intf> <node> <node_intf>                  - Wire cable directly from CLI
  ping <ip> / ping6 <ipv6>                                 - Test ICMP reachability
  traceroute <ip>                                          - Trace network hops
  ip addr show / ip route show / ip -6 route show          - Display network configurations`
    };
  }

  return { output: `bash: ${verb}: command not found. Type 'help' for options.`, type: 'error' };
}

// -------------------------------------------------------------
// PING & TRACEROUTE SIMULATION RUNNERS
// -------------------------------------------------------------
function handlePingCommand(
  target: string,
  isIpv6: boolean,
  node: NetworkNode,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): CliExecutionResult {
  const sim = simulatePing(node.id, target, isIpv6, nodes, links);

  if (!sim.success) {
    return {
      output: `PING ${target} (${target}) 56(84) bytes of data.\nFrom ${node.name}: ${sim.error || 'Destination Host Unreachable'}\n--- ${target} ping statistics ---\n4 packets transmitted, 0 received, 100% packet loss`,
      type: 'error'
    };
  }

  const lines: string[] = [
    `PING ${target} (${target}) 56(84) bytes of data.`,
    `64 bytes from ${target}: icmp_seq=1 ttl=64 time=${sim.rtt.toFixed(2)} ms`,
    `64 bytes from ${target}: icmp_seq=2 ttl=64 time=${(sim.rtt * 0.95).toFixed(2)} ms`,
    `64 bytes from ${target}: icmp_seq=3 ttl=64 time=${(sim.rtt * 1.02).toFixed(2)} ms`,
    `64 bytes from ${target}: icmp_seq=4 ttl=64 time=${(sim.rtt * 0.98).toFixed(2)} ms`,
    ``,
    `--- ${target} ping statistics ---`,
    `4 packets transmitted, 4 received, 0% packet loss, time 3004ms`,
    `rtt min/avg/max/mdev = ${(sim.rtt * 0.95).toFixed(2)}/${sim.rtt.toFixed(2)}/${(sim.rtt * 1.02).toFixed(2)}/0.04 ms`
  ];

  return { output: lines.join('\n'), type: 'success' };
}

function handleTracerouteCommand(
  target: string,
  node: NetworkNode,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): CliExecutionResult {
  const sim = simulateTraceroute(node.id, target, nodes, links);

  const lines: string[] = [`traceroute to ${target} (${target}), 30 hops max, 60 byte packets`];

  if (sim.hops.length <= 1) {
    lines.push(` 1  ${target} (${target})  0.214 ms  0.198 ms  0.185 ms`);
    return { output: lines.join('\n'), type: 'success' };
  }

  for (let i = 1; i < sim.hops.length; i++) {
    const hop = sim.hops[i];
    const ms = hop.rtt.toFixed(3);
    lines.push(` ${i}  ${hop.nodeName} (${hop.ip})  ${ms} ms  ${ms} ms  ${ms} ms`);
  }

  if (!sim.success) {
    lines.push(` ${sim.hops.length}  * * * Request timed out`);
  }

  return { output: lines.join('\n'), type: sim.success ? 'success' : 'error' };
}

// -------------------------------------------------------------
// OUTPUT FORMATTERS
// -------------------------------------------------------------
function formatShowInterfaceBrief(node: NetworkNode): string {
  const lines: string[] = [
    'Interface       IP-Address      OK? Method Status                Protocol',
  ];

  for (const [name, intf] of Object.entries(node.interfaces)) {
    const ip = intf.ip ? intf.ip.split('/')[0] : 'unassigned';
    const status = intf.up ? 'up' : 'administratively down';
    const proto = intf.up ? 'up' : 'down';
    lines.push(
      `${name.padEnd(16)} ${ip.padEnd(15)} YES manual ${status.padEnd(21)} ${proto}`
    );
  }

  return lines.join('\n');
}

function formatShowOspfNeighbors(
  node: NetworkNode,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): string {
  const neighbors = computeOspfNeighbors(node.id, nodes, links);
  if (neighbors.length === 0) {
    return 'Neighbor ID     Pri State           Dead Time Address         Interface\n% No OSPF neighbors in FULL state yet';
  }

  const lines: string[] = [
    'Neighbor ID     Pri State           Dead Time Address         Interface'
  ];

  for (const n of neighbors) {
    lines.push(
      `${n.neighborId.padEnd(16)}${n.priority.toString().padEnd(4)}${n.state.padEnd(16)}${n.deadTime.padEnd(10)}${n.address.padEnd(16)}${n.interfaceName}`
    );
  }

  return lines.join('\n');
}

function formatShowOspfInterfaces(node: NetworkNode): string {
  const lines: string[] = [];
  for (const [name, intf] of Object.entries(node.interfaces)) {
    if (intf.ip) {
      lines.push(`${name} is up, line protocol is ${intf.up ? 'up' : 'down'}`);
      lines.push(`  Internet Address ${intf.ip}, Area 0`);
      lines.push(`  Process ID 1, Router ID ${getRouterId(node)}, Cost: ${intf.ospfCost || 10}`);
      lines.push(`  Transmit Delay is 1 sec, State DR, Priority 1`);
    }
  }
  return lines.join('\n') || '% OSPF not active on any interface';
}

function formatShowOspfGeneral(
  node: NetworkNode,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): string {
  const neighbors = computeOspfNeighbors(node.id, nodes, links);
  return `Routing Process "ospf 1" with ID ${getRouterId(node)}
  Supports only single TOS(TOS0) routes
  Supports opaque LSA
  It is an autonomous system boundary router
  Redistributing External Routes from:
  Number of areas in this router is 1. 1 normal 0 stub 0 nssa
  Maximum path: 8
  Number of full neighbors: ${neighbors.length}`;
}

function formatShowIpRoute(
  node: NetworkNode,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[],
  filter?: 'ospf' | 'bgp' | 'static'
): string {
  const lines: string[] = [
    'Codes: K - kernel, C - connected, S - static, R - RIP, O - OSPF,',
    '       I - IS-IS, B - BGP, E - EIGRP, N - NHRP, T - Table, v - VNC',
    ''
  ];

  // Connected routes
  if (!filter) {
    for (const [intfName, intf] of Object.entries(node.interfaces)) {
      if (intf.ip && intf.up) {
        const p = parseIpv4Cidr(intf.ip);
        if (p) {
          lines.push(`C>* ${p.network}/${p.prefix} is directly connected, ${intfName}`);
        }
      }
    }
  }

  // Static routes
  if (!filter || filter === 'static') {
    for (const s of node.staticRoutes || []) {
      if (s.nextHop.toLowerCase() === 'null0') {
        lines.push(`S>* ${s.destination}/${s.prefix} [1/0] unreachable (blackhole), weight 1`);
      } else {
        lines.push(`S>* ${s.destination}/${s.prefix} [1/0] via ${s.nextHop}`);
      }
    }
  }

  // OSPF routes
  if (!filter || filter === 'ospf') {
    const ospfRoutes = computeOspfRoutes(node.id, nodes, links);
    for (const o of ospfRoutes) {
      lines.push(`O>* ${o.destination}/${o.prefix} [110/${o.metric || 10}] via ${o.nextHop}, ${o.interfaceName}`);
    }
  }

  // BGP routes
  if (!filter || filter === 'bgp') {
    const bgpRoutes = computeBgpRoutes(node.id, nodes, links);
    for (const b of bgpRoutes) {
      lines.push(`B>* ${b.prefix} [200/${b.metric}] via ${b.nextHop}`);
    }
  }

  return lines.join('\n');
}

function formatShowIpv6Route(node: NetworkNode): string {
  const lines: string[] = [
    'IPv6 Routing Table',
    'Codes: C - Connected, S - Static',
    ''
  ];
  for (const [name, intf] of Object.entries(node.interfaces)) {
    if (intf.ipv6 && intf.up) {
      lines.push(`C>* ${intf.ipv6} dev ${name} proto kernel metric 256`);
    }
  }
  for (const r of node.ipv6Routes || []) {
    lines.push(`S>* ${r.destination}/${r.prefix} dev ${r.interfaceName || 'sit1'} metric 1024`);
  }
  return lines.join('\n');
}

function formatShowBgpSummary(
  node: NetworkNode,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): string {
  const routerId = getBgpRouterId(node);
  const asn = node.bgpAsNumber || 65000;
  const neighbors = computeBgpNeighbors(node.id, nodes, links);

  const lines: string[] = [
    `BGP router identifier ${routerId}, local AS number ${asn} vrf-id 0`,
    `BGP table version 3`,
    `RIB entries 5, using 960 bytes of memory`,
    `Peers ${Object.keys(neighbors).length}, using ${Object.keys(neighbors).length * 21} KiB of memory`,
    ``,
    `Neighbor        V         AS   MsgRcvd   MsgSent   TblVer  InQ OutQ  Up/Down State/PfxRcd`,
  ];

  if (Object.keys(neighbors).length === 0) {
    lines.push(`% No BGP neighbors configured`);
    return lines.join('\n');
  }

  for (const [ip, n] of Object.entries(neighbors)) {
    const stateStr = n.state === 'Established' ? (n.prefixesReceived?.toString() || '0') : n.state;
    lines.push(
      `${ip.padEnd(16)}4 ${n.remoteAs.toString().padStart(10)}        24        26        0    0    0 ${n.upDownTime || 'never'} ${stateStr}`
    );
  }

  return lines.join('\n');
}

function formatShowBgp(
  node: NetworkNode,
  nodes: Record<string, NetworkNode>,
  links: NetworkLink[]
): string {
  const routerId = getBgpRouterId(node);
  const routes = computeBgpRoutes(node.id, nodes, links);

  const lines: string[] = [
    `BGP table version is 2, local router ID is ${routerId}`,
    `Status codes: s suppressed, d damped, h history, * valid, > best, = multipath,`,
    `              i internal, r RIB-failure, S Stale, R Removed`,
    `Origin codes: i - IGP, e - EGP, ? - incomplete`,
    ``,
    `   Network          Next Hop            Metric LocPrf Weight Path`,
  ];

  for (const r of routes) {
    lines.push(
      `${r.status.padEnd(3)} ${r.prefix.padEnd(16)} ${r.nextHop.padEnd(19)} ${r.metric.toString().padStart(6)} ${r.locPrf.toString().padStart(6)} ${r.weight.toString().padStart(6)} ${r.path}`
    );
  }

  return lines.join('\n');
}

function formatShowRouteMap(node: NetworkNode): string {
  if (!node.routeMaps || Object.keys(node.routeMaps).length === 0) {
    return '% No route-maps defined';
  }

  const lines: string[] = [];
  for (const [name, entries] of Object.entries(node.routeMaps)) {
    for (const e of entries) {
      lines.push(`route-map ${name}, ${e.action}, sequence ${e.sequence}`);
      lines.push(`  Match clauses:`);
      if (e.matchIpAddress) lines.push(`    ip address ${e.matchIpAddress}`);
      lines.push(`  Set clauses:`);
      if (e.setLocalPref) lines.push(`    local-preference ${e.setLocalPref}`);
      if (e.setMetric) lines.push(`    metric ${e.setMetric}`);
      if (e.setAsPathPrepend) lines.push(`    as-path prepend ${e.setAsPathPrepend}`);
    }
  }
  return lines.join('\n');
}

function formatShowRunningConfig(node: NetworkNode): string {
  const lines: string[] = [
    `! Current configuration on ${node.name}:`,
    `! FRRouting Configuration Version 8.1`,
    `frr version 8.1`,
    `frr defaults traditional`,
    `hostname ${node.name}`,
    `!`
  ];

  for (const [name, intf] of Object.entries(node.interfaces)) {
    lines.push(`interface ${name}`);
    if (intf.description) lines.push(` description ${intf.description}`);
    if (intf.ip) lines.push(` ip address ${intf.ip}`);
    if (intf.ipv6) lines.push(` ipv6 address ${intf.ipv6}`);
    if (intf.ospfCost) lines.push(` ip ospf cost ${intf.ospfCost}`);
    if (!intf.up) lines.push(` shutdown`);
    lines.push(`!`);
  }

  if (node.ospfEnabled) {
    lines.push(`router ospf`);
    if (node.ospfRouterId) lines.push(` ospf router-id ${node.ospfRouterId}`);
    for (const net of node.ospfNetworks || []) {
      lines.push(` network ${net.network}/${net.prefix} area ${net.area}`);
    }
    for (const p of node.passiveInterfaces || []) {
      lines.push(` passive-interface ${p}`);
    }
    if (node.redistributeOspf?.connected) lines.push(` redistribute connected`);
    if (node.redistributeOspf?.static) lines.push(` redistribute static`);
    if (node.redistributeOspf?.bgp) lines.push(` redistribute bgp`);
    lines.push(`!`);
  }

  if (node.bgpEnabled && node.bgpAsNumber) {
    lines.push(`router bgp ${node.bgpAsNumber}`);
    if (node.bgpRouterId) lines.push(` bgp router-id ${node.bgpRouterId}`);
    for (const [ip, n] of Object.entries(node.bgpNeighbors || {})) {
      lines.push(` neighbor ${ip} remote-as ${n.remoteAs}`);
      if (n.description) lines.push(` neighbor ${ip} description ${n.description}`);
      if (n.updateSource) lines.push(` neighbor ${ip} update-source ${n.updateSource}`);
      if (n.nextHopSelf) lines.push(` neighbor ${ip} next-hop-self`);
      if (n.routeMapIn) lines.push(` neighbor ${ip} route-map ${n.routeMapIn} in`);
      if (n.routeMapOut) lines.push(` neighbor ${ip} route-map ${n.routeMapOut} out`);
    }
    for (const net of node.bgpNetworks || []) {
      lines.push(` network ${net.network}/${net.prefix}`);
    }
    if (node.redistributeBgp?.connected) lines.push(` redistribute connected`);
    if (node.redistributeBgp?.ospf) lines.push(` redistribute ospf`);
    if (node.redistributeBgp?.static) lines.push(` redistribute static`);
    lines.push(`!`);
  }

  // Route-maps
  if (node.routeMaps) {
    for (const [name, entries] of Object.entries(node.routeMaps)) {
      for (const e of entries) {
        lines.push(`route-map ${name} ${e.action} ${e.sequence}`);
        if (e.matchIpAddress) lines.push(` match ip address ${e.matchIpAddress}`);
        if (e.setLocalPref) lines.push(` set local-preference ${e.setLocalPref}`);
        if (e.setMetric) lines.push(` set metric ${e.setMetric}`);
        if (e.setAsPathPrepend) lines.push(` set as-path prepend ${e.setAsPathPrepend}`);
        lines.push(`!`);
      }
    }
  }

  // Static routes
  for (const s of node.staticRoutes || []) {
    lines.push(`ip route ${s.destination}/${s.prefix} ${s.nextHop}`);
  }

  lines.push(`end`);
  return lines.join('\n');
}

function formatHostIpAddrShow(node: NetworkNode): string {
  const lines: string[] = [];
  let idx = 1;
  for (const [name, intf] of Object.entries(node.interfaces)) {
    const status = intf.up ? 'UP,LOWER_UP' : 'DOWN';
    lines.push(`${idx}: ${name}: <BROADCAST,MULTICAST,${status}> mtu 1500 qdisc noqueue state ${intf.up ? 'UP' : 'DOWN'}`);
    lines.push(`    link/ether ${intf.mac} brd ff:ff:ff:ff:ff:ff`);
    if (intf.ip) {
      lines.push(`    inet ${intf.ip} scope global ${name}`);
    }
    if (intf.ipv6) {
      lines.push(`    inet6 ${intf.ipv6} scope global`);
    }
    idx++;
  }
  return lines.join('\n');
}

function formatHostIpRouteShow(node: NetworkNode): string {
  const lines: string[] = [];
  if (node.defaultGateway) {
    lines.push(`default via ${node.defaultGateway} dev ${Object.keys(node.interfaces)[0] || 'eth0'}`);
  }
  for (const [name, intf] of Object.entries(node.interfaces)) {
    if (intf.ip && intf.up) {
      const p = parseIpv4Cidr(intf.ip);
      if (p) lines.push(`${p.network}/${p.prefix} dev ${name} proto kernel scope link src ${p.ip}`);
    }
  }
  for (const s of node.staticRoutes || []) {
    lines.push(`${s.destination}/${s.prefix} via ${s.nextHop}`);
  }
  return lines.join('\n') || '% No IPv4 routes in table';
}

function formatHostIpv6AddrShow(node: NetworkNode): string {
  const lines: string[] = [];
  for (const [name, intf] of Object.entries(node.interfaces)) {
    if (intf.ipv6) {
      lines.push(`${name}: inet6 ${intf.ipv6} scope global`);
    }
  }
  return lines.join('\n') || '% No IPv6 addresses configured';
}

function formatHostIpv6RouteShow(node: NetworkNode): string {
  const lines: string[] = [];
  for (const r of node.ipv6Routes || []) {
    lines.push(`${r.destination}/${r.prefix} dev ${r.interfaceName || 'sit1'} metric 1024`);
  }
  return lines.join('\n') || '% No IPv6 routes in table';
}

function formatRouterHelp(mode: string): string {
  return `FRRouting Commands for [${mode}]:
  enable / disable               - Enter/exit Privileged EXEC mode
  configure terminal (conf t)    - Enter Global Configuration mode
  interface <intf>               - Configure interface (e.g. eth1, lo)
  ip address <ip>/<prefix>       - Assign IPv4 address to interface
  no shutdown / shutdown         - Enable / disable interface
  router ospf                    - Enter OSPF configuration mode
    network <net>/<prefix> area 0- Advertise network in OSPF Area
    ospf router-id <id>          - Set OSPF Router ID
    passive-interface <intf>     - Mark interface as passive
  router bgp <asn>               - Enter BGP configuration mode
    neighbor <ip> remote-as <asn>- Configure iBGP/eBGP neighbor
    neighbor <ip> update-source  - Set peering source interface
    neighbor <ip> next-hop-self  - Advertise local IP as next hop
    neighbor <ip> route-map      - Apply route-map policy
  route-map <name> permit <seq>  - Create/edit route map
  ip route <dest> <next_hop|Null0>- Static or blackhole routing
  connect <local> <node> <remote>- Wire physical link from CLI
  show ip ospf neighbor          - Check OSPF neighbor states (FULL/DR)
  show ip route [ospf|bgp|static]- Check routing table
  show ip bgp summary            - Check BGP peering state
  show interface brief           - View interface statuses and IPs
  ping <ip> / traceroute <ip>    - Test connectivity across topology
  do <command>                   - Execute EXEC command from config mode`;
}
