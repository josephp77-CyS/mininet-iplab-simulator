import { create } from 'zustand';
import { NetworkNode, NetworkLink } from '../engine/types';
import { createUtpExamPreset, createStaticRoutingPreset, createBlankPreset, LabPreset } from '../engine/presets';
import { executeCommand, getPrompt } from '../engine/cliParser';
import { simulatePing } from '../engine/packetSimulator';
import {
  computeDynamicTopologyLayout,
  checkAndAutoWireSubnets,
  generateBulkTopology as generateBulk,
  saveCustomPreset,
  getCustomPresets,
  deleteCustomPreset,
  CustomLabPreset
} from '../engine/dynamicLayoutEngine';

interface VerificationResult {
  test: string;
  source: string;
  target: string;
  status: 'passed' | 'failed' | 'warning';
  detail: string;
}

interface NetworkState {
  currentPresetId: string;
  currentPresetName: string;
  nodes: Record<string, NetworkNode>;
  links: NetworkLink[];

  // UI Selection & Panels
  selectedNodeId: string | null;
  activeTerminalNodeId: string | null;
  openTerminalTabs: string[];
  activeSidebarTab: 'nodes' | 'guide' | 'palette';
  selectedGuideId: string;

  // Terminal Display Controls
  terminalFontSize: number;
  isTerminalMaximized: boolean;

  // Resizable & Collapsible Panels
  isSidebarCollapsed: boolean;
  sidebarWidth: number;
  isTerminalCollapsed: boolean;
  terminalWidth: number;

  // Theme Mode
  isDarkMode: boolean;
  toggleDarkMode: () => void;

  // Auto-Snap on CLI & Layout Engine
  autoSnapOnCli: boolean;
  toggleAutoSnapOnCli: () => void;
  applyAutoLayout: () => void;
  restoreCanonicalLinks: () => void;

  // Bulk Generator & Custom Presets
  generateBulkTopology: (
    architecture: 'enterprise' | 'spine-leaf' | 'mesh' | 'scattered',
    nodeCount: number
  ) => void;
  saveCurrentAsPreset: (name: string, description?: string) => void;
  loadCustomPreset: (presetId: string) => void;
  deleteCustomPreset: (presetId: string) => void;

  // Modals
  isConfigModalOpen: boolean;
  isVerificationModalOpen: boolean;
  verificationResults: VerificationResult[];

  // Actions
  loadPreset: (presetId: string) => void;
  resetLab: () => void;
  selectNode: (nodeId: string | null) => void;
  openTerminal: (nodeId: string) => void;
  closeTerminalTab: (nodeId: string) => void;
  setActiveTerminal: (nodeId: string) => void;
  executeTerminalCommand: (command: string) => void;
  clearTerminalBuffer: (nodeId: string) => void;
  setTerminalFontSize: (delta: number) => void;
  toggleTerminalMaximize: () => void;
  toggleSidebarCollapse: () => void;
  setSidebarWidth: (width: number) => void;
  toggleTerminalCollapse: () => void;
  setTerminalWidth: (width: number) => void;
  setActiveSidebarTab: (tab: 'nodes' | 'guide' | 'palette') => void;
  setSelectedGuide: (guideId: string) => void;
  setIsConfigModalOpen: (open: boolean) => void;
  setIsVerificationModalOpen: (open: boolean) => void;

  // Topology manipulation
  addNode: (node: NetworkNode) => void;
  removeNode: (nodeId: string) => void;
  addLink: (link: NetworkLink) => void;
  removeLink: (linkId: string) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;

  // Export / Import
  exportTopologyJson: () => string;
  importTopologyJson: (json: string) => boolean;

  // Verification
  runVerificationCheck: () => void;
}

const defaultPreset = createUtpExamPreset(true);

