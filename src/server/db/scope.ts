import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";
import { rawPrisma } from "./client";

/**
 * Tenant-scoping machinery.
 *
 * Two independent safeguards are applied to every query made through a tenant client:
 *
 *  1. Application layer — `tenantId` is injected into `where` / `data` of every
 *     operation (and nested creates). A caller cannot override it.
 *  2. Database layer — each statement runs in a transaction that first executes
 *     `set_config('app.tenant_id', <id>, true)`. Postgres row-level security policies
 *     (migration `tenant_rls_and_hardening`) then reject any row outside that tenant,
 *     even for nested reads, raw SQL, or a bug in layer 1.
 *
 * Without a tenant id RLS evaluates to "no rows", so a forgotten scope fails closed.
 */

type ScopeMode = { kind: "tenant"; tenantId: string } | { kind: "platform" };

/** Set while running inside `db.tx(...)` so per-operation wrapping is skipped. */
const txState = new AsyncLocalStorage<{ inTx: true }>();

export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === "tenantId" && f.kind === "scalar"))
    .map((m) => m.name),
);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Inject tenantId into the top-level data of creates. Nested relation creates are NOT touched:
 * Prisma derives (or, where ambiguous, requires — the compiler tells us) the tenantId of nested
 * rows from their parent through the composite foreign key, and Postgres RLS `WITH CHECK`
 * rejects any nested row that lands in a different tenant.
 */
function scopeCreateData(modelName: string, data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => scopeCreateData(modelName, d, tenantId));
  if (!isObj(data)) return data;
  return TENANT_MODELS.has(modelName) ? { ...data, tenantId } : { ...data };
}

function stripTenantId(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(stripTenantId);
  if (!isObj(data)) return data;
  const { tenantId: _ignored, tenant: _t, ...rest } = data;
  void _ignored;
  void _t;
  return rest;
}

const WHERE_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

function scopeArgs(model: string, operation: string, rawArgs: unknown, tenantId: string): unknown {
  const args: Json = isObj(rawArgs) ? { ...rawArgs } : {};
  if (WHERE_OPS.has(operation)) {
    args.where = { ...(isObj(args.where) ? args.where : {}), tenantId };
  }
  switch (operation) {
    case "create":
    case "createManyAndReturn":
    case "createMany":
      args.data = scopeCreateData(model, args.data, tenantId);
      break;
    case "update":
    case "updateMany":
    case "updateManyAndReturn":
      args.data = stripTenantId(args.data);
      break;
    case "upsert":
      args.create = scopeCreateData(model, args.create, tenantId);
      args.update = stripTenantId(args.update);
      break;
    default:
      break;
  }
  return args;
}

const SET_TENANT = (tenantId: string) =>
  rawPrisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
const SET_BYPASS = () => rawPrisma.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
const setContext = (mode: ScopeMode) => (mode.kind === "tenant" ? SET_TENANT(mode.tenantId) : SET_BYPASS());

function buildClient(mode: ScopeMode) {
  return rawPrisma.$extends({
    name: mode.kind === "tenant" ? "tenant-scope" : "platform-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          let finalArgs: unknown = args;
          if (mode.kind === "tenant") {
            if (!TENANT_MODELS.has(model) && model !== "Tenant") {
              throw new Error(
                `Model ${model} is not tenant-scoped and cannot be accessed through a tenant client. Use platformDb().`,
              );
            }
            if (model === "Tenant") {
              // A tenant client may read/update only its own tenant row (RLS enforces this too).
              const a = args as unknown as Json;
              const asked = isObj(a.where) ? a.where.id : undefined;
              // Asking for any tenant other than your own matches nothing (rather than silently returning yours).
              const id = asked === undefined || asked === mode.tenantId ? mode.tenantId : "__not_your_tenant__";
              finalArgs = { ...a, where: { ...(isObj(a.where) ? a.where : {}), id } };
            } else {
              finalArgs = scopeArgs(model, operation, args, mode.tenantId);
            }
          }
          if (txState.getStore()?.inTx) return query(finalArgs as never);
          const [, result] = await rawPrisma.$transaction([setContext(mode), query(finalArgs as never)]);
          return result;
        },
      },
      async $allOperations({ operation, args, query }) {
        // Raw SQL ($queryRaw / $executeRaw ...) — RLS is the isolation mechanism here.
        if (operation.startsWith("$") && txState.getStore()?.inTx !== true) {
          const [, result] = await rawPrisma.$transaction([setContext(mode), query(args)]);
          return result;
        }
        return query(args);
      },
    },
  });
}

export type ScopedPrisma = ReturnType<typeof buildClient>;
export type TxClient = Parameters<Parameters<ScopedPrisma["$transaction"]>[0]>[0];
/** Anything services can run queries against: the scoped client or a transaction client. */
export type Db = ScopedPrisma | TxClient;

export type DbHandle = ScopedPrisma & {
  /** Run `fn` atomically. All queries inside see the same tenant context. */
  tx<T>(fn: (tx: TxClient) => Promise<T>, opts?: { timeout?: number }): Promise<T>;
};

function withTx(client: ScopedPrisma, mode: ScopeMode): DbHandle {
  const handle = client as DbHandle;
  Object.defineProperty(handle, "tx", {
    enumerable: false,
    value: <T>(fn: (tx: TxClient) => Promise<T>, opts?: { timeout?: number }) =>
      client.$transaction(
        async (tx) => {
          const stmt =
            mode.kind === "tenant"
              ? tx.$executeRaw`SELECT set_config('app.tenant_id', ${mode.tenantId}, true)`
              : tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
          // The set_config call must not be re-wrapped, so mark in-tx first.
          return txState.run({ inTx: true }, async () => {
            await stmt;
            return fn(tx);
          });
        },
        { timeout: opts?.timeout ?? 15_000, maxWait: 10_000 },
      ),
  });
  return handle;
}

export function createTenantHandle(tenantId: string): DbHandle {
  if (!tenantId || typeof tenantId !== "string") throw new Error("tenantDb requires a tenantId");
  return withTx(buildClient({ kind: "tenant", tenantId }), { kind: "tenant", tenantId });
}

export function createPlatformHandle(): DbHandle {
  return withTx(buildClient({ kind: "platform" }), { kind: "platform" });
}

export type { PrismaClient };
