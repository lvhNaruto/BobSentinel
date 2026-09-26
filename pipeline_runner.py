import sys
import time
import traceback
from database import WarehouseDatabase
from agent import SchemaHealingAgent
from sandbox import SandboxExecutor
from data_producer import fetch_multi_topic_stream_batches, DEFAULT_DISCOVERY_TOPICS

def run_cli_pipeline(topics=None):
    if topics is None:
        topics = DEFAULT_DISCOVERY_TOPICS[:3]  # Multi-topic by default

    print("=" * 70)
    print("🚀 BobSentinel | Autonomous Self-Healing Guard (CLI)")
    print("🛡️ Powered by: IBM Bob / Granite")
    if len(topics) == 1:
        print(f"📡 Ingress Stream Source: {topics[0]}")
    else:
        print(f"📡 Ingress Stream: Round-Robin across {len(topics)} active partitions")
    print("=" * 70)

    db = WarehouseDatabase()
    agent = SchemaHealingAgent()

    print("\n📋 Target Warehouse Schema (tech_projects):")
    print(db.get_table_schema("tech_projects").strip())
    print("-" * 70)

    # Fetch 5 stream batches
    cursors = {}
    batches, updated_cursors, summary_desc = fetch_multi_topic_stream_batches(
        topics=topics,
        topic_cursors=cursors,
        batch_size=5
    )

    if not batches:
        print("⚠️ No stream batches available for selected topics.")
        return

    print(f"\n📥 Ingesting {len(batches)} Batches ({summary_desc})...\n")

    for idx, batch_event in enumerate(batches, 1):
        b_id = batch_event["batch_id"]
        recs = batch_event["records"]
        s_title = batch_event.get("short_title", "Batch")
        f_summary = batch_event.get("fix_summary", "")

        print(f"[{idx}/5] Ingesting {b_id} ({s_title})...")

        try:
            inserted, skipped = db.insert_batch(recs, batch_id=b_id, status="clean")
            print(f"    ✅ PASS: Conformed directly to schema. Inserted: {inserted} records.")
        except Exception:
            err_trace = traceback.format_exc()
            print(f"    🚨 DRIFT DETECTED: Upstream payload rejected by database!")
            sig = agent.compute_schema_signature(recs[0])
            cached = db.get_template(sig)
            failure_reason = ""
            transformed_batch = []
            failed_records = []

            try:
                if cached:
                    clean_patch = cached["patch_code"]
                    print(f"    💾 Cache hit for IBM Bob-verified signature `{sig}`.")
                else:
                    print(f"    🧠 Cache miss for signature `{sig}` — requesting live IBM Bob patch.")
                    raw_patch = agent.synthesize_transformation_patch(
                        failing_records=recs,
                        target_schema=db.get_table_schema("tech_projects"),
                        error_trace=err_trace
                    )
                    clean_patch = agent.extract_pure_code(raw_patch)

                compiled, func, compile_msg = SandboxExecutor.compile_patch(clean_patch)
                if not compiled:
                    raise RuntimeError(f"IBM Bob patch failed AST validation: {compile_msg}")

                for record in recs:
                    detected_keys = ", ".join(str(key) for key in record.keys())
                    try:
                        healed = func(record)
                        if not isinstance(healed, dict):
                            raise ValueError("Transformation did not return a record object.")
                        healed["batch_id"] = b_id
                        healed["ingestion_status"] = "auto_healed"
                        if (
                            not healed.get("title")
                            or not healed.get("author")
                            or not healed.get("source_url")
                            or healed.get("relevance_score") is None
                            or not 0 <= int(healed["relevance_score"]) <= 100
                        ):
                            raise ValueError("Transformation output violates the warehouse contract.")
                        transformed_batch.append(healed)
                    except Exception as transform_err:
                        failed_records.append((
                            record,
                            f"IBM Bob transformation failed ({type(transform_err).__name__}): {transform_err}",
                            detected_keys,
                        ))

                if transformed_batch:
                    inserted, skipped = db.insert_batch(
                        transformed_batch, batch_id=b_id, status="auto_healed"
                    )
                    if not cached:
                        db.save_template(sig, clean_patch, recs[0], provider="ibm_bob")
                    print(f"    🎉 HEALED: {'Applied cached' if cached else 'Synthesized'} IBM Bob AST patch.")
                    print(f"    ✨ Inserted: {inserted}; duplicate URLs skipped: {skipped} ({f_summary})")
            except Exception as healing_err:
                failure_reason = str(healing_err) or f"IBM Bob healing failed ({type(healing_err).__name__})."
                print(f"    ❌ {failure_reason}")
                failed_records = [
                    (record, failure_reason, ", ".join(str(key) for key in record.keys()))
                    for record in recs
                ]

            for record, reason, detected_keys in failed_records:
                db.insert_dlq(record, reason, b_id, detected_keys=detected_keys)
            if failed_records:
                print(f"    ⚠️ Routed {len(failed_records)} record(s) to DLQ.")

        time.sleep(0.3)

    print("\n" + "=" * 70)
    all_rows = db.get_all_rows()
    dlq_rows = db.get_dlq_rows()
    print(f"📊 Pipeline Execution Summary: {len(all_rows)} warehouse records; {len(dlq_rows)} quarantined in DLQ.")
    print("=" * 70)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        user_topics = [sys.argv[1]]
    else:
        user_topics = DEFAULT_DISCOVERY_TOPICS[:3]
    run_cli_pipeline(user_topics)