"use client";

import { useCallback, useEffect, useState } from "react";
import { useSentinel } from "@/hooks/useSentinel";
import { api } from "@/lib/api";
import { Header } from "@/components/Header";
import { MetricsBar } from "@/components/MetricsBar";
import { PipelineFlow } from "@/components/PipelineFlow";
import { HealingHero } from "@/components/HealingHero";
import { RoiCalculator } from "@/components/RoiCalculator";
import { Warehouse } from "@/components/Warehouse";
import { DlqPanel } from "@/components/DlqPanel";
import { TelemetryFeed } from "@/components/TelemetryFeed";
import { SandboxPanel } from "@/components/SandboxPanel";
import { CachePanel } from "@/components/CachePanel";
import { Playground } from "@/components/Playground";
import { StreamSource } from "@/components/StreamSource";
import { TourModal } from "@/components/TourModal";
import { Dialog } from "@/components/ui/dialog";
import { soundFx } from "@/lib/soundFx";
import type { AstInfo, BobStatus } from "@/types";

const FALLBACK_AST: AstInfo = {
  state: "standby",
  verified: null,
  message: "Awaiting synthesized patch.",
  checks: [],
  compiles: 0,
};

export default function Page() {
  const { state, connected, refresh } = useSentinel();
  const [topics, setTopics] = useState<string[]>([]);
  const [sourceMode, setSourceMode] = useState<"preset" | "custom">("preset");
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [query, setQuery] = useState("BobSentinel");
  const [starting, setStarting] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaText, setSchemaText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bobStatus, setBobStatus] = useState<BobStatus | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [playgroundPayload, setPlaygroundPayload] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refreshBobStatus = async () => {
      try {
        const status = await api.bobStatus();
        if (active) setBobStatus(status);
      } catch {
        if (active) setBobStatus(null);
      }
    };
    void refreshBobStatus();
    const timer = setInterval(refreshBobStatus, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    api.topics().then(({ topics: availableTopics }) => {
      setTopics(availableTopics);
      setSelectedTopics((current) => {
        const validSelection = current.filter((topic) => availableTopics.includes(topic));
        return validSelection.length ? validSelection : availableTopics.slice(0, 1);
      });
    }).catch((e) => {
      setTopics([]);
      setNotice(e instanceof Error ? e.message : "Failed to load upstream topics");
    });
  }, []);

  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(null), 4200);
      return () => clearTimeout(t);
    }
  }, [notice]);

  const runPipeline = useCallback(
    async (body: { mode: string; topics?: string[]; query?: string }) => {
      setStarting(true);
      try {
        await api.runPipeline(body);
        setNotice("Pipeline started — watch the live pipeline & telemetry.");
        refresh();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Failed to start pipeline");
      } finally {
        setStarting(false);
      }
    },
    [refresh]
  );

  const openSchema = useCallback(async () => {
    setSchemaOpen(true);
    setSchemaText(null);
    try {
      const s = await api.schema();
      setSchemaText(s.schema);
    } catch {
      setSchemaText("Failed to load schema contract from backend.");
    }
  }, []);

  const resetAll = useCallback(async () => {
    try {
      await api.reset(true);
      setNotice("Warehouse & DLQ reset. Engine re-armed.");
      refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Reset failed");
    }
  }, [refresh]);

  const handleReplayPayload = useCallback((payload: string) => {
    setPlaygroundPayload(payload);
    soundFx.playChime();
    setNotice("Quarantined payload loaded into Judge Playground for analysis.");
    const el = document.getElementById("judge-playground");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  const exportAudit = useCallback(() => {
    const auditData = {
      system: "BobSentinel",
      tagline: "Autonomous Self-Healing Guard",
      engine: "IBM Bob / Granite 3.3 8B Instruct",
      exported_at: new Date().toISOString(),
      run_count: state?.run_count ?? 0,
      metrics: state?.metrics ?? {},
      learned_templates: state?.cache?.signatures ?? [],
      warehouse_sample_count: state?.warehouse?.length ?? 0,
      dlq_quarantine_count: state?.dlq?.length ?? 0,
      dlq_records: state?.dlq ?? [],
      ast_sandbox: {
        status: state?.ast?.state ?? "verified",
        banned_modules_blocked: ["os", "sys", "subprocess", "socket", "requests", "shutil"],
        banned_calls_blocked: ["eval", "exec", "__import__", "compile", "open"],
      },
      audit_verdict: (state?.metrics?.dlq_count ?? 0) === 0 ? "100% CLEAN WAREHOUSE" : "DLQ ISOLATION ACTIVE — Zero warehouse pollution",
    };
    const blob = new Blob([JSON.stringify(auditData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `BobSentinel_Compliance_Audit_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    soundFx.playSandboxVerified();
    setNotice("Compliance audit proof exported successfully.");
  }, [state]);

  const metrics = state?.metrics;
  const running = state?.running ?? false;

  return (
    <div className="min-h-screen">
      <Header
        connected={connected}
        running={running}
        runCount={state?.run_count ?? 0}
        dlqCount={metrics?.dlq_count ?? 0}
        bobStatus={bobStatus}
        onRun={() => runPipeline(
          sourceMode === "preset"
            ? { mode: "preset", topics: selectedTopics }
            : { mode: "custom", query }
        )}
        starting={starting}
        onSchema={openSchema}
        onReset={resetAll}
        onExportAudit={exportAudit}
        onStartTour={() => setTourOpen(true)}
      />

      {notice && (
        <p
          role="status"
          className="mx-auto max-w-[1600px] px-4 pt-3 lg:px-8"
        >
          <span className="inline-block rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 font-mono text-[11px] text-emeraldx shadow-[0_0_12px_rgba(16,185,129,0.2)]">
            {notice}
          </span>
        </p>
      )}

      <main className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 lg:px-8">
        <MetricsBar metrics={metrics} />

        <PipelineFlow stage={state?.stage ?? null} dlqActive={state?.dlq_active ?? false} />

        <RoiCalculator
          metrics={metrics}
          cacheCount={state?.cache?.signatures?.length ?? 0}
        />

        <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
          <div className="space-y-6">
            <HealingHero healing={state?.healing ?? null} />
            <Warehouse records={state?.warehouse ?? []} />
            <DlqPanel records={state?.dlq ?? []} onReplayPayload={handleReplayPayload} />
            <TelemetryFeed events={state?.telemetry ?? []} />
          </div>
          <div className="space-y-6">
            <StreamSource
              topics={topics}
              mode={sourceMode}
              onModeChange={setSourceMode}
              selected={selectedTopics}
              onSelectedChange={setSelectedTopics}
              query={query}
              onQueryChange={setQuery}
              running={running || starting}
              onRun={runPipeline}
            />
            <SandboxPanel ast={state?.ast ?? FALLBACK_AST} patch={state?.patch ?? null} />
            <Playground onDone={refresh} initialPayload={playgroundPayload} />
            <CachePanel
              entries={state?.cache?.signatures ?? []}
              note={state?.cache?.note ?? ""}
            />
          </div>
        </div>

        <footer className="border-t border-edge pt-4 text-center font-mono text-[10px] text-inkfaint">
          BobSentinel — Autonomous Self-Healing Guard • IBM Bob / Granite 3.3 •
          AST Security Sandbox • SQLite Warehouse + DLQ
        </footer>
      </main>

      <TourModal open={tourOpen} onClose={() => setTourOpen(false)} />

      <Dialog open={schemaOpen} onClose={() => setSchemaOpen(false)} title="Target Schema Contract — tech_projects" wide>
        {schemaText ? (
          <pre className="code-block" aria-label="Live warehouse schema contract">
            {schemaText}
          </pre>
        ) : (
          <p className="py-6 text-center text-[12px] text-inkdim">Loading schema contract…</p>
        )}
      </Dialog>
    </div>
  );
}
