import { marked } from "marked";
import type { Item } from "./api";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function md(s: string): string {
  return marked.parse(s ?? "", { async: false }) as string;
}

/** Sort ids the way a person reads them: 2.9 before 2.10, digits before letters. */
export function idKey(id: string): (string | number)[] {
  return id.split(".").flatMap((p) => (/^\d+$/.test(p) ? [0, Number(p)] : [1, p]));
}
export function cmpId(a: string, b: string): number {
  const ka = idKey(a), kb = idKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const x = ka[i], y = kb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

const STATUS_RANK: Record<string, number> = { now: 0, next: 1, yours: 2, watch: 3, later: 4, parked: 5, done: 6 };

/** The queue: what to do next, in the order the tool recommends it. */
export function queueOrder(a: Item, b: Item): number {
  return a.priority.localeCompare(b.priority) || STATUS_RANK[a.status] - STATUS_RANK[b.status] || cmpId(a.id, b.id);
}

export function daysSince(iso: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.slice(0, 10) + "T00:00:00");
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function badge(kind: string, text?: string): string {
  return `<span class="badge b-${esc(kind)}">${esc(text ?? kind)}</span>`;
}

export function fileLink(path: string): string {
  return `<a class="file" data-open="${esc(path)}" title="Open in editor">${esc(path)}</a>`;
}

export function itemLink(it: Item): string {
  return `<a class="item-link" data-item="${esc(it.id)}"><span class="id">${esc(it.id)}</span> ${esc(it.title)}</a>`;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.innerHTML = html;
  return e;
}

export function option(value: string, label: string, selected: boolean): string {
  return `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
}
