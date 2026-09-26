"""
Pipeline Service — extracted from the former Streamlit presentation layer (app.py).
All domain behavior preserved: ingress -> drift detection -> IBM Bob synthesis ->
AST sandbox -> warehouse commit / DLQ quarantine. No backend logic was reinvented;
this module orchestrates the same existing modules (database, agent, sandbox, data_producer).
"""
import threading
import time
import traceback
import math
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple

from database import WarehouseDatabase
from agent import SchemaHealingAgent
from sandbox import SandboxExecutor
from data_producer import fetch_multi_topic_stream_batches, DEFAULT_DISCOVERY_TOPICS
from score_contract import (
    get_valid_score_keys,
    get_raw_metric_score_keys,
    get_normalized_valid_score_keys,
    get_normalized_raw_metric_score_keys,
    normalize_score_key,
)


def get_now():
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


# ----------------- DYNAMIC ENTROPY GUARD (verbatim from app.py) -----------------
def calculate_shannon_entropy(text: str) -> float:
    if not text:
        return 0.0
    freq = {}
    for c in text:
        freq[c] = freq.get(c, 0) + 1
    entropy = 0.0
    length = len(text)
    for count in freq.values():
        p = count / length
        entropy -= p * math.log2(p)
    return entropy


def is_meaningful_query(q: str) -> Tuple[bool, str]:
    s = q.strip().lower()
    if len(s) < 2:
        return False, "Query is too short."
    if any(c in s for c in ";<>{}[~`^|\\=+*$%"):
        return False, "Query contains invalid keyboard mash symbols."
    h = calculate_shannon_entropy(s)
    if len(s) >= 6 and h < 1.8:
        return False, f"Query exhibits repetitive character mash (Entropy {h:.2f})."
    return True, "Valid"


