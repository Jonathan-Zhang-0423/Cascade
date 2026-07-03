// scripts/db/schema-diff.mjs
//
// 比较两份内省快照（来自 introspect.mjs 的 JSON），输出结构差异列表。
// 用于「本地 DB 是否与服务器严格对齐」的判定。纯逻辑、无 IO，便于单测。
//
//   compareSnapshots(local, baseline) → { diffs: Diff[], aligned: boolean }
//
// Diff 形如 { kind, table, column?, detail }：
//   table_missing / table_extra / column_missing / column_extra / column_mismatch
//   index_missing / index_extra / index_mismatch
//   constraint_missing / constraint_extra / constraint_mismatch
//   enum_missing / enum_extra / enum_mismatch / sequence_missing / sequence_extra / extension_diff

function sortedKeys(obj) {
  return Object.keys(obj).sort();
}

function diffIndexes(localTbl, baseTbl) {
  const out = [];
  const li = new Map((localTbl || []).map((i) => [i.name, i]));
  const bi = new Map((baseTbl || []).map((i) => [i.name, i]));
  for (const name of new Set([...li.keys(), ...bi.keys()].sort())) {
    const l = li.get(name);
    const b = bi.get(name);
    if (!b) out.push({ kind: "index_extra", index: name, detail: "本地多出的索引" });
    else if (!l) out.push({ kind: "index_missing", index: name, detail: "本地缺失的索引" });
    else if (l.unique !== b.unique || l.primary !== b.primary ||
             JSON.stringify(l.columns) !== JSON.stringify(b.columns) ||
             (l.predicate || null) !== (b.predicate || null)) {
      out.push({
        kind: "index_mismatch", index: name,
        detail: `基准=${JSON.stringify({ unique: b.unique, primary: b.primary, columns: b.columns, predicate: b.predicate })} ` +
                `本地=${JSON.stringify({ unique: l.unique, primary: l.primary, columns: l.columns, predicate: l.predicate })}`,
      });
    }
  }
  return out;
}

function diffConstraints(localTbl, baseTbl) {
  const out = [];
  const lc = new Map((localTbl || []).map((c) => [c.name, c]));
  const bc = new Map((baseTbl || []).map((c) => [c.name, c]));
  for (const name of new Set([...lc.keys(), ...bc.keys()].sort())) {
    const l = lc.get(name);
    const b = bc.get(name);
    if (!b) out.push({ kind: "constraint_extra", constraint: name, detail: "本地多出的约束" });
    else if (!l) out.push({ kind: "constraint_missing", constraint: name, detail: "本地缺失的约束" });
    else if (l.type !== b.type || (l.def || "") !== (b.def || "")) {
      out.push({
        kind: "constraint_mismatch", constraint: name,
        detail: `基准=${b.type}:${b.def} 本地=${l.type}:${l.def}`,
      });
    }
  }
  return out;
}

