import { NetworkNode, NetworkLink } from './types';

export interface LabPreset {
  id: string;
  name: string;
  description: string;
  nodes: Record<string, NetworkNode>;
  links: NetworkLink[];
}

export function createStaticRoutingPreset(): LabPreset {
  const nodes: Record<string, NetworkNode> = {
    h1: {
      id: 'h1',
      name: 'h1',
      type: 'host',
      position: { x: 140, y: 280 },
      cliMode: 'priv',
      ospfEnabled: false,
      ospfNetworks: [],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      defaultGateway: '192.168.1.1',
      commandHistory: [],
      terminalBuffer: [
        { text: 'Linux h1 (Ubuntu Host) - Mininet-IPLab\nType "ip addr show" or "ping 192.168.2.2" to test connectivity.', type: 'banner' }
      ],
      interfaces: {
        'h1-eth0': {
          name: 'h1-eth0',
          ip: '192.168.1.2/24',
          mac: '00:00:00:00:01:02',
          up: true,
        }
      }
    },
    r1: {
      id: 'r1',
      name: 'r1',
      type: 'router',
      role: 'core',
      position: { x: 380, y: 280 },
      cliMode: 'priv',
      ospfEnabled: false,
      ospfNetworks: [],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [
        { destination: '192.168.2.0', prefix: 24, nextHop: '10.0.0.2' }
      ],
      ipv6Routes: [],
      commandHistory: [],
      terminalBuffer: [
        { text: 'FRRouting 8.1 (r1)\nType "show ip route" to view static and connected routes.', type: 'banner' }
      ],
      interfaces: {
        'r1-eth0': {
          name: 'r1-eth0',
          ip: '192.168.1.1/24',
          mac: '00:00:01:01:00:01',
          up: true,
          ospfCost: 10,
        },
        'r1-eth1': {
          name: 'r1-eth1',
          ip: '10.0.0.1/30',
          mac: '00:00:01:01:00:02',
          up: true,
          ospfCost: 10,
        }
      }
    },
    r2: {
      id: 'r2',
      name: 'r2',
      type: 'router',
      role: 'core',
      position: { x: 620, y: 280 },
      cliMode: 'priv',
      ospfEnabled: false,
      ospfNetworks: [],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [
        { destination: '192.168.1.0', prefix: 24, nextHop: '10.0.0.1' }
      ],
      ipv6Routes: [],
      commandHistory: [],
      terminalBuffer: [
        { text: 'FRRouting 8.1 (r2)\nStatic route configured: 192.168.1.0/24 via 10.0.0.1.', type: 'banner' }
      ],
      interfaces: {
        'r2-eth0': {
          name: 'r2-eth0',
          ip: '10.0.0.2/30',
          mac: '00:00:02:01:00:01',
          up: true,
          ospfCost: 10,
        },
        'r2-eth1': {
          name: 'r2-eth1',
          ip: '192.168.2.1/24',
          mac: '00:00:02:01:00:02',
          up: true,
          ospfCost: 10,
        }
      }
    },
    h2: {
      id: 'h2',
      name: 'h2',
      type: 'host',
      position: { x: 860, y: 280 },
      cliMode: 'priv',
      ospfEnabled: false,
      ospfNetworks: [],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      defaultGateway: '192.168.2.1',
      commandHistory: [],
      terminalBuffer: [
        { text: 'Linux h2 (Ubuntu Host) - Mininet-IPLab\nType "ping 192.168.1.2" to verify end-to-end routing to h1.', type: 'banner' }
      ],
      interfaces: {
        'h2-eth0': {
          name: 'h2-eth0',
          ip: '192.168.2.2/24',
          mac: '00:00:00:00:02:02',
          up: true,
        }
      }
    }
  };

  const links: NetworkLink[] = [
    {
      id: 'link-h1-r1',
      source: 'h1',
      sourceHandle: 'h1-eth0',
      target: 'r1',
      targetHandle: 'r1-eth0',
      status: 'up',
      latency: 0.3
    },
    {
      id: 'link-r1-r2',
      source: 'r1',
      sourceHandle: 'r1-eth1',
      target: 'r2',
      targetHandle: 'r2-eth0',
      status: 'up',
      latency: 0.5
    },
    {
      id: 'link-r2-h2',
      source: 'r2',
      sourceHandle: 'r2-eth1',
      target: 'h2',
      targetHandle: 'h2-eth0',
      status: 'up',
      latency: 0.3
    }
  ];

  return {
    id: 'static-routing-4',
    name: 'Static Routing Lab (4 Nodes)',
    description: 'h1 - r1 - r2 - h2 linear topology for static route and gateway practice.',
    nodes,
    links: links.map(link => ({
      ...link,
      type: 'straight',
      style: { stroke: '#64748b', strokeWidth: 2 }
    }))
  };
}

