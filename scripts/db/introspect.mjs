// scripts/db/introspect.mjs
//
// 把一个 PostgreSQL 数据库的结构内省成规范化的 JSON 快照。
// 只读 + 版本无关：全部走 information_schema / pg_catalog，不依赖 pg_dump，
// 因此服务器和本地的 PG 版本不同也不会产生假差异。
//
// 用途：
//   1. 在服务器上跑一次，产出 database/server-schema.json 作为对齐基准；
//   2. 在本地跑，输出可与基准比对的同结构 JSON（供 local-db-setup.mjs 调用）。
//
// 运行：
//   node --env-file=.env scripts/db/introspect.mjs                 # 用 DATABASE_URL
//   DATABASE_URL=... node scripts/db/introspect.mjs --out=path.json # 写文件
//   DATABASE_URL=... node scripts/db/introspect.mjs --print         # 只打印
import pg from "pg";
import { writeFileSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const PRINT = args.has("--print");
const outArg = [...args].find((a) => a.startsWith("--out="));
const OUT = outArg ? outArg.slice(6) : null;

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL 未设置");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });

/**
 * 规范化类型表达：把 pg_catalog 内部类型名转成可读、跨版本稳定的写法，
 * 并把 udt_name（如 varchar、_text）拼回去，避免版本间表示漂移。
 */
function normType(c) {
  // 枚举 / 自定义类型走 udt_name
  if (c.data_type === "USER-DEFINED" || c.data_type === "ARRAY") {
    return c.udt_name;
  }
  // character varying → varchar(n)，character → char(n)
  if (c.data_type === "character varying") {
    return c.character_maximum_length ? `varchar(${c.character_maximum_length})` : "varchar";
  }
  if (c.data_type === "character") {
    return c.character_maximum_length ? `char(${c.character_maximum_length})` : "char";
  }
  if (c.data_type === "numeric") {
    return `numeric(${c.numeric_precision ?? "*"},${c.numeric_scale ?? "*"})`;
  }
  if (c.data_type === "timestamp without time zone") return "timestamp";
  if (c.data_type === "timestamp with time zone") return "timestamptz";
  if (c.data_type === "time without time zone") return "time";
  if (c.data_type === "time with time zone") return "timetz";
  return c.data_type;
}

/** 规范化默认值：去掉类型转换前缀和多余空白，便于跨 PG 版本比对。 */
function normDefault(d) {
  if (d == null) return null;
  return d
    .replace(/^::[\w ]+$/, "") // 纯类型转换
    .replace(/'([^']*)'::[\w ]+/g, "$1") // 'x'::text → x
    .replace(/\b(\w+)::[\w ]+/g, "$1") // gen_random_uuid()::text → gen_random_uuid()
    .trim();
}

try {
  await client.connect();

  // 1) 扩展
  const { rows: extRows } = await client.query(
    `SELECT extname AS name FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname`,
  );
  const extensions = extRows.map((r) => r.name);

  // 2) 枚举类型
  const { rows: enumRows } = await client.query(
    `SELECT t.typname AS name,
            e.enumlabel AS label,
            e.enumsortorder AS ord
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder`,
  );
  const enums = {};
  for (const r of enumRows) {
    (enums[r.name] ??= []).push(r.label);
  }

  // 3) 表 + 列
  const { rows: colRows } = await client.query(
    `SELECT table_name, column_name, data_type, udt_name,
            character_maximum_length, numeric_precision, numeric_scale,
            is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  );
  const tables = {};
  for (const c of colRows) {
    (tables[c.table_name] ??= { columns: {} }).columns[c.column_name] = {
      type: normType(c),
      nullable: c.is_nullable === "YES",
      default: normDefault(c.column_default),
    };
  }

  // 4) 索引（含表达式与部分索引谓词）
  const { rows: idxRows } = await client.query(
    `SELECT schemaname, tablename, indexname, indexdef
       FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname`,
  );
  const indexes = {};
  for (const r of idxRows) {
    // indexdef 形如：CREATE UNIQUE INDEX name ON public.t (col) WHERE ...
    const isUnique = /CREATE UNIQUE INDEX/.test(r.indexdef);
    const isPrimary = r.indexname.endsWith("_pkey");
    // 取括号里的列定义
    const m = r.indexdef.match(/\(([^)]*)\)(?:\s+WHERE (.*))?$/);
    const cols = m ? m[1].split(",").map((s) => s.trim()) : [];
    const pred = m && m[2] ? m[2].trim() : null;
    (indexes[r.tablename] ??= []).push({
      name: r.indexname,
      unique: isUnique,
      primary: isPrimary,
      columns: cols,
      predicate: pred,
    });
  }

  // 5) 约束（pk / unique / fk / check）
  const { rows: conRows } = await client.query(
    `SELECT conname AS name,
            conrelid::regclass::text AS table_name,
            contype AS type,
            pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
      ORDER BY table_name, name`,
  );
  const constraints = {};
  for (const r of conRows) {
    const kind =
      r.type === "p" ? "primary_key" :
      r.type === "u" ? "unique" :
      r.type === "f" ? "foreign_key" :
      r.type === "c" ? "check" : r.type;
    (constraints[r.table_name] ??= []).push({ name: r.name, type: kind, def: r.def });
  }

  // 6) 序列
  const { rows: seqRows } = await client.query(
    `SELECT sequence_name FROM information_schema.sequences
      WHERE sequence_schema = 'public'
      ORDER BY sequence_name`,
  );
  const sequences = seqRows.map((r) => r.sequence_name);

  const snapshot = {
    _meta: {
      generated_for: process.env.CASCADE_SNAPSHOT_LABEL || "unspecified",
      note: "Canonical DB structure snapshot — compare across environments, not for runtime use.",
    },
    extensions,
    enums,
    tables,
    indexes,
    constraints,
    sequences,
  };

  const json = JSON.stringify(snapshot, null, 2) + "\n";
  if (OUT) {
    writeFileSync(OUT, json);
    console.log(`✓ 快照已写入 ${OUT}`);
  }
  if (PRINT) {
    process.stdout.write(json);
  } else if (!OUT) {
    // 既没 --out 也没 --print，默认打印一份摘要
    console.log(`✓ 内省完成：${Object.keys(tables).length} 表 / ${Object.keys(enums).length} 枚举 / ${seqRows.length} 序列 / ${extRows.length} 扩展`);
    console.log(json);
  }
} catch (e) {
  console.error(`✗ 内省失败：${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
