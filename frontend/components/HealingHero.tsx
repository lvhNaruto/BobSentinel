"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Zap, ShieldCheck, ArrowRight, GitFork, Code2, Sparkles } from "lucide-react";
import type { HealingAudit } from "@/types";
import { cn, prettyJson, formatLatency } from "@/lib/utils";

/** Renders one side of the diff with semantic row highlights. */
function JsonPane({
  data,
  side,
  counterpart,
}: {
  data: Record<string, unknown>;
  side: "before" | "after";
  counterpart?: Record<string, unknown>;
}) {
  const entries = Object.entries(data);
  return (
    <div className="code-block" role="group" aria-label={side === "before" ? "raw drifted payload" : "healed conformed payload"}>
      {entries.length === 0 && <span className="text-inkfaint">{"{ }"}</span>}
      {entries.map(([k, v]) => {
        const removed = side === "before" && counterpart && !(k in counterpart);
        const added = side === "after" && counterpart && !(k in counterpart);
        return (
          <div
            key={k}
            className={cn(
              "flex items-start gap-2 border-b border-edge/60 py-1 last:border-0",
              removed && "text-violet-300",
              added && "text-emerald-300"
            )}
          >
            <span className="text-inkfaint">"{k}":</span>
            <span className="min-w-0 flex-1 break-words">
              {typeof v === "object" ? prettyJson(v) : String(v)}
            </span>
            {removed && <span className="font-mono text-[9px] uppercase text-violet-300/80">mutated</span>}
            {added && <span className="font-mono text-[9px] uppercase text-emerald-300/80">conformed</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Visual Field Lineage Map showing inbound keys connecting to warehouse contract */
function FieldLineageMap({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const beforeKeys = Object.keys(before);
  const afterKeys = ["title", "author", "source_url", "relevance_score", "extra_metadata"];

  // Helper to detect what mapped where
  const getMappingExplanation = (targetKey: string) => {
    switch (targetKey) {
      case "title":
        const titleMatch = beforeKeys.find((k) => /title|name|repo|heading|project/i.test(k));
        return {
          source: titleMatch || "(inferred)",
          rule: titleMatch === "title" ? "Direct Match" : "Key Alias Resolution",
          badge: titleMatch === "title" ? "emerald" : "violet",
        };
      case "author":
        const authorMatch = beforeKeys.find((k) => /author|owner|maintainer|creator|user|login/i.test(k));
        return {
          source: authorMatch || "source_url (path extract)",
          rule: authorMatch ? "Key Alias Resolution" : "URL Regex Extracted",
          badge: authorMatch ? "violet" : "cyan",
        };
      case "source_url":
        const urlMatch = beforeKeys.find((k) => /url|link|source|html_url|endpoint/i.test(k));
        return {
          source: urlMatch || "(inferred)",
          rule: "Protocol Normalized & Query Cleaned",
          badge: "emerald",
        };
      case "relevance_score":
        const scoreMatch = beforeKeys.find((k) => /score|rating|confidence|popularity|relevance/i.test(k));
        return {
          source: scoreMatch || "unspecified",
          rule: "Normalized & Clamped (0-100 INT)",
          badge: "teal",
        };
      case "extra_metadata":
        return {
          source: "unmapped keys & raw metrics",
          rule: "JSON Sidecar Preserved (Zero Loss)",
          badge: "cyan",
        };
      default:
        return { source: "unknown", rule: "Direct Copy", badge: "neutral" };
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-edge bg-obsidian/70 p-3.5 font-mono text-[11px]">
      <div className="grid grid-cols-[1fr_auto_1.4fr_1fr] items-center gap-2 border-b border-edge/60 pb-2 text-[10px] uppercase font-bold text-inkdim">
        <span>Inbound Drifting Key</span>
        <span>Flow</span>
        <span>AST Transformation Rule</span>
        <span>Conformed Schema Field</span>
      </div>
      {afterKeys.map((targetKey) => {
        const info = getMappingExplanation(targetKey);
        const val = after[targetKey];
        return (
          <div
            key={targetKey}
            className="grid grid-cols-[1fr_auto_1.4fr_1fr] items-center gap-2 rounded-lg border border-edge/40 bg-panel2/40 px-2.5 py-1.5 transition-colors hover:border-violet-400/40"
          >
            <div className="flex items-center gap-1.5 text-violet-300">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              <span className="truncate font-semibold">{info.source}</span>
            </div>
            <ArrowRight size={12} className="text-inkfaint" />
            <div className="text-[10px] text-inkdim flex items-center gap-1">
              <span className="rounded bg-panel2 px-1.5 py-0.5 border border-edge text-cyan-300">
                {info.rule}
              </span>
            </div>
            <div className="flex items-center justify-between text-emerald-300">
              <span className="font-bold">{targetKey}</span>
              <span className="text-[9.5px] text-inkfaint truncate max-w-[120px]">
                {typeof val === "object" ? "{…}" : String(val ?? "")}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function HealingHero({ healing }: { healing: HealingAudit | null }) {
  const [viewMode, setViewMode] = useState<"diff" | "lineage">("diff");
  const reduce = useReducedMotion();

  if (!healing) {
    return (
      <section className="panel" aria-label="Self-healing transformation">
        <p className="panel-title">Self-Healing Transformation — Before → AI → After</p>
        <div className="rounded-xl border border-dashed border-emerald-400/30 bg-emerald-400/[0.04] p-8 text-center">
          <p className="font-display text-[14px] font-bold text-emeraldx">No schema drift events yet</p>
          <p className="mt-1 text-[11.5px] text-inkdim">
            Run the autonomous healing pipeline to watch drift get healed in real time.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="Self-healing transformation">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge/60 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
            <Sparkles size={14} />
          </span>
          <p className="panel-title mb-0">Self-Healing Transformation — Before → AI → After</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-cyanx">
            sig {healing.signature} • {formatLatency(healing.latency_ms)}
          </span>
          <div className="flex items-center rounded-lg border border-edge bg-panel2/60 p-0.5 font-mono text-[10px]">
            <button
              onClick={() => setViewMode("diff")}
              className={`flex items-center gap-1 rounded px-2 py-0.5 transition-colors ${
                viewMode === "diff" ? "bg-violet-500/20 text-violet-300 font-bold" : "text-inkdim hover:text-white"
              }`}
            >
              <Code2 size={11} /> JSON Diff
            </button>
            <button
              onClick={() => setViewMode("lineage")}
              className={`flex items-center gap-1 rounded px-2 py-0.5 transition-colors ${
                viewMode === "lineage" ? "bg-emerald-500/20 text-emerald-300 font-bold" : "text-inkdim hover:text-white"
              }`}
            >
              <GitFork size={11} /> Field Lineage
            </button>
          </div>
        </div>
      </div>

      {viewMode === "lineage" ? (
        <FieldLineageMap before={healing.before} after={healing.after} />
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
          <motion.div
            initial={reduce ? undefined : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="rounded-xl border border-rosex/30 bg-rosex/[0.04] p-3"
          >
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-rosex">
              ● Before AI — Drifted Raw Ingress
            </p>
            <JsonPane data={healing.before} side="before" counterpart={healing.after} />
          </motion.div>

          <motion.div
            className="flex flex-row items-center justify-center gap-3 md:flex-col"
            initial={reduce ? undefined : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-violet-400/50 bg-violet-400/10 shadow-[0_0_22px_rgba(139,92,246,0.35)]">
              <Zap size={22} className="text-violet-300" />
            </span>
            <div className="flex flex-col items-center gap-1">
              <span className="font-mono text-[9px] font-bold text-violet-300">IBM BOB</span>
              <span className="flex items-center gap-1 font-mono text-[9px] text-inkdim">
                <ShieldCheck size={11} className="text-emeraldx" /> AST VERIFIED
              </span>
            </div>
          </motion.div>

          <motion.div
            initial={reduce ? undefined : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.15 }}
            className="rounded-xl border border-emeraldx/30 bg-emeraldx/[0.04] p-3"
          >
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-emeraldx">
              ● After AI — Conformed Warehouse Record
            </p>
            <JsonPane data={healing.after} side="after" counterpart={healing.before} />
          </motion.div>
        </div>
      )}
    </section>
  );
}