export function createUtpExamPreset(preconfigured: boolean = true): LabPreset {
  const nodes: Record<string, NetworkNode> = {
    // ---------------- CORE ROUTERS (Center Triangle Backbone) ----------------
    // r1: Left Core at { x: 420, y: 380 }
    r1: {
      id: 'r1',
      name: 'r1',
      type: 'router',
      role: 'core',
      position: { x: 420, y: 380 },
      cliMode: 'priv',
      ospfEnabled: true,
      ospfRouterId: '1.1.1.1',
      ospfNetworks: [
        { network: '10.12.0.0', prefix: 30, area: 0 },
        { network: '10.13.0.0', prefix: 30, area: 0 },
        { network: '10.1.0.0', prefix: 24, area: 0 },
        { network: '1.1.1.1', prefix: 32, area: 0 },
      ],
      bgpEnabled: true,
      bgpAsNumber: 65000,
      bgpRouterId: '1.1.1.1',
      bgpNeighbors: {
        '2.2.2.2': { ip: '2.2.2.2', remoteAs: 65000, updateSource: 'lo', nextHopSelf: true, state: 'Established' },
        '3.3.3.3': { ip: '3.3.3.3', remoteAs: 65000, updateSource: 'lo', nextHopSelf: true, state: 'Established' },
      },
      bgpNetworks: [
        { network: '192.168.11.0', prefix: 24 },
        { network: '192.168.12.0', prefix: 24 }
      ],
      staticRoutes: [],
      ipv6Routes: [
        { destination: '2001:db8:200::', prefix: 48, interfaceName: 'tunnel_dc_as_65000' }
      ],
      commandHistory: [],
      terminalBuffer: [
        { text: 'FRRouting 8.1 - r1 (Core Router)\nOSPF Area 0, iBGP AS 65000, and 6in4 SIT Tunnel Active.\nType "show ip ospf neighbor" or "show ip bgp summary".', type: 'banner' }
      ],
      interfaces: {
        'lo': { name: 'lo', ip: '1.1.1.1/32', mac: '00:00:00:00:00:01', up: true },
        'r1-eth1': { name: 'r1-eth1', ip: '10.12.0.1/30', mac: '00:00:01:01:00:01', up: true, ospfCost: 10 },
        'r1-eth2': { name: 'r1-eth2', ip: '10.13.0.1/30', mac: '00:00:01:02:00:01', up: true, ospfCost: 10 },
        'r1-eth3': { name: 'r1-eth3', ip: '10.1.0.1/24', mac: '00:00:01:03:00:01', up: true, ospfCost: 10 },
        'tunnel_dc_as_65000': {
          name: 'tunnel_dc_as_65000',
          ipv6: '2001:db8:100::1/64',
          mac: '00:00:00:00:00:00',
          up: true,
          isTunnel: true,
          tunnelConfig: { mode: 'sit', local: '10.13.0.1', remote: '10.13.0.2', ttl: 255 }
        }
      }
    },
    // r2: Top Core at { x: 560, y: 200 }
    r2: {
      id: 'r2',
      name: 'r2',
      type: 'router',
      role: 'core',
      position: { x: 560, y: 200 },
      cliMode: 'priv',
      ospfEnabled: true,
      ospfRouterId: '2.2.2.2',
      ospfNetworks: [
        { network: '10.12.0.0', prefix: 30, area: 0 },
        { network: '10.23.0.0', prefix: 30, area: 0 },
        { network: '10.2.0.0', prefix: 24, area: 0 },
        { network: '2.2.2.2', prefix: 32, area: 0 },
      ],
      bgpEnabled: true,
      bgpAsNumber: 65000,
      bgpRouterId: '2.2.2.2',
      bgpNeighbors: {
        '1.1.1.1': { ip: '1.1.1.1', remoteAs: 65000, updateSource: 'lo', nextHopSelf: true, state: 'Established' },
        '3.3.3.3': { ip: '3.3.3.3', remoteAs: 65000, updateSource: 'lo', nextHopSelf: true, state: 'Established' },
      },
      bgpNetworks: [
        { network: '192.168.21.0', prefix: 24 },
        { network: '192.168.22.0', prefix: 24 }
      ],
      staticRoutes: [],
      ipv6Routes: [],
      commandHistory: [],
      terminalBuffer: [
        { text: 'FRRouting 8.1 - r2 (Core Router)\nOSPF Area 0, iBGP AS 65000.\nType "show ip route ospf" to see Dijkstra shortest paths.', type: 'banner' }
      ],
      interfaces: {
        'lo': { name: 'lo', ip: '2.2.2.2/32', mac: '00:00:00:00:00:02', up: true },
        'r2-eth1': { name: 'r2-eth1', ip: '10.12.0.2/30', mac: '00:00:02:01:00:01', up: true, ospfCost: 10 },
        'r2-eth2': { name: 'r2-eth2', ip: '10.23.0.1/30', mac: '00:00:02:02:00:01', up: true, ospfCost: 10 },
        'r2-eth3': { name: 'r2-eth3', ip: '10.2.0.1/24', mac: '00:00:02:03:00:01', up: true, ospfCost: 10 },
      }
    },
    // r3: Right Core at { x: 700, y: 380 }
    r3: {
      id: 'r3',
      name: 'r3',
      type: 'router',
      role: 'core',
      position: { x: 700, y: 380 },
      cliMode: 'priv',
      ospfEnabled: true,
      ospfRouterId: '3.3.3.3',
      ospfNetworks: [
        { network: '10.13.0.0', prefix: 30, area: 0 },
        { network: '10.23.0.0', prefix: 30, area: 0 },
        { network: '10.3.0.0', prefix: 24, area: 0 },
        { network: '3.3.3.3', prefix: 32, area: 0 },
      ],
      bgpEnabled: true,
      bgpAsNumber: 65000,
      bgpRouterId: '3.3.3.3',
      bgpNeighbors: {
        '1.1.1.1': { ip: '1.1.1.1', remoteAs: 65000, updateSource: 'lo', nextHopSelf: true, state: 'Established' },
        '2.2.2.2': { ip: '2.2.2.2', remoteAs: 65000, updateSource: 'lo', nextHopSelf: true, state: 'Established' },
      },
      bgpNetworks: [
        { network: '192.168.31.0', prefix: 24 },
        { network: '192.168.32.0', prefix: 24 }
      ],
      staticRoutes: [],
      ipv6Routes: [
        { destination: '2001:db8:100::', prefix: 48, interfaceName: 'tunnel_dc_as_65000' }
      ],
      commandHistory: [],
      terminalBuffer: [
        { text: 'FRRouting 8.1 - r3 (Core Router)\nOSPF Area 0, iBGP AS 65000, and 6in4 SIT Tunnel Active.\nType "show ip bgp" or "show ip ospf neighbor".', type: 'banner' }
      ],
      interfaces: {
        'lo': { name: 'lo', ip: '3.3.3.3/32', mac: '00:00:00:00:00:03', up: true },
        'r3-eth1': { name: 'r3-eth1', ip: '10.13.0.2/30', mac: '00:00:03:01:00:01', up: true, ospfCost: 10 },
        'r3-eth2': { name: 'r3-eth2', ip: '10.23.0.2/30', mac: '00:00:03:02:00:01', up: true, ospfCost: 10 },
        'r3-eth3': { name: 'r3-eth3', ip: '10.3.0.1/24', mac: '00:00:03:03:00:01', up: true, ospfCost: 10 },
        'tunnel_dc_as_65000': {
          name: 'tunnel_dc_as_65000',
          ipv6: '2001:db8:200::1/64',
          mac: '00:00:00:00:00:00',
          up: true,
          isTunnel: true,
          tunnelConfig: { mode: 'sit', local: '10.13.0.2', remote: '10.13.0.1', ttl: 255 }
        }
      }
    },

    // ---------------- BRANCH 1 (Left): s1, r11, c11, r12, c12 ----------------
    s1: {
      id: 's1',
      name: 's1',
      type: 'switch',
      position: { x: 280, y: 382 },
      cliMode: 'priv',
      ospfEnabled: false,
      ospfNetworks: [],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      commandHistory: [],
      terminalBuffer: [
        { text: 'Open vSwitch s1 (VLAN Bridge)\nType "ovs-vsctl show" to inspect VLAN tags (s1-eth2: tag 10, s1-eth3: tag 20).', type: 'banner' }
      ],
      interfaces: {
        's1-eth1': { name: 's1-eth1', mac: '00:00:51:01:00:01', up: true, vlanTag: 1 },
        's1-eth2': { name: 's1-eth2', mac: '00:00:51:02:00:01', up: true, vlanTag: 10 },
        's1-eth3': { name: 's1-eth3', mac: '00:00:51:03:00:01', up: true, vlanTag: 20 },
      }
    },
    r11: {
      id: 'r11',
      name: 'r11',
      type: 'router',
      role: 'edge',
      position: { x: 140, y: 280 },
      cliMode: 'priv',
      ospfEnabled: true,
      ospfRouterId: '11.11.11.11',
      ospfNetworks: [
        { network: '10.1.0.0', prefix: 24, area: 0 },
        { network: '192.168.11.0', prefix: 24, area: 0 },
      ],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      commandHistory: [],
      terminalBuffer: [
        { text: 'FRRouting 8.1 - r11 (Edge Router)\nVLAN 10 port connected to Switch s1.\nSubnet 192.168.11.0/24 to Host c11.', type: 'banner' }
      ],
      interfaces: {
        'r11-eth1': { name: 'r11-eth1', ip: '10.1.0.11/24', mac: '00:00:11:01:00:01', up: true, ospfCost: 10 },
        'r11-eth2': { name: 'r11-eth2', ip: '192.168.11.1/24', mac: '00:00:11:02:00:01', up: true, ospfCost: 10 },
      }
    },
    c11: {
      id: 'c11',
      name: 'c11',
      type: 'host',
      position: { x: 20, y: 280 },
      cliMode: 'priv',
      ospfEnabled: false,
      ospfNetworks: [],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [
        { destination: '2001:db8:200::', prefix: 48, interfaceName: 'c11-eth0' }
      ],
      defaultGateway: '192.168.11.1',
      commandHistory: [],
      terminalBuffer: [
        { text: 'Linux c11 (Host Client)\nIP: 192.168.11.2/24, GW: 192.168.11.1\nIPv6: 2001:db8:100::10/64\nType "ping 192.168.31.2" or "ping6 2001:db8:200::10".', type: 'banner' }
      ],
      interfaces: {
        'c11-eth0': {
          name: 'c11-eth0',
          ip: '192.168.11.2/24',
          ipv6: '2001:db8:100::10/64',
          mac: '00:00:c1:01:00:02',
          up: true
        }
      }
    },
    r12: {
      id: 'r12',
      name: 'r12',
      type: 'router',
      role: 'edge',
      position: { x: 140, y: 484 },
      cliMode: 'priv',
      ospfEnabled: true,
      ospfRouterId: '12.12.12.12',
      ospfNetworks: [
        { network: '10.1.0.0', prefix: 24, area: 0 },
        { network: '192.168.12.0', prefix: 24, area: 0 },
      ],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      commandHistory: [],
      terminalBuffer: [
        { text: 'FRRouting 8.1 - r12 (Edge Router)\nVLAN 20 port connected to Switch s1.\nSubnet 192.168.12.0/24 to Host c12.', type: 'banner' }
      ],
      interfaces: {
        'r12-eth1': { name: 'r12-eth1', ip: '10.1.0.12/24', mac: '00:00:12:01:00:01', up: true, ospfCost: 10 },
        'r12-eth2': { name: 'r12-eth2', ip: '192.168.12.1/24', mac: '00:00:12:02:00:01', up: true, ospfCost: 10 },
      }
    },
    c12: {
      id: 'c12',
      name: 'c12',
      type: 'host',
      position: { x: 20, y: 484 },
      cliMode: 'priv',
      ospfEnabled: false,
      ospfNetworks: [],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      defaultGateway: '192.168.12.1',
      commandHistory: [],
      terminalBuffer: [
        { text: 'Linux c12 (Host Client)\nIP: 192.168.12.2/24, GW: 192.168.12.1\nType "ping 192.168.22.2" to test inter-VLAN routing.', type: 'banner' }
      ],
      interfaces: {
        'c12-eth0': { name: 'c12-eth0', ip: '192.168.12.2/24', mac: '00:00:c1:02:00:02', up: true }
      }
    },

    // ---------------- BRANCH 2 (Top): s2, r21, c21, r22, c22 ----------------
    s2: {
      id: 's2',
      name: 's2',
      type: 'switch',
      position: { x: 562, y: 80 },
      cliMode: 'priv',
      ospfEnabled: false,
      ospfNetworks: [],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      commandHistory: [],
      terminalBuffer: [
        { text: 'Open vSwitch s2 (VLAN Bridge)\nType "ovs-vsctl show" to view port VLANs (s2-eth2: tag 10, s2-eth3: tag 20).', type: 'banner' }
      ],
      interfaces: {
        's2-eth1': { name: 's2-eth1', mac: '00:00:52:01:00:01', up: true, vlanTag: 1 },
        's2-eth2': { name: 's2-eth2', mac: '00:00:52:02:00:01', up: true, vlanTag: 10 },
        's2-eth3': { name: 's2-eth3', mac: '00:00:52:03:00:01', up: true, vlanTag: 20 },
      }
    },
    r21: {
      id: 'r21',
      name: 'r21',
      type: 'router',
      role: 'edge',
      position: { x: 460, y: -40 },
      cliMode: 'priv',
      ospfEnabled: true,
      ospfRouterId: '21.21.21.21',
      ospfNetworks: [
        { network: '10.2.0.0', prefix: 24, area: 0 },
        { network: '192.168.21.0', prefix: 24, area: 0 },
      ],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      commandHistory: [],
      terminalBuffer: [
        { text: 'FRRouting 8.1 - r21 (Edge Router)\nVLAN 10 port connected to Switch s2.\nSubnet 192.168.21.0/24 to Host c21.', type: 'banner' }
      ],
      interfaces: {
        'r21-eth1': { name: 'r21-eth1', ip: '10.2.0.21/24', mac: '00:00:21:01:00:01', up: true, ospfCost: 10 },
        'r21-eth2': { name: 'r21-eth2', ip: '192.168.21.1/24', mac: '00:00:21:02:00:01', up: true, ospfCost: 10 },
      }
    },
    c21: {
      id: 'c21',
      name: 'c21',
      type: 'host',
      position: { x: 460, y: -160 },
      cliMode: 'priv',
      ospfEnabled: false,
      ospfNetworks: [],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      defaultGateway: '192.168.21.1',
      commandHistory: [],
      terminalBuffer: [
        { text: 'Linux c21 (Host Client)\nIP: 192.168.21.2/24, GW: 192.168.21.1\nType "ping 192.168.11.2" to test connectivity.', type: 'banner' }
      ],
      interfaces: {
        'c21-eth0': { name: 'c21-eth0', ip: '192.168.21.2/24', mac: '00:00:c2:01:00:02', up: true }
      }
    },
    r22: {
      id: 'r22',
      name: 'r22',
      type: 'router',
      role: 'edge',
      position: { x: 664, y: -40 },
      cliMode: 'priv',
      ospfEnabled: true,
      ospfRouterId: '22.22.22.22',
      ospfNetworks: [
        { network: '10.2.0.0', prefix: 24, area: 0 },
        { network: '192.168.22.0', prefix: 24, area: 0 },
      ],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      commandHistory: [],
      terminalBuffer: [
        { text: 'FRRouting 8.1 - r22 (Edge Router)\nVLAN 20 port connected to Switch s2.\nSubnet 192.168.22.0/24 to Host c22.', type: 'banner' }
      ],
      interfaces: {
        'r22-eth1': { name: 'r22-eth1', ip: '10.2.0.22/24', mac: '00:00:22:01:00:01', up: true, ospfCost: 10 },
        'r22-eth2': { name: 'r22-eth2', ip: '192.168.22.1/24', mac: '00:00:22:02:00:01', up: true, ospfCost: 10 },
      }
    },
    c22: {
      id: 'c22',
      name: 'c22',
      type: 'host',
      position: { x: 664, y: -160 },
      cliMode: 'priv',
      ospfEnabled: false,
      ospfNetworks: [],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      defaultGateway: '192.168.22.1',
      commandHistory: [],
      terminalBuffer: [
        { text: 'Linux c22 (Host Client)\nIP: 192.168.22.2/24, GW: 192.168.22.1\nType "ping 192.168.32.2" to test connectivity.', type: 'banner' }
      ],
      interfaces: {
        'c22-eth0': { name: 'c22-eth0', ip: '192.168.22.2/24', mac: '00:00:c2:02:00:02', up: true }
      }
    },

    // ---------------- BRANCH 3 (Right): s3, r31, c31, r32, c32 ----------------
    s3: {
      id: 's3',
      name: 's3',
      type: 'switch',
      position: { x: 860, y: 382 },
      cliMode: 'priv',
      ospfEnabled: false,
      ospfNetworks: [],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      commandHistory: [],
      terminalBuffer: [
        { text: 'Open vSwitch s3 (VLAN Bridge)\nType "ovs-vsctl show" to view port VLANs (s3-eth2: tag 10, s3-eth3: tag 20).', type: 'banner' }
      ],
      interfaces: {
        's3-eth1': { name: 's3-eth1', mac: '00:00:53:01:00:01', up: true, vlanTag: 1 },
        's3-eth2': { name: 's3-eth2', mac: '00:00:53:02:00:01', up: true, vlanTag: 10 },
        's3-eth3': { name: 's3-eth3', mac: '00:00:53:03:00:01', up: true, vlanTag: 20 },
      }
    },
    r31: {
      id: 'r31',
      name: 'r31',
      type: 'router',
      role: 'edge',
      position: { x: 980, y: 280 },
      cliMode: 'priv',
      ospfEnabled: true,
      ospfRouterId: '31.31.31.31',
      ospfNetworks: [
        { network: '10.3.0.0', prefix: 24, area: 0 },
        { network: '192.168.31.0', prefix: 24, area: 0 },
      ],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      commandHistory: [],
      terminalBuffer: [
        { text: 'FRRouting 8.1 - r31 (Edge Router)\nVLAN 10 port connected to Switch s3.\nSubnet 192.168.31.0/24 to Host c31.', type: 'banner' }
      ],
      interfaces: {
        'r31-eth1': { name: 'r31-eth1', ip: '10.3.0.31/24', mac: '00:00:31:01:00:01', up: true, ospfCost: 10 },
        'r31-eth2': { name: 'r31-eth2', ip: '192.168.31.1/24', mac: '00:00:31:02:00:01', up: true, ospfCost: 10 },
      }
    },
    c31: {
      id: 'c31',
      name: 'c31',
      type: 'host',
      position: { x: 1100, y: 280 },
      cliMode: 'priv',
      ospfEnabled: false,
      ospfNetworks: [],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [
        { destination: '2001:db8:100::', prefix: 48, interfaceName: 'c31-eth0' }
      ],
      defaultGateway: '192.168.31.1',
      commandHistory: [],
      terminalBuffer: [
        { text: 'Linux c31 (Host Client)\nIP: 192.168.31.2/24, GW: 192.168.31.1\nIPv6: 2001:db8:200::10/64\nType "ping 192.168.11.2" or "ping6 2001:db8:100::10".', type: 'banner' }
      ],
      interfaces: {
        'c31-eth0': {
          name: 'c31-eth0',
          ip: '192.168.31.2/24',
          ipv6: '2001:db8:200::10/64',
          mac: '00:00:c3:01:00:02',
          up: true
        }
      }
    },
    r32: {
      id: 'r32',
      name: 'r32',
      type: 'router',
      role: 'edge',
      position: { x: 980, y: 484 },
      cliMode: 'priv',
      ospfEnabled: true,
      ospfRouterId: '32.32.32.32',
      ospfNetworks: [
        { network: '10.3.0.0', prefix: 24, area: 0 },
        { network: '192.168.32.0', prefix: 24, area: 0 },
      ],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      commandHistory: [],
      terminalBuffer: [
        { text: 'FRRouting 8.1 - r32 (Edge Router)\nVLAN 20 port connected to Switch s3.\nSubnet 192.168.32.0/24 to Host c32.', type: 'banner' }
      ],
      interfaces: {
        'r32-eth1': { name: 'r32-eth1', ip: '10.3.0.32/24', mac: '00:00:32:01:00:01', up: true, ospfCost: 10 },
        'r32-eth2': { name: 'r32-eth2', ip: '192.168.32.1/24', mac: '00:00:32:02:00:01', up: true, ospfCost: 10 },
      }
    },
    c32: {
      id: 'c32',
      name: 'c32',
      type: 'host',
      position: { x: 1100, y: 484 },
      cliMode: 'priv',
      ospfEnabled: false,
      ospfNetworks: [],
      bgpEnabled: false,
      bgpNeighbors: {},
      bgpNetworks: [],
      staticRoutes: [],
      ipv6Routes: [],
      defaultGateway: '192.168.32.1',
      commandHistory: [],
      terminalBuffer: [
        { text: 'Linux c32 (Host Client)\nIP: 192.168.32.2/24, GW: 192.168.32.1\nType "ping 192.168.12.2" to test connectivity.', type: 'banner' }
      ],
      interfaces: {
        'c32-eth0': { name: 'c32-eth0', ip: '192.168.32.2/24', mac: '00:00:c3:02:00:02', up: true }
      }
    }
  };

  const links: NetworkLink[] = [
    // Core Triangle Mesh Backbone
    { id: 'link-r1-r2', source: 'r1', sourceHandle: 'r1-eth1', target: 'r2', targetHandle: 'r2-eth1', status: 'up', latency: 0.5 },
    { id: 'link-r2-r3', source: 'r2', sourceHandle: 'r2-eth2', target: 'r3', targetHandle: 'r3-eth2', status: 'up', latency: 0.5 },
    { id: 'link-r1-r3', source: 'r1', sourceHandle: 'r1-eth2', target: 'r3', targetHandle: 'r3-eth1', status: 'up', latency: 0.5 },

    // Branch 1: Core Router r1 to Switch s1 and Edges/Hosts
    { id: 'link-r1-s1', source: 'r1', sourceHandle: 'r1-eth3', target: 's1', targetHandle: 's1-eth1', status: 'up', latency: 0.2 },
    { id: 'link-s1-r11', source: 's1', sourceHandle: 's1-eth2', target: 'r11', targetHandle: 'r11-eth1', status: 'up', latency: 0.2 },
    { id: 'link-s1-r12', source: 's1', sourceHandle: 's1-eth3', target: 'r12', targetHandle: 'r12-eth1', status: 'up', latency: 0.2 },
    { id: 'link-r11-c11', source: 'r11', sourceHandle: 'r11-eth2', target: 'c11', targetHandle: 'c11-eth0', status: 'up', latency: 0.2 },
    { id: 'link-r12-c12', source: 'r12', sourceHandle: 'r12-eth2', target: 'c12', targetHandle: 'c12-eth0', status: 'up', latency: 0.2 },

    // Branch 2: Core Router r2 to Switch s2 and Edges/Hosts
    { id: 'link-r2-s2', source: 'r2', sourceHandle: 'r2-eth3', target: 's2', targetHandle: 's2-eth1', status: 'up', latency: 0.2 },
    { id: 'link-s2-r21', source: 's2', sourceHandle: 's2-eth2', target: 'r21', targetHandle: 'r21-eth1', status: 'up', latency: 0.2 },
    { id: 'link-s2-r22', source: 's2', sourceHandle: 's2-eth3', target: 'r22', targetHandle: 'r22-eth1', status: 'up', latency: 0.2 },
    { id: 'link-r21-c21', source: 'r21', sourceHandle: 'r21-eth2', target: 'c21', targetHandle: 'c21-eth0', status: 'up', latency: 0.2 },
    { id: 'link-r22-c22', source: 'r22', sourceHandle: 'r22-eth2', target: 'c22', targetHandle: 'c22-eth0', status: 'up', latency: 0.2 },

    // Branch 3: Core Router r3 to Switch s3 and Edges/Hosts
    { id: 'link-r3-s3', source: 'r3', sourceHandle: 'r3-eth3', target: 's3', targetHandle: 's3-eth1', status: 'up', latency: 0.2 },
    { id: 'link-s3-r31', source: 's3', sourceHandle: 's3-eth2', target: 'r31', targetHandle: 'r31-eth1', status: 'up', latency: 0.2 },
    { id: 'link-s3-r32', source: 's3', sourceHandle: 's3-eth3', target: 'r32', targetHandle: 'r32-eth1', status: 'up', latency: 0.2 },
    { id: 'link-r31-c31', source: 'r31', sourceHandle: 'r31-eth2', target: 'c31', targetHandle: 'c31-eth0', status: 'up', latency: 0.2 },
    { id: 'link-r32-c32', source: 'r32', sourceHandle: 'r32-eth2', target: 'c32', targetHandle: 'c32-eth0', status: 'up', latency: 0.2 },
  ];

  return {
    id: 'utp-exam-18',
    name: 'UTP Exam Topology (18 Nodes)',
    description: 'Symmetrical 18-node topology: 3 Core Routers triangle mesh, 3 OVS Switches, 6 Edge Routers, 6 Hosts with OSPF, iBGP, VLAN, and 6in4 SIT Tunnel.',
    nodes,
    links: links.map(link => ({
      ...link,
      type: 'straight',
      style: { stroke: '#64748b', strokeWidth: 2 }
    }))
  };
}

export function createBlankPreset(): LabPreset {
  return {
    id: 'blank-canvas',
    name: 'Blank Canvas / Custom Mode',
    description: 'Empty canvas to build custom networks from scratch with routers, switches, and hosts.',
    nodes: {},
    links: []
  };
}
