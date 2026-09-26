"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Shield, Sparkles, Cpu, Database, Skull, Zap, ChevronRight, ChevronLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TourStep {
  title: string;
  badge: string;
  icon: React.ReactNode;
  summary: string;
  highlights: string[];
  docAnchor?: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Upstream Ingress & Chaos Mutation",
    badge: "Stage 1",
    icon: <Database size={20} className="text-cyan-400" />,
    summary:
      "BobSentinel connects to live upstream streams (GitHub API & Tavily) and injects realistic, real-world schema drift (renamed keys, casing changes, score format mutations) via the ChaosSchemaMutator.",
    highlights: [
      "Dynamic Shannon entropy guard catches keyboard mash and garbage queries",
      "Deterministic data resolution with live API fallback",
      "Zero pipeline stoppage when schemas drift at 2:00 AM",
    ],
  },
  {
    title: "3-Tier Data Triage SLA",
    badge: "Stage 2",
    icon: <Zap size={20} className="text-amber-400" />,
    summary:
      "Every record is evaluated against the warehouse contract before touching the LLM. Only records with legitimate drift invoke AI synthesis.",
    highlights: [
      "Tier 1 (Clean): Exact matches bypass LLM directly to warehouse (0 tokens, 0ms)",
      "Tier 2 (Drift): Semantic fields present but shifted → triggers IBM Bob agentic healing",
      "Tier 3 (Alien): Unrecoverable noise (IoT, login logs) routed to Dead Letter Queue",
    ],
  },
  {
    title: "IBM Bob / Granite 3.3 Patch Synthesis",
    badge: "Stage 3",
    icon: <Sparkles size={20} className="text-violet-400" />,
    summary:
      "The LLM inspects a structural skeleton prototype (saving 90% prompt tokens) and dynamically synthesizes a pure Python transform_record function.",
    highlights: [
      "Zero hardcoded field aliases — dynamically infers identity from payload keys",
      "Strict Score Contract: parses decimals, percentages, and rating scales (0-100 INT)",
      "Sidecar Extraction: unmapped extra fields preserved in extra_metadata JSON column",
    ],
  },
  {
    title: "AST Security Sandbox (Bytecode Defense)",
    badge: "Stage 4",
    icon: <Cpu size={20} className="text-teal-400" />,
    summary:
      "Before execution, the synthesized code is inspected by Python's Abstract Syntax Tree (ast.parse) in an isolated empty namespace.",
    highlights: [
      "Banned Modules: os, sys, subprocess, socket, requests, urllib, shutil",
      "Banned Calls: eval(), exec(), __import__(), compile(), open()",
      "Pre-execution verification guarantees zero Remote Code Execution (RCE)",
    ],
  },
  {
    title: "SHA-256 Learned Template Cache",
    badge: "Stage 5",
    icon: <Shield size={20} className="text-emerald-400" />,
    summary:
      "Once an AST-verified patch is approved, its sorted-key fingerprint is saved in the template_cache SQLite table.",
    highlights: [
      "Sub-10ms cache execution for recurring payload shapes",
      "Saves ~1,150 LLM tokens per recurring record",
      "Live cache panel with single-click signature eviction",
    ],
  },
  {
    title: "Enterprise DLQ & Compliance Audit",
    badge: "Stage 6",
    icon: <Skull size={20} className="text-rose-400" />,
    summary:
      "Corrupted payloads or hostile injections never touch the primary warehouse. They are quarantined in tech_projects_dlq with full audit telemetry.",
    highlights: [
      "100% warehouse purity guarantee (0 bad bytes in tech_projects)",
      "Interactive DLQ-to-Playground re-triage workflow",
      "1-Click Compliance Audit Export with cryptographic SHA-256 signatures",
    ],
  },
];

export function TourModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [currentStep, setCurrentStep] = useState(0);

  const step = TOUR_STEPS[currentStep];

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="BobSentinel — System Architecture Tour" wide>
      <div className="space-y-4">
        {/* Step Indicator */}
        <div className="flex items-center justify-between border-b border-edge/60 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-edge bg-panel2 shadow-inner">
              {step.icon}
            </span>
            <div>
              <span className="font-mono text-[10px] uppercase font-bold text-violet-300">
                {step.badge} of {TOUR_STEPS.length}
              </span>
              <h3 className="font-display text-[15px] font-bold text-white leading-none mt-0.5">
                {step.title}
              </h3>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {TOUR_STEPS.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentStep(idx)}
                className={`h-2 rounded-full transition-all ${
                  idx === currentStep ? "w-6 bg-emerald-400" : "w-2 bg-edge hover:bg-inkfaint"
                }`}
                aria-label={`Jump to step ${idx + 1}`}
              />
            ))}
          </div>
        </div>

        {/* Summary Description */}
        <p className="text-[12.5px] leading-relaxed text-inkdim font-sans">
          {step.summary}
        </p>

        {/* Highlights */}
        <div className="rounded-xl border border-edge bg-obsidian/70 p-3.5 space-y-2">
          <p className="font-mono text-[10.5px] uppercase font-bold text-inkfaint">
            Key Architectural Guarantees:
          </p>
          <ul className="space-y-1.5">
            {step.highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-[11.5px] text-ink">
                <CheckCircle2 size={13} className="text-emeraldx shrink-0 mt-0.5" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer Navigation */}
        <div className="flex items-center justify-between pt-2 border-t border-edge/60">
          <Button
            onClick={handlePrev}
            disabled={currentStep === 0}
            variant="ghost"
            className="flex items-center gap-1 text-[11px]"
          >
            <ChevronLeft size={14} /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Button onClick={onClose} variant="ghost" className="text-[11px] text-inkfaint">
              Skip Tour
            </Button>
            <Button onClick={handleNext} variant="primary" className="flex items-center gap-1 text-[11px]">
              <span>{currentStep === TOUR_STEPS.length - 1 ? "Get Started" : "Next Stage"}</span>
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