export function compareSnapshots(local, baseline) {
  const diffs = [];

  // 扩展
  const le = new Set(local.extensions);
  const be = new Set(baseline.extensions);
  for (const e of be) if (!le.has(e)) diffs.push({ kind: "extension_diff", extension: e, detail: "本地缺失扩展" });
  for (const e of le) if (!be.has(e)) diffs.push({ kind: "extension_diff", extension: e, detail: "本地多出扩展" });

  // 枚举
  for (const name of sortedKeys({ ...local.enums, ...baseline.enums })) {
    const l = local.enums[name];
    const b = baseline.enums[name];
    if (!b) diffs.push({ kind: "enum_extra", enum: name, detail: "本地多出枚举" });
    else if (!l) diffs.push({ kind: "enum_missing", enum: name, detail: "本地缺失枚举" });
    else if (JSON.stringify(l) !== JSON.stringify(b)) {
      diffs.push({ kind: "enum_mismatch", enum: name, detail: `基准=${JSON.stringify(b)} 本地=${JSON.stringify(l)}` });
    }
  }

  // 表 + 列
  const lTables = new Set(sortedKeys(local.tables));
  const bTables = new Set(sortedKeys(baseline.tables));
  for (const t of [...lTables].sort()) {
    if (!bTables.has(t)) {
      diffs.push({ kind: "table_extra", table: t, detail: "本地多出的表" });
      diffs.push(...diffIndexes(local.indexes[t] || [], []));
      diffs.push(...diffConstraints(local.constraints[t] || [], []));
    }
  }
  for (const t of [...bTables].sort()) {
    if (!lTables.has(t)) {
      diffs.push({ kind: "table_missing", table: t, detail: "本地缺失的表" });
      diffs.push(...diffIndexes([], baseline.indexes[t] || []));
      diffs.push(...diffConstraints([], baseline.constraints[t] || []));
      continue;
    }
    const lc = local.tables[t].columns;
    const bc = baseline.tables[t].columns;
    for (const col of sortedKeys({ ...lc, ...bc })) {
      const l = lc[col];
      const b = bc[col];
      if (!b) diffs.push({ kind: "column_extra", table: t, column: col, detail: "本地多出列" });
      else if (!l) diffs.push({ kind: "column_missing", table: t, column: col, detail: "本地缺失列" });
      else if (l.type !== b.type || l.nullable !== b.nullable || (l.default || null) !== (b.default || null)) {
        diffs.push({
          kind: "column_mismatch", table: t, column: col,
          detail: `基准=${JSON.stringify(b)} 本地=${JSON.stringify(l)}`,
        });
      }
    }
    diffs.push(...diffIndexes(local.indexes[t] || [], baseline.indexes[t] || []));
    diffs.push(...diffConstraints(local.constraints[t] || [], baseline.constraints[t] || []));
  }

  // 序列
  const lSeq = new Set(local.sequences);
  const bSeq = new Set(baseline.sequences);
  for (const s of bSeq) if (!lSeq.has(s)) diffs.push({ kind: "sequence_missing", sequence: s, detail: "本地缺失序列" });
  for (const s of lSeq) if (!bSeq.has(s)) diffs.push({ kind: "sequence_extra", sequence: s, detail: "本地多出序列" });

  return { diffs, aligned: diffs.length === 0 };
}

// 作为 CLI 直接跑：node scripts/db/schema-diff.mjs --baseline=path --local=url
// （local 通过 introspect.mjs 现场内省，baseline 从文件读）
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const pg = (await import("pg")).default;
  // 复用 introspect 的内省逻辑太重，这里直接 import 它跑一次不现实；
  // 独立 CLI 用得少，主要入口走 local-db-setup.mjs。
  const baselinePath = [...process.argv].find((a) => a.startsWith("--baseline="))?.slice(11);
  const { DATABASE_URL } = process.env;
  if (!baselinePath || !DATABASE_URL) {
    console.error("用法：DATABASE_URL=... node scripts/db/schema-diff.mjs --baseline=database/server-schema.json");
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const client = new pg.Client({ connectionString: DATABASE_URL });
  // 这里为保持独立可跑，内联最小内省：调用方应优先使用 local-db-setup.mjs。
  // 占位实现——读一张表名单。完整比对请走 local-db-setup.mjs。
  await client.connect();
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  const local = { tables: Object.fromEntries(rows.map((r) => [r.tablename, { columns: {} }])), indexes: {}, constraints: {}, enums: {}, sequences: [], extensions: [] };
  const { diffs, aligned } = compareSnapshots(local, baseline);
  console.log(aligned ? "✓ 对齐（表集合一致；完整字段比对请走 local-db-setup.mjs）" : `✗ ${diffs.length} 处差异`);
  for (const d of diffs) console.log("  -", JSON.stringify(d));
  await client.end();
  process.exit(aligned ? 0 : 1);
}