export const useNetworkStore = create<NetworkState>((set, get) => ({
  currentPresetId: defaultPreset.id,
  currentPresetName: defaultPreset.name,
  nodes: defaultPreset.nodes,
  links: defaultPreset.links,

  selectedNodeId: 'r1',
  activeTerminalNodeId: 'r1',
  openTerminalTabs: ['r1', 'r2', 's1', 'c11'],
  activeSidebarTab: 'nodes',
  selectedGuideId: 'utp-guide',

  terminalFontSize: 13,
  isTerminalMaximized: false,
  isSidebarCollapsed: false,
  sidebarWidth: 300,
  isTerminalCollapsed: false,
  terminalWidth: 480,
  isDarkMode: false,

  autoSnapOnCli: true,

  isConfigModalOpen: false,
  isVerificationModalOpen: false,
  verificationResults: [],

  toggleAutoSnapOnCli: () => {
    set(state => ({ autoSnapOnCli: !state.autoSnapOnCli }));
  },

  applyAutoLayout: () => {
    const { nodes, links } = get();
    const clonedNodes = { ...nodes };
    computeDynamicTopologyLayout(clonedNodes, links);
    set({ nodes: clonedNodes });
  },

  restoreCanonicalLinks: () => {
    const { currentPresetId, nodes } = get();
    if (currentPresetId === 'utp-exam-18' || Object.keys(nodes).length === 18) {
      const preset = createUtpExamPreset(true);
      set({ links: preset.links });
    } else if (currentPresetId === 'static-routing-4' || Object.keys(nodes).length === 4) {
      const preset = createStaticRoutingPreset();
      set({ links: preset.links });
    }
  },

  generateBulkTopology: (architecture, nodeCount) => {
    const generated = generateBulk(architecture, nodeCount);
    const firstNodeId = Object.keys(generated.nodes)[0] || null;
    const initialTabs = Object.keys(generated.nodes).slice(0, 4);

    set({
      currentPresetId: `bulk-${architecture}-${nodeCount}`,
      currentPresetName: `${architecture.toUpperCase()} Topologi (${nodeCount} Nodes)`,
      nodes: generated.nodes,
      links: generated.links,
      selectedNodeId: firstNodeId,
      activeTerminalNodeId: firstNodeId,
      openTerminalTabs: initialTabs,
    });
  },

  saveCurrentAsPreset: (name: string, description?: string) => {
    const { nodes, links } = get();
    saveCustomPreset({
      id: `custom-${Date.now()}`,
      name,
      description: description || `${Object.keys(nodes).length} Nodes`,
      nodes,
      links,
    });
  },

  loadCustomPreset: (presetId: string) => {
    const customs = getCustomPresets();
    const found = customs.find(p => p.id === presetId);
    if (found) {
      const firstNodeId = Object.keys(found.nodes)[0] || null;
      set({
        currentPresetId: found.id,
        currentPresetName: found.name,
        nodes: found.nodes,
        links: found.links,
        selectedNodeId: firstNodeId,
        activeTerminalNodeId: firstNodeId,
        openTerminalTabs: Object.keys(found.nodes).slice(0, 4),
      });
    }
  },

  deleteCustomPreset: (presetId: string) => {
    deleteCustomPreset(presetId);
  },

  loadPreset: (presetId: string) => {
    // Check if it's a custom preset
    if (presetId.startsWith('custom-')) {
      const customs = getCustomPresets();
      const found = customs.find(p => p.id === presetId);
      if (found) {
        const firstNodeId = Object.keys(found.nodes)[0] || null;
        set({
          currentPresetId: found.id,
          currentPresetName: found.name,
          nodes: found.nodes,
          links: found.links,
          selectedNodeId: firstNodeId,
          activeTerminalNodeId: firstNodeId,
          openTerminalTabs: Object.keys(found.nodes).slice(0, 4),
        });
        return;
      }
    }

    let preset: LabPreset;
    if (presetId === 'static-routing-4') {
      preset = createStaticRoutingPreset();
    } else if (presetId === 'blank-canvas') {
      preset = createBlankPreset();
    } else {
      preset = createUtpExamPreset(true);
    }

    const firstNodeId = Object.keys(preset.nodes)[0] || null;
    const initialTabs = Object.keys(preset.nodes).slice(0, 4);

    set({
      currentPresetId: preset.id,
      currentPresetName: preset.name,
      nodes: preset.nodes,
      links: preset.links,
      selectedNodeId: firstNodeId,
      activeTerminalNodeId: firstNodeId,
      openTerminalTabs: initialTabs,
    });
  },

  resetLab: () => {
    const { currentPresetId, loadPreset } = get();
    loadPreset(currentPresetId);
  },

  selectNode: (nodeId: string | null) => {
    set({ selectedNodeId: nodeId });
    if (nodeId) {
      get().openTerminal(nodeId);
    }
  },

  openTerminal: (nodeId: string) => {
    const { openTerminalTabs, nodes } = get();
    if (!nodes[nodeId]) return;

    if (!openTerminalTabs.includes(nodeId)) {
      set({
        openTerminalTabs: [...openTerminalTabs, nodeId],
        activeTerminalNodeId: nodeId,
        isTerminalCollapsed: false,
      });
    } else {
      set({
        activeTerminalNodeId: nodeId,
        isTerminalCollapsed: false,
      });
    }
  },

  closeTerminalTab: (nodeId: string) => {
    const { openTerminalTabs, activeTerminalNodeId } = get();
    const newTabs = openTerminalTabs.filter(id => id !== nodeId);
    let newActive = activeTerminalNodeId;
    if (activeTerminalNodeId === nodeId) {
      newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1] : null;
    }
    set({
      openTerminalTabs: newTabs,
      activeTerminalNodeId: newActive,
    });
  },

  setActiveTerminal: (nodeId: string) => {
    set({ activeTerminalNodeId: nodeId });
  },

  executeTerminalCommand: (commandInput: string) => {
    const { activeTerminalNodeId, autoSnapOnCli } = get();
    if (!activeTerminalNodeId || !get().nodes[activeTerminalNodeId]) return;

    // Split input on newlines to process paste and multi-line sequences synchronously
    const rawLines = commandInput.split(/\r?\n/);

    const workingNodes: Record<string, NetworkNode> = { ...get().nodes };
    let workingLinks: NetworkLink[] = [...get().links];

    // Deep clone active node to avoid stale mutations
    let currentNode: NetworkNode = {
      ...workingNodes[activeTerminalNodeId],
      interfaces: { ...workingNodes[activeTerminalNodeId].interfaces },
      staticRoutes: [...(workingNodes[activeTerminalNodeId].staticRoutes || [])],
      terminalBuffer: [...workingNodes[activeTerminalNodeId].terminalBuffer],
      commandHistory: [...workingNodes[activeTerminalNodeId].commandHistory],
    };
    workingNodes[activeTerminalNodeId] = currentNode;

    for (const rawLine of rawLines) {
      const line = rawLine.trim();
      if (!line) continue;

      const prompt = getPrompt(currentNode);

      // Execute sequentially in the synchronous working state
      const res = executeCommand(line, activeTerminalNodeId, workingNodes, workingLinks);

      // Re-fetch currentNode in case workingNodes[activeTerminalNodeId] was re-assigned
      currentNode = workingNodes[activeTerminalNodeId];

      if (res.clear) {
        currentNode.terminalBuffer = [];
      } else {
        currentNode.terminalBuffer.push({
          text: `${prompt}${line}`,
          type: 'system'
        });

        if (res.output) {
          currentNode.terminalBuffer.push({
            text: res.output,
            type: res.type || 'output'
          });
        }
      }

      // Handle CLI connect command link creation
      if (res.createdLink) {
        const { sourceNodeId, sourceInterface, targetNodeId, targetInterface } = res.createdLink;
        const linkId = `link-${sourceNodeId}-${sourceInterface}-${targetNodeId}-${targetInterface}`;
        const alreadyExists = workingLinks.some(
          l =>
            (l.source === sourceNodeId &&
              l.sourceHandle === sourceInterface &&
              l.target === targetNodeId &&
              l.targetHandle === targetInterface) ||
            (l.source === targetNodeId &&
              l.sourceHandle === targetInterface &&
              l.target === sourceNodeId &&
              l.targetHandle === sourceInterface)
        );
        if (!alreadyExists) {
          workingLinks.push({
            id: linkId,
            source: sourceNodeId,
            sourceHandle: sourceInterface,
            target: targetNodeId,
            targetHandle: targetInterface,
            status: 'up',
            latency: 0.3,
            type: 'straight'
          });
        }
      }
    }


    // Auto-Snap Position on CLI (if toggle is active)
    if (autoSnapOnCli) {
      computeDynamicTopologyLayout(workingNodes, workingLinks);
    }

    // Single synchronous Zustand commit!
    set({
      nodes: workingNodes,
      links: workingLinks,
    });
  },

  clearTerminalBuffer: (nodeId: string) => {
    const { nodes } = get();
    if (!nodes[nodeId]) return;
    const node = { ...nodes[nodeId], terminalBuffer: [] };
    set({
      nodes: { ...nodes, [nodeId]: node }
    });
  },

  setTerminalFontSize: (delta: number) => {
    set(state => ({
      terminalFontSize: Math.max(10, Math.min(22, state.terminalFontSize + delta))
    }));
  },

  toggleTerminalMaximize: () => {
    set(state => ({ isTerminalMaximized: !state.isTerminalMaximized }));
  },

  toggleSidebarCollapse: () => {
    set(state => ({ isSidebarCollapsed: !state.isSidebarCollapsed }));
  },

  setSidebarWidth: (width: number) => {
    set({ sidebarWidth: Math.max(240, Math.min(450, width)) });
  },

  toggleTerminalCollapse: () => {
    set(state => ({ isTerminalCollapsed: !state.isTerminalCollapsed }));
  },

  setTerminalWidth: (width: number) => {
    set({ terminalWidth: Math.max(350, Math.min(700, width)) });
  },

  toggleDarkMode: () =>
    set(state => {
      const next = !state.isDarkMode;
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', next);
      }
      return { isDarkMode: next };
    }),

  setActiveSidebarTab: (tab: 'nodes' | 'guide' | 'palette') => {
    set({ activeSidebarTab: tab, isSidebarCollapsed: false });
  },

  setSelectedGuide: (guideId: string) => {
    set({ selectedGuideId: guideId });
  },

  setIsConfigModalOpen: (open: boolean) => {
    set({ isConfigModalOpen: open });
  },

  setIsVerificationModalOpen: (open: boolean) => {
    set({ isVerificationModalOpen: open });
  },

  addNode: (node: NetworkNode) => {
    set(state => ({
      nodes: { ...state.nodes, [node.id]: node },
      openTerminalTabs: [...state.openTerminalTabs, node.id],
      activeTerminalNodeId: node.id,
      selectedNodeId: node.id,
    }));
  },

  removeNode: (nodeId: string) => {
    set(state => {
      const newNodes = { ...state.nodes };
      delete newNodes[nodeId];

      const newLinks = state.links.filter(
        link => link.source !== nodeId && link.target !== nodeId
      );

      const newTabs = state.openTerminalTabs.filter(id => id !== nodeId);
      const newActiveTerminal =
        state.activeTerminalNodeId === nodeId ? newTabs[0] || null : state.activeTerminalNodeId;

      return {
        nodes: newNodes,
        links: newLinks,
        openTerminalTabs: newTabs,
        activeTerminalNodeId: newActiveTerminal,
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      };
    });
  },

  addLink: (link: NetworkLink) => {
    set(state => ({
      links: [...state.links, link]
    }));
  },

  removeLink: (linkId: string) => {
    set(state => ({
      links: state.links.filter(l => l.id !== linkId)
    }));
  },

  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => {
    set(state => {
      const node = state.nodes[nodeId];
      if (!node) return state;
      return {
        nodes: {
          ...state.nodes,
          [nodeId]: { ...node, position }
        }
      };
    });
  },

  exportTopologyJson: () => {
    const { nodes, links, currentPresetId, currentPresetName } = get();
    return JSON.stringify(
      { presetId: currentPresetId, presetName: currentPresetName, nodes, links },
      null,
      2
    );
  },

  importTopologyJson: (json: string) => {
    try {
      const parsed = JSON.parse(json);
      if (parsed.nodes && parsed.links) {
        const firstNodeId = Object.keys(parsed.nodes)[0] || null;
        set({
          nodes: parsed.nodes,
          links: parsed.links,
          currentPresetName: parsed.presetName || 'Custom Imported Lab',
          selectedNodeId: firstNodeId,
          activeTerminalNodeId: firstNodeId,
          openTerminalTabs: Object.keys(parsed.nodes).slice(0, 4),
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  runVerificationCheck: () => {
    const { nodes, links } = get();
    const results: VerificationResult[] = [];

    // Test 1: Core Router OSPF Adjacency r1 <-> r2
    const p1 = simulatePing('r1', '10.12.0.2', false, nodes, links);
    results.push({
      test: 'Core Mesh: r1 to r2 link',
      source: 'r1',
      target: '10.12.0.2',
      status: p1.success ? 'passed' : 'failed',
      detail: p1.success ? `ICMP ping OK (${p1.rtt}ms)` : p1.error || 'Failed',
    });

    // Test 2: Core Router OSPF Adjacency r2 <-> r3
    const p2 = simulatePing('r2', '10.23.0.2', false, nodes, links);
    results.push({
      test: 'Core Mesh: r2 to r3 link',
      source: 'r2',
      target: '10.23.0.2',
      status: p2.success ? 'passed' : 'failed',
      detail: p2.success ? `ICMP ping OK (${p2.rtt}ms)` : p2.error || 'Failed',
    });

    // Test 3: Core Router OSPF Adjacency r1 <-> r3
    const p3 = simulatePing('r1', '10.13.0.2', false, nodes, links);
    results.push({
      test: 'Core Mesh: r1 to r3 link',
      source: 'r1',
      target: '10.13.0.2',
      status: p3.success ? 'passed' : 'failed',
      detail: p3.success ? `ICMP ping OK (${p3.rtt}ms)` : p3.error || 'Failed',
    });

    // Test 4: Host c11 to Gateway r11
    if (nodes['c11']) {
      const pHostGw = simulatePing('c11', '192.168.11.1', false, nodes, links);
      results.push({
        test: 'Host to Gateway: c11 to r11',
        source: 'c11',
        target: '192.168.11.1',
        status: pHostGw.success ? 'passed' : 'failed',
        detail: pHostGw.success
          ? `Ping to default GW OK (${pHostGw.rtt}ms)`
          : pHostGw.error || 'Failed',
      });
    }

    // Test 5: End-to-end Host c11 to Host c31 (Cross Core OSPF/iBGP)
    if (nodes['c11'] && nodes['c31']) {
      const pCross = simulatePing('c11', '192.168.31.2', false, nodes, links);
      results.push({
        test: 'End-to-End IPv4 Routing: c11 to c31',
        source: 'c11',
        target: '192.168.31.2',
        status: pCross.success ? 'passed' : 'failed',
        detail: pCross.success
          ? `Full multi-hop routing succeeded (${pCross.rtt}ms, ${pCross.hops.length} hops)`
          : pCross.error || 'Failed',
      });
    }

    // Test 6: IPv6 6in4 SIT Tunnel Ping (c11 to c31)
    if (nodes['c11'] && nodes['c31']) {
      const pV6 = simulatePing('c11', '2001:db8:200::10', true, nodes, links);
      results.push({
        test: '6in4 SIT Tunnel IPv6: c11 to c31',
        source: 'c11',
        target: '2001:db8:200::10',
        status: pV6.success ? 'passed' : 'failed',
        detail: pV6.success
          ? `IPv6 over IPv4 SIT encapsulation active (${pV6.rtt}ms)`
          : pV6.error || 'Check 6in4 tunnel routes',
      });
    }

    set({ verificationResults: results, isVerificationModalOpen: true });
  }
}));
