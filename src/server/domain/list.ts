export interface ListParams {
  page: number;
  pageSize: number;
  q: string;
  sort: string;
  dir: "asc" | "desc";
  /** raw filter values from the query string, keyed by filter name */
  filters: Record<string, string>;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

type SP = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseListParams(
  sp: SP,
  opts: { sortable: readonly string[]; defaultSort: string; defaultDir?: "asc" | "desc"; filters?: readonly string[]; pageSize?: number },
): ListParams {
  const sort = opts.sortable.includes(first(sp.sort) ?? "") ? (first(sp.sort) as string) : opts.defaultSort;
  const dirRaw = first(sp.dir);
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : (opts.defaultDir ?? "desc");
  const sizeRaw = Number(first(sp.pageSize));
  const pageSize = [10, 25, 50, 100].includes(sizeRaw) ? sizeRaw : (opts.pageSize ?? 25);
  const page = Math.max(1, Math.floor(Number(first(sp.page))) || 1);
  const filters: Record<string, string> = {};
  for (const f of opts.filters ?? []) {
    const v = first(sp[f]);
    if (v !== undefined && v !== "") filters[f] = v.slice(0, 200);
  }
  return { page, pageSize, q: (first(sp.q) ?? "").trim().slice(0, 100), sort, dir, filters };
}

export function toPage<T>(rows: T[], total: number, p: Pick<ListParams, "page" | "pageSize">): Page<T> {
  return { rows, total, page: p.page, pageSize: p.pageSize, pageCount: Math.max(1, Math.ceil(total / p.pageSize)) };
}

export const skipTake = (p: Pick<ListParams, "page" | "pageSize">) => ({ skip: (p.page - 1) * p.pageSize, take: p.pageSize });

export function parseDate(v: string | undefined): Date | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  return new Date(`${v}T00:00:00.000Z`);
}