class SentinelService:
    """Thread-safe singleton that holds the state which previously lived in
    Streamlit session_state, plus the extracted pipeline orchestration."""

    MAX_EVENTS = 500

    def __init__(self):
        self.lock = threading.RLock()
        self.db = WarehouseDatabase()
        self.agent = SchemaHealingAgent()
        self.last_transform_failures: List[Dict[str, Any]] = []
        self.healing_history: List[Dict[str, Any]] = []
        self.healed_urls: set = set()
        self.last_patch: Optional[str] = None
        self.last_latency_ms: Optional[int] = None
        self.last_ast_ok: Optional[bool] = None
        self.last_ast_msg: Optional[str] = None
        self.run_count = 0
        self.topic_cursor: Dict[str, int] = {}
        self.total_ingress_attempted = 0
        self.dropped_records_count = 0
        self.sandbox_compiles_count = 0
        self.events: List[Dict[str, Any]] = []  # ascending, id-ordered, ring-capped
        self.pipeline_stage: Optional[str] = None
        self.dlq_active = False
        self.running = False
        self.fingerprints: Dict[str, Dict[str, Any]] = {}
        self._event_id = 0

    # ----------------- telemetry event bus -----------------
    def _emit(self, tag: str, message: str) -> Dict[str, Any]:
        with self.lock:
            self._event_id += 1
            ev = {
                "id": self._event_id,
                "ts": get_now(),
                "tag": tag,
                "message": message,
                "stage": self.pipeline_stage,
                "dlq_active": self.dlq_active,
            }
            self.events.append(ev)
            if len(self.events) > self.MAX_EVENTS:
                del self.events[:-self.MAX_EVENTS]
        return ev

    def events_since(self, last_id: int) -> List[Dict[str, Any]]:
        with self.lock:
            return [e for e in self.events if e["id"] > last_id]

    def telemetry(self, limit: int = 60) -> List[Dict[str, Any]]:
        with self.lock:
            return list(reversed(self.events[-limit:]))

    def _set_stage(self, stage: Optional[str], dlq: bool = False):
        with self.lock:
            self.pipeline_stage = stage
            self.dlq_active = dlq

    # ----------------- fingerprint registry (tracking only) -----------------
    def _register_fingerprint(self, record: Dict[str, Any], label: str = "") -> str:
        sig = self.agent.compute_schema_signature(record)
        with self.lock:
            entry = self.fingerprints.get(sig)
            if entry is None:
                self.fingerprints[sig] = {
                    "signature": sig,
                    "label": label or sig,
                    "first_seen": get_now(),
                    "last_seen": get_now(),
                    "occurrences": 1,
                }
            else:
                entry["occurrences"] += 1
                entry["last_seen"] = get_now()
        return sig

    # ----------------- reset -----------------
    def reset(self, clear_warehouse: bool = True, clear_templates: bool = False) -> Dict[str, Any]:
        with self.lock:
            if self.running:
                return {"ok": False, "error": "Pipeline is running"}
            if clear_warehouse:
                self.db.clear_all(clear_templates=clear_templates)
            self.db = WarehouseDatabase()
            self.healing_history = []
            self.healed_urls = set()
            self.last_patch = None
            self.last_latency_ms = None
            self.last_ast_ok = None
            self.last_ast_msg = None
            self.last_transform_failures = []
            self.topic_cursor = {}
            self.total_ingress_attempted = 0
            self.dropped_records_count = 0
            self.sandbox_compiles_count = 0
            self.pipeline_stage = None
            self.dlq_active = False
            self.fingerprints = {}
            # telemetry kept as an append-only log; emit the reset marker
        msg = "Warehouse, DLQ & topic cursors reset."
        if clear_templates:
            msg += " Learned templates cache purged."
        msg += " Engine re-armed for ingestion." if clear_warehouse else " Session state reset. Warehouse rows preserved."
        self._emit("SYSTEM", msg)
        return {"ok": True}

    # ----------------- healing dispatcher (verbatim control flow from app.py) -----------------
    def execute_healing(self, records: List[Dict[str, Any]], batch_id: str,
                        target_schema: str, err_trace: str) -> Tuple[bool, str, List[Dict[str, Any]]]:
        t_start = time.time()
        self.last_transform_failures = []
        sig = self.agent.compute_schema_signature(records[0])

        cached = self.db.get_template(sig)
        if cached:
            clean_patch = cached["patch_code"]
            source = "cache"
            self._emit("IBM_BOB", f"Cache hit for signature `{sig}` — reusing an IBM Bob-verified patch.")
            with self.lock:
                self.last_patch = clean_patch
        else:
            self._emit("IBM_BOB", f"Requesting live IBM Bob patch for signature `{sig}`.")
            raw_patch = self.agent.synthesize_transformation_patch(
                failing_records=records,
                target_schema=target_schema,
                error_trace=err_trace,
            )
            clean_patch = self.agent.extract_pure_code(raw_patch)
            source = "ibm_bob"
            self._emit("IBM_BOB", f"Live IBM Bob response received for signature `{sig}`.")
            with self.lock:
                self.last_patch = clean_patch

        compiled, func, msg = SandboxExecutor.compile_patch(clean_patch)

        # Self-healing cache fallback: if cached patch fails compilation, evict and synthesize live
        if not compiled and source == "cache":
            self._emit("IBM_BOB", f"Cached patch for `{sig}` failed AST validation ({msg}). Evicting stale template and requesting fresh LLM synthesis.")
            self.db.delete_template(sig)
            raw_patch = self.agent.synthesize_transformation_patch(
                failing_records=records,
                target_schema=target_schema,
                error_trace=err_trace,
            )
            clean_patch = self.agent.extract_pure_code(raw_patch)
            source = "ibm_bob"
            with self.lock:
                self.last_patch = clean_patch
            compiled, func, msg = SandboxExecutor.compile_patch(clean_patch)

        latency_ms = max(45, int((time.time() - t_start) * 1000))
        with self.lock:
            self.last_latency_ms = latency_ms
            self.last_ast_ok = bool(compiled)
            self.last_ast_msg = msg
            if compiled:
                self.sandbox_compiles_count += 1

        if not compiled:
            with self.lock:
                self.last_ast_msg = msg
            return False, msg, []

        transformed = self._apply_transform(func, records, batch_id)

        # Self-healing cache fallback: if cached patch failed to transform conforming records, evict and synthesize live
        if not transformed and source == "cache":
            self._emit("IBM_BOB", f"Cached patch for `{sig}` produced no conforming records. Evicting stale template and requesting fresh LLM synthesis.")
            self.db.delete_template(sig)
            raw_patch = self.agent.synthesize_transformation_patch(
                failing_records=records,
                target_schema=target_schema,
                error_trace=err_trace,
            )
            clean_patch = self.agent.extract_pure_code(raw_patch)
            source = "ibm_bob"
            with self.lock:
                self.last_patch = clean_patch
            compiled, func, msg = SandboxExecutor.compile_patch(clean_patch)
            if compiled:
                transformed = self._apply_transform(func, records, batch_id)

        if transformed:
            if source == "ibm_bob":
                self.db.save_template(sig, clean_patch, records[0], provider="ibm_bob")
            elif source == "cache":
                self.db.increment_template_usage(sig)

        if not transformed:
            msg = "Transformation produced no conforming records after IBM Bob patch execution."
            with self.lock:
                self.last_ast_msg = msg
            return False, msg, []
        return True, clean_patch, transformed

    def _apply_transform(self, func: Callable[[Dict[str, Any]], Dict[str, Any]],
                         records: List[Dict[str, Any]], batch_id: str) -> List[Dict[str, Any]]:
        """Execute a compiled transformation function against a batch of drifted records."""
        quarantine_signal = "IRRECOVERABLE_SCHEMA_DRIFT"
        transformed = []
        self.last_transform_failures = []
        for r in records:
            try:
                healed = func(r) if func else None
            except ValueError as ve:
                reason = str(ve)
                if quarantine_signal not in reason:
                    reason = f"IBM Bob transformation raised ValueError: {reason}"
                self.last_transform_failures.append({"record": r, "reason": reason})
                continue
            except Exception as ex:
                self.last_transform_failures.append({
                    "record": r,
                    "reason": f"IBM Bob transformation raised {type(ex).__name__}: {ex}",
                })
                continue

            if not isinstance(healed, dict):
                self.last_transform_failures.append({
                    "record": r,
                    "reason": "IBM Bob transformation did not return an object.",
                })
                continue
            record_final = healed
            self._normalize_relevance_score(record_final, r)
            if not self._is_conformed_record(record_final):
                self.last_transform_failures.append({
                    "record": r,
                    "reason": "IBM Bob transformation output violates the warehouse contract.",
                })
                continue
            record_final["batch_id"] = batch_id
            record_final["ingestion_status"] = "auto_healed"
            self._attach_extra_metadata(record_final, r)
            transformed.append(record_final)

        if self.last_transform_failures:
            with self.lock:
                self.last_ast_msg = self.last_transform_failures[0]["reason"]
        return transformed

    def _is_conformed_record(self, r: Dict[str, Any]) -> bool:
        """Verify the transformed record satisfies the warehouse NOT-NULL contract."""
        try:
            return bool(
                r.get("title") and str(r["title"]).strip()
                and r.get("author") and str(r["author"]).strip()
                and r.get("source_url") and str(r["source_url"]).strip()
                and r.get("relevance_score") is not None
                and 0 <= int(r["relevance_score"]) <= 100
            )
        except Exception:
            return False

    def _normalize_relevance_score(self, record: Dict[str, Any], original: Dict[str, Any]) -> None:
        """Enforce the score-source contract even if the synthesized patch ignores it.
        Only values from explicit score keys or from raw_metrics sub-keys may drive
        relevance_score. Raw star/fork/watcher counts and free-text words force a
        default of 0 and the raw value is preserved in extra_metadata.
        Normalizes keys to lowercase and stripped underscores so any casing
        (confidenceScore, ConfidenceScore, confidence_score, CONFIDENCE_SCORE) is accepted.
        """
        import json
        import re

        norm_valid = get_normalized_valid_score_keys()
        norm_raw = get_normalized_raw_metric_score_keys()

        def _norm_k(k: Any) -> str:
            return re.sub(r"[^a-z0-9]", "", str(k).lower())

        matched_key = None
        for k in original.keys():
            if _norm_k(k) in norm_valid:
                matched_key = k
                break

        matched_raw_key = None
        raw_metrics = original.get("raw_metrics")
        if not matched_key and isinstance(raw_metrics, dict):
            for k in raw_metrics.keys():
                if _norm_k(k) in norm_raw:
                    matched_raw_key = k
                    break

        has_valid_source = bool(matched_key or matched_raw_key)

        if not has_valid_source:
            current = record.get("relevance_score")
            if current not in (0, 0.0, None):
                extra = {}
                existing = record.get("extra_metadata")
                if isinstance(existing, str) and existing:
                    try:
                        extra = json.loads(existing) or {}
                    except Exception:
                        pass
                extra["agent_rejected_relevance_score"] = current
                record["extra_metadata"] = json.dumps(extra)
            record["relevance_score"] = 0
        else:
            # 1. Check if the patch already produced a valid non-zero score
            current = record.get("relevance_score")
            score_num = None
            if current not in (None, "", 0, 0.0):
                try:
                    score_num = max(0, min(100, int(round(float(current)))))
                except (TypeError, ValueError):
                    score_num = None

            # 2. If the patch returned 0, None, or omitted relevance_score (e.g. cached patch from old rules),
            # extract and parse the score directly from the valid source key in original
            if score_num is None or score_num == 0:
                raw_val = None
                raw_metric_type = None
                if matched_key:
                    raw_val = original.get(matched_key)
                elif matched_raw_key and isinstance(raw_metrics, dict):
                    raw_val = raw_metrics.get(matched_raw_key)
                    raw_metric_type = _norm_k(matched_raw_key)

                if raw_val is not None:
                    try:
                        if isinstance(raw_val, (int, float)):
                            num = float(raw_val)
                            if raw_metric_type == "ratingoutof5":
                                score_num = max(0, min(100, int(round(num * 20))))
                            elif raw_metric_type == "ratingoutof10":
                                score_num = max(0, min(100, int(round(num * 10))))
                            elif raw_metric_type == "ratingoutof100":
                                score_num = max(0, min(100, int(round(num))))
                            elif 0 <= num <= 1 and num > 0:
                                score_num = max(0, min(100, int(round(num * 100))))
                            else:
                                score_num = max(0, min(100, int(round(num))))
                        elif isinstance(raw_val, str):
                            s = raw_val.strip()
                            if s.endswith("%"):
                                score_num = max(0, min(100, int(round(float(s[:-1].strip())))))
                            else:
                                num = float(s)
                                if 0 <= num <= 1 and num > 0:
                                    score_num = max(0, min(100, int(round(num * 100))))
                                else:
                                    score_num = max(0, min(100, int(round(num))))
                    except (ValueError, TypeError):
                        pass

            record["relevance_score"] = score_num if score_num is not None else 0

            # If the patch dumped the valid score key into extra_metadata or agent_rejected_relevance_score, clean it up
            existing_extra = record.get("extra_metadata")
            if isinstance(existing_extra, str) and existing_extra:
                try:
                    extra_obj = json.loads(existing_extra) or {}
                    changed = False
                    if "agent_rejected_relevance_score" in extra_obj:
                        del extra_obj["agent_rejected_relevance_score"]
                        changed = True
                    if matched_key and matched_key in extra_obj and record["relevance_score"] > 0:
                        del extra_obj[matched_key]
                        changed = True
                    if changed:
                        record["extra_metadata"] = json.dumps(extra_obj)
                except Exception:
                    pass

    # ----------------- autonomous stream run -----------------

    def _wrapper_values_consumed(self, wrapper: Any, record: Dict[str, Any]) -> bool:
        """Return True if every value inside a wrapper dict is already represented
        by a core field in the conformed record. This lets us drop flattened
        wrappers such as `metadata` instead of duplicating them in extra_metadata."""
        if not isinstance(wrapper, dict):
            return False
        core_values: set = set()
        for key in ("title", "author"):
            v = record.get(key)
            if v is not None:
                core_values.add(str(v))
        source_url = record.get("source_url")
        if source_url is not None:
            core_values.add(str(source_url).split("?", 1)[0])
        relevance = record.get("relevance_score")
        if relevance is not None:
            core_values.add(str(relevance))
        for v in wrapper.values():
            candidate = str(v).split("?", 1)[0] if isinstance(v, str) else str(v)
            if candidate not in core_values:
                return False
        return True

    def _attach_extra_metadata(self, record: Dict[str, Any], original: Dict[str, Any]) -> None:
        """Preserve every unmapped key from the original payload in extra_metadata.
        Also snapshot any unparseable core-field value (e.g. 'ten %') so nothing is lost.
        Fully-consumed wrapper objects (e.g. `metadata` whose nested fields were all
        mapped to core fields) are dropped to avoid redundant side-car data."""
        import json
        import re
        core = {"title", "author", "source_url", "relevance_score"}
        meta = {"project_id", "batch_id", "ingestion_status", "created_at", "extra_metadata"}
        unmapped = {k: v for k, v in original.items() if k not in core and k not in meta}

        # Drop wrapper objects whose contents are already represented by core fields.
        for k in list(unmapped.keys()):
            if self._wrapper_values_consumed(unmapped[k], record):
                del unmapped[k]

        # Snapshot the original score if it could not be parsed into a number (e.g. 'ten %', 'high')
        norm_valid = get_normalized_valid_score_keys()
        for k in list(unmapped.keys()):
            if re.sub(r"[^a-z0-9]", "", str(k).lower()) in norm_valid:
                v = unmapped[k]
                if isinstance(v, str):
                    s = v.strip()
                    parsed = None
                    if s.endswith("%"):
                        try:
                            parsed = float(s[:-1])
                        except ValueError:
                            pass
                    else:
                        try:
                            parsed = float(s)
                        except ValueError:
                            pass
                    if parsed is None:
                        unmapped["original_relevance_score"] = v
                # If this score key was successfully parsed into relevance_score, remove from unmapped
                if record.get("relevance_score", 0) > 0:
                    del unmapped[k]

        if not unmapped:
            return
        existing = {}
        extra = record.get("extra_metadata")
        if isinstance(extra, str) and extra:
            try:
                existing = json.loads(extra) if json.loads(extra) else {}
            except Exception:
                pass
        existing.update(unmapped)
        record["extra_metadata"] = json.dumps(existing)

    def _quarantine_failed_records(
        self,
        records: List[Dict[str, Any]],
        batch_id: str,
        default_reason: str,
    ) -> int:
        failures = self.last_transform_failures
        failed_records = (
            [(failure["record"], failure["reason"]) for failure in failures]
            if failures
            else [(record, default_reason) for record in records]
        )
        for record, reason in failed_records:
            detected_keys = ", ".join(str(key) for key in record.keys())
            self.db.insert_dlq(record, reason, batch_id, detected_keys=detected_keys)
        return len(failed_records)

    def run_pipeline(self, topics: List[str]) -> Tuple[bool, str]:
        with self.lock:
            if self.running:
                return False, "Pipeline already running"
            self.running = True
            self.run_count += 1
        t = threading.Thread(target=self._run_stream, args=(list(topics),), daemon=True)
        t.start()
        return True, "started"

    def _run_stream(self, topics: List[str]):
        try:
            self._set_stage("ingress")
            self._emit("INGRESS", f"Resolving stream grounding across {len(topics)} partition(s)...")
            fresh_batches, updated_cursors, stream_desc = fetch_multi_topic_stream_batches(
                topics=topics, topic_cursors=self.topic_cursor, batch_size=5
            )
            with self.lock:
                self.topic_cursor = updated_cursors

            if not fresh_batches:
                self._emit("STREAM_IDLE", f"0 records found for '{topics[0]}'. Warehouse untouched.")
                self._set_stage(None)
                return

            self._emit("INGRESS", f"Ingesting {len(fresh_batches)} batches from: {stream_desc}")
            target_schema = self.db.get_table_schema("tech_projects")

            for idx, batch_event in enumerate(fresh_batches):
                b_id = batch_event["batch_id"]
                recs = batch_event["records"]
                s_title = batch_event.get("short_title", "Batch")
                with self.lock:
                    self.total_ingress_attempted += len(recs)

                self._set_stage("fingerprint")
                sig = self._register_fingerprint(recs[0], s_title)
                self._emit("INGRESS", f"Batch {idx+1}/{len(fresh_batches)} `{b_id}` ingesting ({s_title})")

                self._set_stage("drift")
                try:
                    inserted, _ = self.db.insert_batch(recs, batch_id=b_id, status="clean")
                    self._set_stage("warehouse")
                    self._emit("COMMITTED", f"Conformed {b_id} ({inserted} records) — 100% contract match")
                except Exception:
                    err_trace = traceback.format_exc()
                    self._emit("DRIFT_DETECTED", f"Drift in {b_id}! Requesting IBM Bob patch...")
                    self._set_stage("agent")

                    ok, clean_patch, transformed = False, "", []
                    try:
                        ok, clean_patch, transformed = self.execute_healing(recs, b_id, target_schema, err_trace)
                    except Exception as synth_err:
                        clean_patch = f"IBM Bob synthesis failure: {synth_err}"
                        with self.lock:
                            self.last_ast_ok = False
                            self.last_ast_msg = clean_patch
                        self._emit("IBM_BOB", clean_patch)

                    self._set_stage("ast")
                    if ok and transformed:
                        self._emit("AST_VERIFIED", "Patch compiled safely in isolated namespace.")
                        self._set_stage("warehouse")
                        inserted, _ = self.db.insert_batch(transformed, batch_id=b_id, status="auto_healed")
                        url_key = transformed[0].get("source_url", b_id)
                        with self.lock:
                            if url_key not in self.healed_urls:
                                self.healed_urls.add(url_key)
                                self.healing_history.insert(0, {
                                    "batch_id": b_id, "before": recs[0], "after": transformed[0],
                                    "error": err_trace, "patch": clean_patch, "signature": sig,
                                    "latency_ms": self.last_latency_ms, "ast_verified": True, "ts": get_now(),
                                })
                            latency = self.last_latency_ms
                        self._emit("COMMITTED", f"Auto-Healed {b_id} in {latency/1000:.1f}s — validated & committed")
                        if self.last_transform_failures:
                            quarantined = self._quarantine_failed_records(
                                recs,
                                b_id,
                                "IBM Bob transformation failed.",
                            )
                            self._emit("DLQ_QUARANTINED", f"{quarantined} record(s) failed Bob transformation validation and were quarantined.")
                    else:
                        self._set_stage("drift", dlq=True)
                        failure_reason = (
                            clean_patch
                            if clean_patch.startswith("IBM Bob synthesis failure:")
                            else self.last_ast_msg or "IBM Bob patch failed AST or warehouse-contract validation."
                        )
                        quarantined = self._quarantine_failed_records(recs, b_id, failure_reason)
                        self._emit("DLQ_QUARANTINED", f"{quarantined} record(s) from {b_id} quarantined — {failure_reason}")

                time.sleep(0.3)

            self._set_stage("warehouse")
            self._emit("SYSTEM", "Stream run finished. Conformed & quarantined with 0% warehouse pollution.")
        except Exception as ex:
            self._emit("SYSTEM", f"Pipeline error: {ex}")
        finally:
            with self.lock:
                self.running = False

    # ----------------- judge playground (verbatim control flow from app.py) -----------------
    def test_payload(self, payload: Any) -> Dict[str, Any]:
        if isinstance(payload, dict):
            parsed = [payload]
        elif isinstance(payload, list):
            parsed = list(payload)
        else:
            return {"status": "invalid", "reason": "Payload must be a JSON object or array."}

        with self.lock:
            self.total_ingress_attempted += len(parsed)

        before = parsed[0]
        sig = self._register_fingerprint(before, "judge_playground")

        try:
            self.db.insert_batch(parsed)
            self._emit("COMMITTED", "Playground payload conformed natively to the warehouse contract.")
            return {"status": "clean", "before": before, "after": before,
                    "signature": sig, "reason": "Record already conforms to schema."}
        except Exception:
            err_trace = traceback.format_exc()
            self._emit("DRIFT_DETECTED", "Judge playground drift detected! Requesting IBM Bob patch...")

            ok, patch, transformed = False, "", []
            try:
                ok, patch, transformed = self.execute_healing(
                    parsed, "judge_custom_drift", self.db.get_table_schema("tech_projects"), err_trace
                )
            except Exception as synth_err:
                patch = f"IBM Bob synthesis failure: {synth_err}"
                self._emit("IBM_BOB", patch)

            if ok and transformed:
                transformed[0]["source_url"] = f"{transformed[0].get('source_url', 'https://github.com')}?eval={int(time.time()*1000)}"
                inserted, _ = self.db.insert_batch(transformed, batch_id="judge_custom_drift", status="auto_healed")
                with self.lock:
                    self.healing_history.insert(0, {
                        "batch_id": "judge_custom_drift", "before": before, "after": transformed[0],
                        "error": err_trace, "patch": patch, "signature": sig,
                        "latency_ms": self.last_latency_ms, "ast_verified": True, "ts": get_now(),
                    })
                    latency = self.last_latency_ms
                self._emit("AST_VERIFIED", "Playground patch compiled safely in isolated namespace.")
                self._emit("COMMITTED", f"Playground payload healed in {latency/1000:.1f}s via IBM Bob & AST Sandbox.")
                if self.last_transform_failures:
                    self._quarantine_failed_records(
                        parsed,
                        "judge_custom_drift",
                        "IBM Bob transformation failed.",
                    )
                return {"status": "healed", "before": before, "after": transformed[0],
                        "patch": patch, "signature": sig, "latency_ms": latency,
                        "ast_verified": True, "reason": "Healed and committed as auto_healed."}
            else:
                failure_reason = patch or self.last_ast_msg or "IBM Bob patch failed validation."
                quarantined = self._quarantine_failed_records(
                    parsed,
                    "judge_custom_drift",
                    failure_reason,
                )
                self._emit("DLQ_QUARANTINED", f"{quarantined} playground record(s) quarantined — {failure_reason}")
                return {"status": "quarantined", "before": before, "reason": patch,
                        "signature": sig, "ast_verified": False}

    # ----------------- state snapshot (same metric formulas as app.py) -----------------
    def ast_checks(self) -> List[Dict[str, str]]:
        banned_mods = ", ".join(sorted(SandboxExecutor.BANNED_MODULES))
        banned_calls = ", ".join(sorted({"eval", "exec", "__import__", "compile", "open"}))
        return [
            {"name": "Banned module imports", "detail": f"Blocks: {banned_mods}"},
            {"name": "Dynamic execution", "detail": f"Blocks {banned_calls}() calls"},
            {"name": "Isolated namespace", "detail": "Compiled via exec in empty local scope"},
            {"name": "Callable discovery", "detail": "Detects transform_record or any user-defined function"},
            {"name": "Syntax safety", "detail": "Full ast.parse static analysis before compile"},
        ]

    def get_state(self) -> Dict[str, Any]:
        rows = self.db.get_all_rows()
        dlq = self.db.get_dlq_rows()

        total_records = len(rows)
        dlq_count = len(dlq)
        clean_count = sum(1 for r in rows if r.get("ingestion_status") == "clean")
        healed_count = sum(1 for r in rows if r.get("ingestion_status") == "auto_healed")

        total_attempted = self.total_ingress_attempted
        dropped = self.dropped_records_count + dlq_count
        if total_attempted > 0:
            sla_percentage = round(((total_attempted - dropped) / total_attempted) * 100, 1)
        else:
            sla_percentage = 100.0

        with self.lock:
            healing = dict(self.healing_history[0]) if self.healing_history else None
            patch_code = self.last_patch
            ast_verified = self.last_ast_ok
            ast_msg = self.last_ast_msg
            latency = self.last_latency_ms

        ast_state = "verified" if ast_verified is True else ("rejected" if ast_verified is False else "standby")
        return {
            "running": self.running,
            "stage": self.pipeline_stage,
            "dlq_active": self.dlq_active,
            "run_count": self.run_count,
            "metrics": {
                "total_records": total_records,
                "clean_count": clean_count,
                "healed_count": healed_count,
                "dlq_count": dlq_count,
                "sla_percentage": sla_percentage,
                "total_attempted": total_attempted,
                "dropped": dropped,
                "last_latency_ms": latency,
                "sandbox_compiles": self.sandbox_compiles_count,
            },
            "warehouse": rows,
            "dlq": dlq,
            "telemetry": self.telemetry(),
            "healing": healing,
            "patch": {
                "code": patch_code,
                "signature": (healing or {}).get("signature"),
                "latency_ms": latency,
                "verified": ast_verified is True,
            } if patch_code else None,
            "ast": {
                "state": ast_state,
                "verified": ast_verified,
                "message": ast_msg or "Awaiting synthesized patch.",
                "checks": self.ast_checks(),
                "compiles": self.sandbox_compiles_count,
            },
            "cache": {
                "note": "Learned transformation templates keyed by schema signature. Cache hits skip LLM synthesis.",
                "signatures": [
                    {
                        "signature": t["signature"],
                        "label": ", ".join(sorted(t.get("sample_record", {}).keys())) or "template",
                        "first_seen": t["first_seen"],
                        "last_seen": t["last_seen"],
                        "occurrences": t["occurrences"],
                    }
                    for t in self.db.get_all_templates()
                ],
            },
        }


service = SentinelService()
