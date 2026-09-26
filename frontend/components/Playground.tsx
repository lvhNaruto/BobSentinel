"use client";

import { useState, useEffect } from "react";
import { Zap, Loader2, Check, X, ChevronRight, ShieldAlert, Bug, Flame, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { prettyJson, formatLatency } from "@/lib/utils";
import { soundFx } from "@/lib/soundFx";
import type { TestResult } from "@/types";

export interface ChaosPreset {
  category: "drift" | "security" | "alien";
  name: string;
  badge: string;
  description: string;
  payload: Record<string, unknown>;
}

export const CHAOS_PRESETS: ChaosPreset[] = [
  // 1. Legitimate Drift
  {
    category: "drift",
    name: "CamelCase Mutation",
    badge: "Drift",
    description: "API updated keys to camelCase & nested confidence",
    payload: {
      projectTitle: "BobSentinel",
      OwnerId: "lvh_naruto",
      repositoryUrl: "https://github.com/lvh_naruto/BobSentinel",
      confidenceScore: 91,
    },
  },
  {
    category: "drift",
    name: "Score as % String",
    badge: "Drift",
    description: "Relevance score provided as '96%' string instead of integer",
    payload: {
      title: "BobSentinel",
      author: "lvh_naruto",
      source_url: "https://github.com/lvh_naruto/BobSentinel",
      relevance_score: "96%",
    },
  },
  {
    category: "drift",
    name: "Author In GitHub URL",
    badge: "Drift",
    description: "Missing author key, must parse owner from GitHub URL path",
    payload: {
      title: "BobSentinel",
      source_url: "https://github.com/lvh_naruto/BobSentinel",
      relevance_score: 95,
    },
  },
  {
    category: "drift",
    name: "CDC Debezium Envelope",
    badge: "Drift",
    description: "Kafka CDC change-data-capture envelope with sidecar metadata",
    payload: {
      op: "u",
      ts_ms: 1727342000000,
      after: {
        repo_name: "BobSentinel-Engine",
        maintainer: "lvh_naruto",
        html_url: "https://github.com/lvh_naruto/BobSentinel-Engine?ref=main",
        rating_out_of_5: 4.8,
        stars_count: 2450,
      },
    },
  },
  // 2. Security Attack Vectors (AST Sandbox Stress Test)
  {
    category: "security",
    name: "Remote Code Exec Attack",
    badge: "Hostile Attack",
    description: "Malicious payload injecting os.system call - AST sandbox will block",
    payload: {
      title: "BobSentinel",
      author: "attacker'; import os; os.system('echo PWNED') #",
      source_url: "https://github.com/lvh_naruto/BobSentinel",
      relevance_score: 99,
      exploit_code: "__import__('os').system('cat /etc/passwd')",
    },
  },
  {
    category: "security",
    name: "Socket Exfiltration Attack",
    badge: "Hostile Attack",
    description: "Malicious payload attempting network socket connection",
    payload: {
      title: "BobSentinel",
      author: "hacker",
      source_url: "https://github.com/lvh_naruto/BobSentinel",
      relevance_score: 90,
      payload_hook: "import socket; s=socket.socket(); s.connect(('127.0.0.1', 9999))",
    },
  },
  // 3. Alien / Corrupt Payloads
  {
    category: "alien",
    name: "IoT Sensor Noise",
    badge: "Alien",
    description: "Hardware telemetry lacking software project identity",
    payload: {
      sensor_id: "temp-42-rack7",
      reading_celsius: 23.4,
      unit: "°C",
      timestamp: "2026-09-26T11:00:00Z",
    },
  },
  {
    category: "alien",
    name: "User Login Event",
    badge: "Alien",
    description: "Auth session stream record without repo/author identity",
    payload: {
      event: "user_login",
      device: "mobile_ios",
      session: "abc123xyz",
      ip: "192.168.1.1",
    },
  },
];

function Step({ done, fail, label }: { done: boolean; fail?: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-[11.5px]">
      {fail ? (
        <X size={13} className="text-rosex shrink-0" />
      ) : done ? (
        <Check size={13} className="text-emeraldx shrink-0" />
      ) : (
        <ChevronRight size={13} className="text-inkfaint shrink-0" />
      )}
      <span className={done ? (fail ? "text-rosex" : "text-ink") : "text-inkfaint"}>{label}</span>
    </li>
  );
}

export function Playground({
  onDone,
  initialPayload,
}: {
  onDone: () => void;
  initialPayload?: string | null;
}) {
  const [payloadText, setPayloadText] = useState(prettyJson(CHAOS_PRESETS[0].payload));
  const [selectedCategory, setSelectedCategory] = useState<"all" | "drift" | "security" | "alien">("all");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPayload) {
      try {
        const parsed = JSON.parse(initialPayload);
        setPayloadText(prettyJson(parsed));
      } catch {
        setPayloadText(initialPayload);
      }
    }
  }, [initialPayload]);

  let payloadValid = false;
  try {
    const parsed = JSON.parse(payloadText);
    payloadValid = typeof parsed === "object" && parsed !== null;
  } catch {
    payloadValid = false;
  }

  const runTest = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    soundFx.playDriftWarning();
    try {
      const res = await api.testPayload(JSON.parse(payloadText));
      setResult(res);
      if (res.status === "healed") {
        soundFx.playHealedChime();
      } else if (res.status === "quarantined") {
        soundFx.playDlqQuarantine();
      } else {
        soundFx.playSandboxVerified();
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payload test failed");
      soundFx.playDlqQuarantine();
    } finally {
      setBusy(false);
    }
  };

  const filteredPresets = selectedCategory === "all"
    ? CHAOS_PRESETS
    : CHAOS_PRESETS.filter((p) => p.category === selectedCategory);

  const healed = result?.status === "healed";
  const quarantined = result?.status === "quarantined";
  const clean = result?.status === "clean";

  return (
    <section id="judge-playground" className="panel" aria-label="Judge Playground and Chaos Attack Lab">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge/60 pb-3">
        <div>
          <p className="panel-title mb-0">Judge Playground & Chaos Attack Lab</p>
          <p className="text-[11px] text-inkdim">
            Inject synthetic schema drift, corrupted events, or hostile code payloads to test AST security & self-healing.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-edge bg-panel2/60 p-1 font-mono text-[10px]">
          <button
            onClick={() => setSelectedCategory("all")}
            className={`rounded px-2 py-0.5 transition-colors ${selectedCategory === "all" ? "bg-violet-500/20 text-violet-300 font-bold" : "text-inkdim hover:text-white"}`}
          >
            All
          </button>
          <button
            onClick={() => setSelectedCategory("drift")}
            className={`rounded px-2 py-0.5 transition-colors ${selectedCategory === "drift" ? "bg-teal-500/20 text-teal-300 font-bold" : "text-inkdim hover:text-white"}`}
          >
            Drift
          </button>
          <button
            onClick={() => setSelectedCategory("security")}
            className={`rounded px-2 py-0.5 transition-colors ${selectedCategory === "security" ? "bg-rose-500/20 text-rose-300 font-bold" : "text-inkdim hover:text-white"}`}
          >
            Hostile
          </button>
          <button
            onClick={() => setSelectedCategory("alien")}
            className={`rounded px-2 py-0.5 transition-colors ${selectedCategory === "alien" ? "bg-amber-500/20 text-amber-300 font-bold" : "text-inkdim hover:text-white"}`}
          >
            Alien
          </button>
        </div>
      </div>

      <div className="mt-3 mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Chaos attack and drift presets">
        {filteredPresets.map((p) => {
          const isAttack = p.category === "security";
          const isAlien = p.category === "alien";
          return (
            <button
              key={p.name}
              onClick={() => {
                setPayloadText(prettyJson(p.payload));
                soundFx.playChime();
              }}
              title={p.description}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 font-mono text-[10.5px] font-semibold transition-all ${
                isAttack
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:border-rose-400 hover:bg-rose-500/20"
                  : isAlien
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:border-amber-400 hover:bg-amber-500/20"
                  : "border-edge bg-panel2/70 text-inkdim hover:border-violet-400/50 hover:text-violet-300"
              }`}
            >
              {isAttack && <Flame size={11} className="text-rose-400" />}
              {isAlien && <Bug size={11} className="text-amber-400" />}
              <span>{p.name}</span>
            </button>
          );
        })}
      </div>

      <label htmlFor="playground-payload" className="sr-only">
        Malformed ingress payload JSON
      </label>
      <textarea
        id="playground-payload"
        value={payloadText}
        onChange={(e) => setPayloadText(e.target.value)}
        rows={7}
        spellCheck={false}
        className="code-block w-full resize-y font-mono text-[11.5px]"
        aria-invalid={!payloadValid}
      />
      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px]">
        <p className={payloadValid ? "text-emeraldx" : "text-rosex"}>
          {payloadValid ? "● JSON GUARD: syntax valid — ready for agentic evaluation" : "✕ JSON syntax error — fix before testing"}
        </p>
        <span className="text-inkfaint">AST Sandbox active & armed</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={runTest} disabled={busy || !payloadValid} variant="primary" className="w-full sm:w-auto">
          {busy ? (
            <>
              <Loader2 size={14} className="animate-spin" /> IBM Bob / Granite evaluating…
            </>
          ) : (
            <>
              <Zap size={14} /> Run Autonomous Evaluation
            </>
          )}
        </Button>
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-lg border border-rosex/40 bg-rosex/10 p-3 font-mono text-[11px] text-rosex flex items-start gap-2">
          <ShieldAlert size={15} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-xl border border-edge bg-panel2/60 p-3.5" aria-live="polite">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {healed && <Badge tone="emerald">✓ HEALED & COMMITTED</Badge>}
            {clean && <Badge tone="cyan">CONFORMED NATIVELY</Badge>}
            {quarantined && <Badge tone="rose">⚠ QUARANTINED IN DLQ</Badge>}
            {result.latency_ms != null && <span className="chip">LATENCY: {formatLatency(result.latency_ms)}</span>}
            {result.signature && <span className="chip">SIGNATURE: {result.signature}</span>}
          </div>
          <ol className="space-y-1.5" aria-label="Healing verdict steps">
            <Step done label="Stage 1: Contract Validation & Schema Signature" />
            <Step
              done
              fail={quarantined}
              label={
                quarantined
                  ? "Stage 2: IBM Bob / Granite Triage — Non-repairable / Alien schema classified"
                  : "Stage 2: IBM Bob / Granite AST Patch Synthesized"
              }
            />
            <Step
              done={healed}
              fail={quarantined}
              label="Stage 3: AST Security Sandbox — Static parse & isolated compilation"
            />
            <Step
              done={healed || clean}
              fail={quarantined}
              label={quarantined ? "Stage 4: Quarantined in DLQ (Zero warehouse pollution)" : "Stage 4: Committed to Warehouse (tech_projects)"}
            />
          </ol>
          {result.reason && (
            <div className="mt-3 rounded-lg border border-edge bg-obsidian/70 p-2.5 font-mono text-[10.5px] text-inkfaint break-words">
              <span className="text-white font-semibold">Triage Reason: </span>
              {result.reason.split("\n")[0]}
            </div>
          )}
          {result.patch && (
            <details className="mt-2.5">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-violet-300 hover:text-violet-200">
                View synthesized patch & AST bytecode
              </summary>
              <pre className="code-block mt-1.5 max-h-48 overflow-y-auto">{result.patch}</pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
