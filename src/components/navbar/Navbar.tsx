'use client';

import React, { useState } from 'react';
import { useNetworkStore } from '../../store/useNetworkStore';
import { 
  Network, 
  RotateCcw, 
  FileCode, 
  BookOpen, 
  ChevronDown, 
  Terminal,
  Activity,
  Layers,
  Sun,
  Moon,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { getCustomPresets, deleteCustomPreset } from '../../engine/dynamicLayoutEngine';

export const Navbar: React.FC = () => {
  const isDarkMode = useNetworkStore(state => state.isDarkMode);
  const toggleDarkMode = useNetworkStore(state => state.toggleDarkMode);
  const currentPresetName = useNetworkStore(state => state.currentPresetName);
  const currentPresetId = useNetworkStore(state => state.currentPresetId);
  const loadPreset = useNetworkStore(state => state.loadPreset);
  const resetLab = useNetworkStore(state => state.resetLab);
  const restoreCanonicalLinks = useNetworkStore(state => state.restoreCanonicalLinks);
  const nodes = useNetworkStore(state => state.nodes);
  const openTerminalTabs = useNetworkStore(state => state.openTerminalTabs);
  const setIsConfigModalOpen = useNetworkStore(state => state.setIsConfigModalOpen);
  const runVerificationCheck = useNetworkStore(state => state.runVerificationCheck);
  const setActiveSidebarTab = useNetworkStore(state => state.setActiveSidebarTab);

  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false);

  const presets = [
    { id: 'utp-exam-18', name: 'UTP Exam Topology (18 Nodes)', desc: '3 Core Routers triangle mesh, 3 Switches, 6 Edge Routers, 6 Hosts' },
    { id: 'static-routing-4', name: 'Static Routing Lab (4 Nodes)', desc: 'Linear h1 - r1 - r2 - h2 topology' },
    { id: 'blank-canvas', name: 'Blank Canvas / Custom Mode', desc: 'Empty canvas to build custom networks' }
  ];

  return (
    <header className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 flex items-center justify-between select-none z-30 shrink-0 text-slate-800 dark:text-slate-100 transition-colors">
      {/* Brand & Badge */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight text-slate-800 dark:text-slate-100">Mininet-IPLab</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                Web v2.0
              </span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-none">Computer Network Exam Simulator</p>
          </div>
        </div>

        {/* Separator */}
        <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1 hidden md:block" />

        {/* Status Indicators */}
        <div className="hidden lg:flex items-center gap-2 text-xs">
          {/* Active Lab */}
          <div className="px-2.5 py-1 rounded-md bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <span className="text-slate-400 dark:text-slate-500 text-[10px] font-semibold uppercase">Lab:</span>
            <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[140px]">{currentPresetName}</span>
          </div>

          {/* Node Count */}
          <div className="px-2.5 py-1 rounded-md bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span className="text-slate-400 dark:text-slate-500 text-[10px] font-semibold uppercase">Nodes:</span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{Object.keys(nodes).length}</span>
          </div>

          {/* Active Terminals */}
          <div className="px-2.5 py-1 rounded-md bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-slate-400 dark:text-slate-500 text-[10px] font-semibold uppercase">Terminals:</span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{openTerminalTabs.length}</span>
          </div>

          {/* Status Live */}
          <div className="px-2.5 py-1 rounded-md bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-slate-600 dark:text-slate-300 text-xs font-medium">Ready</span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        {/* Preset Selector Dropdown */}
        <div className="relative">
          <button
            onClick={() => setPresetDropdownOpen(!presetDropdownOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 transition-colors shadow-2xs cursor-pointer"
          >
            <span>Lab Presets</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          </button>

          {presetDropdownOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg p-1 z-50">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800">
                Choose Topology Preset
              </div>
              {presets.map(p => (
                <button
                  key={p.id}
                  onClick={() => {
                    loadPreset(p.id);
                    setPresetDropdownOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors my-0.5 cursor-pointer ${
                    currentPresetId === p.id
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">{p.desc}</div>
                </button>
              ))}

              {(() => {
                const customPresets = getCustomPresets();
                if (customPresets.length === 0) return null;
                return (
                  <>
                    <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 border-t border-slate-100 dark:border-slate-800 mt-1.5">
                      Saved Custom Presets
                    </div>
                    {customPresets.map(cp => (
                      <div
                        key={cp.id}
                        className={`flex items-center justify-between px-3 py-1.5 rounded-md my-0.5 transition-colors ${
                          currentPresetId === cp.id
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <button
                          onClick={() => {
                            loadPreset(cp.id);
                            setPresetDropdownOpen(false);
                          }}
                          className="text-left text-xs flex-1 truncate cursor-pointer mr-2"
                        >
                          <div className="font-medium truncate">{cp.name}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                            {cp.description || `${Object.keys(cp.nodes).length} Nodes`}
                          </div>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteCustomPreset(cp.id);
                            setPresetDropdownOpen(false);
                          }}
                          className="p-1 text-slate-400 hover:text-rose-500 rounded transition-colors cursor-pointer"
                          title="Hapus Preset Kustom"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* Verify Connectivity Button */}
        <button
          onClick={runVerificationCheck}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-md shadow-xs transition-colors cursor-pointer"
          title="Run automated ping and routing verification"
        >
          <Activity className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Verify Lab</span>
        </button>

        {/* Export / Import Button */}
        <button
          onClick={() => setIsConfigModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 transition-colors cursor-pointer"
          title="Export or Import Topology JSON"
        >
          <FileCode className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Config</span>
        </button>

        {/* Guide Button */}
        <button
          onClick={() => setActiveSidebarTab('guide')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 transition-colors cursor-pointer"
          title="Open Lab Objectives & Addressing Guide"
        >
          <BookOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span className="hidden md:inline">Guide</span>
        </button>

        {/* Dark Mode Toggle Button */}
        <button
          onClick={toggleDarkMode}
          className="p-1.5 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {isDarkMode ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-slate-600" />}
        </button>

        {/* Restore Canonical Links Button */}
        <button
          onClick={restoreCanonicalLinks}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 transition-colors cursor-pointer"
          title="Restore standard canonical link wiring for this lab preset"
        >
          <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span className="hidden xl:inline">Tidy Links</span>
        </button>

        {/* Reset Lab Button */}
        <button
          onClick={resetLab}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 text-slate-600 dark:text-slate-300 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 transition-colors cursor-pointer"
          title="Reset current lab topology to default"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Reset</span>
        </button>
      </div>
    </header>
  );
};
