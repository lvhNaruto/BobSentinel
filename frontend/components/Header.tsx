"use client";

import { useState, useEffect } from "react";
import { Shield, Play, RotateCcw, ScrollText, Loader2, FileDown, Volume2, VolumeX, Compass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { soundFx } from "@/lib/soundFx";
import type { BobStatus } from "@/types";

export function Header({
  connected,
  running,
  runCount,
  dlqCount,
  bobStatus,
  starting,
  onRun,
  onSchema,
  onReset,
  onExportAudit,
  onStartTour,
}: {
  connected: boolean;
  running: boolean;
  runCount: number;
  dlqCount: number;
  bobStatus: BobStatus | null;
  starting: boolean;
  onRun: () => void;
  onSchema: () => void;
  onReset: () => void;
  onExportAudit?: () => void;
  onStartTour?: () => void;
}) {
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    setSoundEnabled(soundFx.isEnabled());
  }, []);

  const toggleSound = () => {
    const next = soundFx.toggle();
    setSoundEnabled(next);
  };

  const handleRun = () => {
    soundFx.playPipelineStart();
    onRun();
  };

  const handleReset = () => {
    soundFx.playChime();
    onReset();
  };

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-obsidian/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-400/45 bg-gradient-to-br from-[#0f2b22] to-[#071018] shadow-[0_0_20px_rgba(16,185,129,0.25)]">
            <Shield size={22} className="text-emeraldx" strokeWidth={2} />
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 animate-pulse-dot rounded-full border-2 border-obsidian bg-cyanx shadow-[0_0_8px_#22d3ee]" />
          </div>
          <div>
            <h1 className="font-display text-[19px] font-bold leading-tight text-white">
              Bob<span className="text-emeraldx">Sentinel</span>
            </h1>
            <p className="text-[11.5px] text-inkdim">
              Autonomous Self-Healing Guard • IBM Bob & AST Sandbox
            </p>
          </div>
        </div>

        <Badge tone={connected ? "emerald" : "rose"} className="ml-auto">
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
          {connected ? "System Operational" : "Backend Offline"}
        </Badge>
        <Badge
          tone={bobStatus === null ? "neutral" : bobStatus.ready ? "emerald" : bobStatus.configured ? "amber" : "rose"}
          title={bobStatus?.message ?? "Checking IBM Bob endpoint"}
        >
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
          {bobStatus === null
            ? "Checking IBM Bob"
            : bobStatus.ready
            ? "IBM Bob Ready"
            : bobStatus.configured
            ? "IBM Bob Unavailable"
            : "IBM Bob Not Configured"}
        </Badge>
        <span className="chip">RUNS: {runCount}</span>
        <span className="chip">DLQ: {dlqCount}</span>

        {/* Sound FX Toggle */}
        <button
          onClick={toggleSound}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] transition-colors ${
            soundEnabled
              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
              : "border-edge bg-panel2/60 text-inkfaint hover:text-ink"
          }`}
          title="Toggle High-Tech Audio Synthesizer"
          aria-label="Toggle Sound Effects"
        >
          {soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
          <span>{soundEnabled ? "Audio FX ON" : "Muted"}</span>
        </button>

        {onStartTour && (
          <button
            onClick={onStartTour}
            className="flex items-center gap-1.5 rounded-lg border border-violet-400/40 bg-violet-400/10 px-2.5 py-1.5 font-mono text-[11px] text-violet-300 transition-colors hover:bg-violet-400/20"
            title="Start Interactive Guided Demo Tour"
          >
            <Compass size={13} />
            <span>Tour</span>
          </button>
        )}

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button onClick={handleRun} disabled={running || starting} variant="primary" className="min-w-[220px]">
            {running || starting ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Healing Pipeline Active…
              </>
            ) : (
              <>
                <Play size={15} /> Run Autonomous Healing Pipeline
              </>
            )}
          </Button>
          <Button onClick={onSchema} aria-label="Show target schema contract">
            <ScrollText size={14} /> Target Schema
          </Button>
          {onExportAudit && (
            <Button onClick={onExportAudit} aria-label="Export compliance audit proof">
              <FileDown size={14} /> Export Audit
            </Button>
          )}
          <Button onClick={handleReset} variant="danger" aria-label="Reset warehouse and DLQ">
            <RotateCcw size={14} /> Reset
          </Button>
        </div>
      </div>
    </header>
  );
}
