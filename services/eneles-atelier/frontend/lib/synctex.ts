/**
 * SyncTeX in the browser: PDF position ↔ source position, in both directions.
 *
 * The compile already ships `<main>.synctex.gz` to the client, so everything is resolved here from that file: no round trip, no `synctex` binary on the compile host, and a lookup costs well under a millisecond once the file is parsed.
 *
 * The parser and the two queries follow the reference implementation (synctex_parser.c 1.21, the code behind `synctex view` and `synctex edit`) step by step, quirks included, so results can be checked against the CLI: see `scripts/test-synctex.mjs`. On top of that sit the parts the CLI does not have: mapping TeX's input names back to project paths, falling back from package files to the user's own file, narrowing a highlight to the part of a PDF line one source line produced, picking the column from the clicked word, and remapping lines when the source changed after the compile.
 *
 * Units: records are in TeX scaled points (65536 sp = 1 pt, 72.27 pt = 1 in). Everything this module returns is in PDF points (bp, 72 bp = 1 in) from the page's top-left corner, y down: 1 bp = 65781.76 sp.
 *
 * This file has no imports from the app and only erasable TypeScript, so Node can run it directly for the tests.
 */

import { diffArrays } from "diff";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Scaled points per PDF point: 65536 × 72.27 / 72. */
export const SP_PER_BP = 65781.76;
const INT_MAX = 2147483647;
/** Size of the (tag + line) hash the reference parser files nodes under. */
const FRIEND_LISTS = 1024;

const SHEET = 0;
const VBOX = 1;
const HBOX = 2;
const VOID_VBOX = 3;
const VOID_HBOX = 4;
const KERN = 5;
const GLUE = 6;
const RULE = 7;
const MATH = 8;
const BOUNDARY = 9;
const BOX_BDRY = 10;
const REF = 11;
const FORM = 12;

// ─────────────────────────────────────────────────────────────────────────────
// Parsed index
// ─────────────────────────────────────────────────────────────────────────────

interface LineTables {
  /** Lines that have records, per tag, ascending. */
  lines: Map<number, Int32Array>;
  /** Boxes set inside a line of text (an image, an \mbox, a rule's box), by tag and line. */
  boxes: Map<number, number[]>;
}

export interface SyncTexInput {
  tag: number;
  /** The file name exactly as TeX recorded it. */
  name: string;
  /** Highest line any record of this input carries. */
  maxLine: number;
}

/**
 * The whole SyncTeX file as flat typed arrays, one slot per node. A long document has around a million nodes, so objects per node are not an option.
 */
export interface SyncTexIndex {
  count: number;
  type: Uint8Array;
  /** 1 for a node copied out of a PDF form (the reference parser's proxies). */
  proxy: Uint8Array;
  tag: Int32Array;
  line: Int32Array;
  h: Int32Array;
  v: Int32Array;
  w: Int32Array;
  ht: Int32Array;
  dp: Int32Array;
  parent: Int32Array;
  next: Int32Array;
  child: Int32Array;
  /** For an hbox, its slot in the hbox-only arrays below; -1 otherwise. */
  hx: Int32Array;
  /** Hbox extents grown to contain what is inside (boxes of zero width can hold text). */
  hV: Int32Array;
  vV: Int32Array;
  wV: Int32Array;
  htV: Int32Array;
  dpV: Int32Array;
  mean: Int32Array;
  weight: Int32Array;
  friendNext: Int32Array;
  friendHead: Int32Array;
  /** Sheet node per 1-based page, -1 when the page has no sheet. */
  sheets: Int32Array;
  pageCount: number;
  /** Hboxes in the order they closed, all pages back to back. */
  hboxOrder: Int32Array;
  /** Start of each page's run in `hboxOrder`; index pageCount + 1 holds the end. */
  hboxStart: Int32Array;
  /** Hboxes copied out of forms, per page, in the order they were registered. */
  proxyHboxes: Map<number, number[]>;
  inputs: SyncTexInput[];
  inputByTag: Map<number, SyncTexInput>;
  /** bp per SyncTeX unit, magnification included. */
  unit: number;
  xOffset: number;
  yOffset: number;
  magnification: number;
  /** Whether the engine marks the end of every run of characters with an `x` record. pdfTeX and LuaTeX do; XeTeX writes almost none. */
  marksTextEnds: boolean;
  /** Whether a vbox record gives the top of the box instead of its baseline. LuaTeX writes vboxes that way; pdfTeX and XeTeX give the baseline, as the format says. */
  vboxFromTop: boolean;
  /** Per-line lookup tables for the source → PDF direction, built on first use. */
  tables: LineTables | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncTexParser {
  /** Feed the next piece of the uncompressed file. Pieces may split lines anywhere. */
  push(chunk: Uint8Array): void;
  /** Call once after the last piece. */
  finish(): SyncTexIndex;
}

const DIMENSION_TO_SP: Record<string, number> = {
  in: 72.27 * 65536,
  cm: (72.27 * 65536) / 2.54,
  mm: (72.27 * 65536) / 25.4,
  pt: 65536,
  bp: (72.27 * 65536) / 72,
  pc: 12 * 65536,
  sp: 1,
  dd: (1238 * 65536) / 1157,
  cc: (14856 * 65536) / 1157,
  nd: (685 * 65536) / 642,
  nc: (1370 * 65536) / 107,
};

export function createSyncTexParser(): SyncTexParser {
  // ── Node storage ──
  let cap = 1 << 14;
  let count = 0;
  let type = new Uint8Array(cap);
  let proxy = new Uint8Array(cap);
  let tag = new Int32Array(cap);
  let line = new Int32Array(cap);
  let h = new Int32Array(cap);
  let v = new Int32Array(cap);
  let w = new Int32Array(cap);
  let ht = new Int32Array(cap);
  let dp = new Int32Array(cap);
  let parent = new Int32Array(cap);
  let next = new Int32Array(cap);
  let child = new Int32Array(cap);
  let hx = new Int32Array(cap);
  let friendNext = new Int32Array(cap);

  let hcap = 1 << 12;
  let hcount = 0;
  let hV = new Int32Array(hcap);
  let vV = new Int32Array(hcap);
  let wV = new Int32Array(hcap);
  let htV = new Int32Array(hcap);
  let dpV = new Int32Array(hcap);
  let mean = new Int32Array(hcap);
  let weight = new Int32Array(hcap);

  let ocap = 1 << 12;
  let ocount = 0;
  let hboxOrder = new Int32Array(ocap);

  const friendHead = new Int32Array(FRIEND_LISTS).fill(-1);

  const growI32 = (a: Int32Array, n: number) => {
    const b = new Int32Array(n);
    b.set(a);
    return b;
  };
  const growU8 = (a: Uint8Array, n: number) => {
    const b = new Uint8Array(n);
    b.set(a);
    return b;
  };

  const newNode = (t: number, tg: number, ln: number, nh: number, nv: number, nw: number, nht: number, ndp: number): number => {
    if (count === cap) {
      cap *= 2;
      type = growU8(type, cap);
      proxy = growU8(proxy, cap);
      tag = growI32(tag, cap);
      line = growI32(line, cap);
      h = growI32(h, cap);
      v = growI32(v, cap);
      w = growI32(w, cap);
      ht = growI32(ht, cap);
      dp = growI32(dp, cap);
      parent = growI32(parent, cap);
      next = growI32(next, cap);
      child = growI32(child, cap);
      hx = growI32(hx, cap);
      friendNext = growI32(friendNext, cap);
    }
    const n = count++;
    type[n] = t;
    tag[n] = tg;
    line[n] = ln;
    h[n] = nh;
    v[n] = nv;
    w[n] = nw;
    ht[n] = nht;
    dp[n] = ndp;
    parent[n] = -1;
    next[n] = -1;
    child[n] = -1;
    hx[n] = -1;
    friendNext[n] = -1;
    if (t === HBOX) {
      if (hcount === hcap) {
        hcap *= 2;
        hV = growI32(hV, hcap);
        vV = growI32(vV, hcap);
        wV = growI32(wV, hcap);
        htV = growI32(htV, hcap);
        dpV = growI32(dpV, hcap);
        mean = growI32(mean, hcap);
        weight = growI32(weight, hcap);
      }
      const x = hcount++;
      hx[n] = x;
      hV[x] = nh;
      vV[x] = nv;
      wV[x] = nw;
      htV[x] = nht;
      dpV[x] = ndp;
      mean[x] = 0;
      weight[x] = 0;
    }
    return n;
  };

  const makeFriend = (n: number) => {
    const i = tag[n] + line[n];
    if (i < 0) return;
    const b = i % FRIEND_LISTS;
    friendNext[n] = friendHead[b];
    friendHead[b] = n;
  };

  // ── Hbox extents grown to hold a point or a box, as the reference does ──
  const containPoint = (box: number, ph: number, pv: number) => {
    if (box < 0 || type[box] !== HBOX) return;
    const x = hx[box];
    const n = wV[x];
    if (n < 0) {
      const max = hV[x];
      const min = max + n;
      if (ph < min) wV[x] = ph - max;
      else if (ph > max) {
        hV[x] = ph;
        wV[x] = min - ph;
      }
    } else {
      const min = hV[x];
      const max = min + n;
      if (ph < min) {
        hV[x] = ph;
        wV[x] = max - ph;
      } else if (ph > max) wV[x] = ph - min;
    }
    const base = vV[x];
    const top = base - htV[x];
    const bottom = base + dpV[x];
    if (pv < top) htV[x] = base - pv;
    else if (pv > bottom) dpV[x] = pv - base;
  };
  const containBox = (box: number, minH: number, maxH: number, minV: number, maxV: number) => {
    if (box < 0 || type[box] !== HBOX) return;
    const x = hx[box];
    const n = wV[x];
    if (n < 0) {
      const max = hV[x];
      const min = max + n;
      if (minH < min) wV[x] = minH - max;
      else if (maxH > max) {
        hV[x] = maxH;
        wV[x] = min - maxH;
      }
    } else {
      const min = hV[x];
      const max = min + n;
      if (minH < min) {
        hV[x] = minH;
        wV[x] = max - minH;
      } else if (maxH > max) wV[x] = maxH - min;
    }
    const base = vV[x];
    const top = base - htV[x];
    const bottom = base + dpV[x];
    if (minV < top) htV[x] = base - minV;
    else if (maxV > bottom) dpV[x] = maxV - base;
  };

  // ── Inputs ──
  const inputs: SyncTexInput[] = [];
  const inputByTag = new Map<number, SyncTexInput>();
  let lastInput: SyncTexInput | null = null;
  const registerLine = (n: number) => {
    const t = tag[n];
    if (!lastInput || lastInput.tag !== t) {
      const found = inputByTag.get(t);
      if (!found) return;
      lastInput = found;
    }
    if (line[n] > lastInput.maxLine) lastInput.maxLine = line[n];
  };

  // ── Preamble and postamble values ──
  let preMagnification = 1000;
  let preUnit = 8192;
  let preXOffset = 578;
  let preYOffset = 578;
  let postMagnification = 0;
  let postXOffset = NaN;
  let postYOffset = NaN;

  // ── Parse state ──
  const PREAMBLE = 0;
  const MAIN = 1;
  const CONTENT = 2;
  const POSTAMBLE = 3;
  let state = PREAMBLE;
  let inPostScriptum = false;

  let sheet = -1;
  let parentNode = -1;
  /** The node most recently added to the open container, or -1. */
  let lastChild = -1;
  let lastV = -1;
  let lastK = -1;
  let lastG = -1;
  /** Open forms, innermost last, with what to restore when each ends. */
  const formStack: { node: number; parent: number; last: number }[] = [];
  /** Leading `x` records waiting for the line of the node that follows them, one list per open box. */
  let pending: number[][] = [[]];
  const refsInForms: number[] = [];
  const refsInSheets: number[] = [];
  const forms = new Map<number, number>();
  const sheetList: number[] = [];
  const pageHboxStart: number[] = [];
  let maxPage = 0;

  const inForm = () => formStack.length > 0;

  const link = (n: number) => {
    parent[n] = parentNode;
    if (lastChild >= 0) next[lastChild] = n;
    else child[parentNode] = n;
  };

  /** Give the waiting `x` records the file and line of `from`, newest first, and file them. */
  const settlePending = (from: number, friend: boolean) => {
    const top = pending[pending.length - 1];
    for (let i = top.length - 1; i >= 0; i--) {
      const x = top[i];
      tag[x] = tag[from];
      line[x] = line[from];
      if (friend) makeFriend(x);
    }
    top.length = 0;
  };
  const filePending = () => {
    const top = pending[pending.length - 1];
    for (let i = top.length - 1; i >= 0; i--) makeFriend(top[i]);
    top.length = 0;
  };

  // ── Line reader ──
  let buf: Uint8Array = new Uint8Array(0);
  let pos = 0;
  let end = 0;
  let intOk = false;
  const decoder = new TextDecoder("utf-8");

  /** An integer after one optional ':' or ','. Sets `intOk`; leaves `pos` alone when there is none. */
  const readInt = (): number => {
    let p = pos;
    if (p < end && (buf[p] === 58 || buf[p] === 44)) p++;
    let neg = false;
    if (p < end && (buf[p] === 45 || buf[p] === 43)) {
      neg = buf[p] === 45;
      p++;
    }
    const start = p;
    let n = 0;
    while (p < end) {
      const c = buf[p] - 48;
      if (c < 0 || c > 9) break;
      n = n * 10 + c;
      p++;
    }
    if (p === start) {
      intOk = false;
      return 0;
    }
    intOk = true;
    pos = p;
    return neg ? -n : n;
  };
  /** A `v` value: an integer, or `,=` for "same as the last one". */
  const readV = (): number => {
    const n = readInt();
    if (intOk) {
      lastV = n;
      return n;
    }
    if (pos + 1 < end && buf[pos] === 44 && buf[pos + 1] === 61) {
      pos += 2;
      intOk = true;
      return lastV;
    }
    return 0;
  };
  const startsWith = (s: string): boolean => {
    if (end - pos < s.length) return false;
    for (let i = 0; i < s.length; i++) if (buf[pos + i] !== s.charCodeAt(i)) return false;
    return true;
  };
  const rest = (from: number): string => decoder.decode(buf.subarray(from, end));

  let rTag = 0;
  let rLine = 0;
  let rH = 0;
  let rV = 0;
  let rW = 0;
  let rHt = 0;
  let rDp = 0;
  /** Reads `tag,line[,column]:h,v` and then `dims` more values (0, 1, or 3). False on a malformed record. */
  const readRecord = (dims: number): boolean => {
    pos++;
    rTag = readInt();
    if (!intOk) return false;
    rLine = readInt();
    if (!intOk) return false;
    // An optional column, which no engine writes today.
    if (pos < end && buf[pos] === 44) {
      readInt();
      if (!intOk) return false;
    }
    rH = readInt();
    if (!intOk) return false;
    rV = readV();
    if (!intOk) return false;
    rW = 0;
    rHt = 0;
    rDp = 0;
    if (dims >= 1) {
      rW = readInt();
      if (!intOk) return false;
    }
    if (dims === 3) {
      rHt = readInt();
      if (!intOk) return false;
      rDp = readInt();
      if (!intOk) return false;
    }
    return true;
  };

  const parseInput = () => {
    pos += 6;
    const t = readInt();
    if (!intOk || pos >= end || buf[pos] !== 58) return;
    const name = rest(pos + 1).replace(/\r$/, "");
    if (inputByTag.has(t)) return;
    const input: SyncTexInput = { tag: t, name, maxLine: 0 };
    inputs.push(input);
    inputByTag.set(t, input);
  };

  const closeHbox = () => {
    const box = parentNode;
    const x = hx[box];
    if (!inForm()) {
      if (ocount === ocap) {
        ocap *= 2;
        hboxOrder = growI32(hboxOrder, ocap);
      }
      hboxOrder[ocount++] = box;
    }
    // Mean line over the children, the leading boundary aside.
    const first = child[box];
    const second = first >= 0 ? next[first] : -1;
    if (second >= 0) {
      line[first] = type[second] === REF ? 0 : line[second];
      let nodeWeight = 0;
      let cumulated = 0;
      for (let n = second; n >= 0; n = next[n]) {
        if (type[n] === HBOX) {
          const nx = hx[n];
          if (weight[nx]) {
            nodeWeight += weight[nx];
            cumulated += mean[nx] * weight[nx];
          } else {
            nodeWeight++;
            cumulated += mean[nx];
          }
        } else {
          nodeWeight++;
          cumulated += type[n] === REF ? 0 : line[n];
        }
      }
      mean[x] = Math.floor((cumulated + Math.floor(nodeWeight / 2)) / nodeWeight);
      weight[x] = nodeWeight;
    } else {
      mean[x] = line[box];
      weight[x] = 1;
    }
    // A closing boundary carrying the file and line of the last real child.
    let from = lastChild;
    while (from >= 0 && type[from] === REF) {
      let prev = -1;
      for (let n = child[box]; n >= 0 && n !== from; n = next[n]) prev = n;
      from = prev;
    }
    const closing = newNode(BOX_BDRY, from >= 0 ? tag[from] : tag[box], from >= 0 ? line[from] : line[box], hV[x] + wV[x], vV[x], 0, 0, 0);
    parent[closing] = box;
    if (lastChild >= 0) next[lastChild] = closing;
    else child[box] = closing;
    if (first >= 0) {
      h[first] = hV[x];
      v[first] = vV[x];
    }
    // A kern then glue at the very end of a box take the line of what came before them.
    if (lastK >= 0 && lastG >= 0) {
      for (let n = child[box]; n >= 0 && next[n] >= 0; n = next[n]) {
        if (next[n] === lastK) {
          tag[lastK] = tag[n];
          line[lastK] = line[n];
          tag[lastG] = tag[n];
          line[lastG] = line[n];
          break;
        }
      }
    }
    parentNode = parent[box];
    lastChild = box;
    if (!inForm()) filePending();
    pending.pop();
    if (pending.length === 0) pending.push([]);
    settlePending(box, !inForm());
    if (parentNode >= 0 && type[parentNode] === HBOX) {
      const n = wV[x];
      const minH = n < 0 ? hV[x] + n : hV[x];
      const maxH = n < 0 ? hV[x] : hV[x] + n;
      containBox(parentNode, minH, maxH, vV[x] - htV[x], vV[x] + dpV[x]);
    }
  };

  const contentLine = () => {
    const c = buf[pos];
    let handled = true;
    switch (c) {
      case 40: {
        // ( hbox
        if (!readRecord(3)) break;
        const n = newNode(HBOX, rTag, rLine, rH, rV, rW, rHt, rDp);
        pending.push([]);
        link(n);
        parentNode = n;
        const bdry = newNode(BOX_BDRY, rTag, rLine, rH, rV, 0, 0, 0);
        parent[bdry] = n;
        child[n] = bdry;
        if (!inForm()) makeFriend(bdry);
        lastChild = bdry;
        registerLine(n);
        break;
      }
      case 41: // )
        if (parentNode >= 0 && type[parentNode] === HBOX) closeHbox();
        else handled = false;
        break;
      case 91: {
        // [ vbox
        if (!readRecord(3)) break;
        const n = newNode(VBOX, rTag, rLine, rH, rV, rW, rHt, rDp);
        pending.push([]);
        link(n);
        parentNode = n;
        lastChild = -1;
        registerLine(n);
        break;
      }
      case 93: {
        // ]
        if (parentNode < 0 || type[parentNode] !== VBOX) {
          handled = false;
          break;
        }
        const box = parentNode;
        // Only a vbox with nothing in it is filed under its line.
        if (child[box] < 0 && !inForm()) makeFriend(box);
        parentNode = parent[box];
        lastChild = box;
        if (!inForm()) filePending();
        pending.pop();
        if (pending.length === 0) pending.push([]);
        settlePending(box, !inForm());
        break;
      }
      case 118: {
        // v void vbox
        if (!readRecord(3)) break;
        const n = newNode(VOID_VBOX, rTag, rLine, rH, rV, rW, rHt, rDp);
        link(n);
        lastChild = n;
        settlePending(n, !inForm());
        registerLine(n);
        break;
      }
      case 104: {
        // h void hbox
        if (!readRecord(3)) break;
        const n = newNode(VOID_HBOX, rTag, rLine, rH, rV, rW, rHt, rDp);
        link(n);
        lastChild = n;
        settlePending(n, !inForm());
        containBox(parentNode, rW < 0 ? rH + rW : rH, rW < 0 ? rH : rH + rW, rV - rHt, rV + rDp);
        registerLine(n);
        break;
      }
      case 107: {
        // k kern, recorded after the move
        if (!readRecord(1)) break;
        const n = newNode(KERN, rTag, rLine, rH, rV, rW, 0, 0);
        link(n);
        lastChild = n;
        if (!inForm()) makeFriend(n);
        settlePending(n, !inForm());
        containBox(parentNode, rW > 0 ? rH - rW : rH, rW > 0 ? rH : rH - rW, rV, rV);
        registerLine(n);
        lastK = n;
        lastG = -1;
        return;
      }
      case 103: {
        // g glue
        if (!readRecord(0)) break;
        const n = newNode(GLUE, rTag, rLine, rH, rV, 0, 0, 0);
        link(n);
        lastChild = n;
        if (!inForm()) makeFriend(n);
        settlePending(n, !inForm());
        containPoint(parentNode, rH, rV);
        registerLine(n);
        if (lastK >= 0) lastG = n;
        else {
          lastK = -1;
          lastG = -1;
        }
        return;
      }
      case 114: {
        // r rule; rules are often far larger than the text, so they do not grow the box
        if (!readRecord(3)) break;
        const n = newNode(RULE, rTag, rLine, rH, rV, rW, rHt, rDp);
        link(n);
        lastChild = n;
        if (!inForm()) makeFriend(n);
        settlePending(n, !inForm());
        registerLine(n);
        break;
      }
      case 36: {
        // $ math
        if (!readRecord(0)) break;
        const n = newNode(MATH, rTag, rLine, rH, rV, 0, 0, 0);
        link(n);
        lastChild = n;
        if (!inForm()) makeFriend(n);
        settlePending(n, !inForm());
        containPoint(parentNode, rH, rV);
        registerLine(n);
        break;
      }
      case 120: {
        // x the current position after a run of characters
        if (!readRecord(0)) break;
        const n = newNode(BOUNDARY, rTag, rLine, rH, rV, 0, 0, 0);
        link(n);
        // At the start of a box these carry the line of the previous box, so they wait for the next node.
        const top = pending[pending.length - 1];
        if ((lastChild >= 0 && type[lastChild] === BOX_BDRY) || top.length > 0) top.push(n);
        else if (!inForm()) makeFriend(n);
        lastChild = n;
        containPoint(parentNode, rH, rV);
        registerLine(n);
        break;
      }
      case 102: {
        // f a reference to a form
        pos++;
        const t = readInt();
        if (!intOk) break;
        const fh = readInt();
        if (!intOk) break;
        const fv = readV();
        if (!intOk) break;
        const n = newNode(REF, t, 0, fh, fv, 0, 0, 0);
        link(n);
        lastChild = n;
        (inForm() ? refsInForms : refsInSheets).push(n);
        break;
      }
      case 60: {
        // < form
        pos++;
        const t = readInt();
        if (!intOk) break;
        const n = newNode(FORM, t, 0, 0, 0, 0, 0, 0);
        forms.set(t, n);
        formStack.push({ node: n, parent: parentNode, last: lastChild });
        pending.push([]);
        parentNode = n;
        lastChild = -1;
        break;
      }
      case 62: {
        // >
        const top = formStack[formStack.length - 1];
        if (!top || parentNode !== top.node) {
          handled = false;
          break;
        }
        formStack.pop();
        pending.pop();
        if (pending.length === 0) pending.push([]);
        parentNode = top.parent;
        lastChild = top.last;
        if (parentNode < 0) state = MAIN;
        break;
      }
      case 125: // }
        if (sheet >= 0 && parentNode === sheet) {
          sheet = -1;
          parentNode = -1;
          lastChild = -1;
          state = MAIN;
        } else handled = false;
        break;
      case 33: // ! anchor
      case 99: // c character
        break;
      default:
        handled = false;
    }
    if (!handled && startsWith("Input:")) parseInput();
    lastK = -1;
    lastG = -1;
  };

  const mainLine = () => {
    const c = buf[pos];
    if (c === 123) {
      // { sheet
      pos++;
      const page = readInt();
      if (!intOk || page < 1) return;
      const n = newNode(SHEET, 0, page, 0, 0, 0, 0, 0);
      sheetList.push(n);
      pageHboxStart[page] = ocount;
      if (page > maxPage) maxPage = page;
      sheet = n;
      parentNode = n;
      lastChild = -1;
      lastK = -1;
      lastG = -1;
      pending = [[]];
      state = CONTENT;
    } else if (c === 60) {
      state = CONTENT;
      contentLine();
    } else if (c === 73 && startsWith("Input:")) parseInput();
    else if (c === 80 && startsWith("Postamble:")) state = POSTAMBLE;
  };

  const numberAfter = (prefix: string): number => parseFloat(rest(pos + prefix.length));

  const preambleLine = () => {
    if (startsWith("Input:")) parseInput();
    else if (startsWith("Magnification:")) preMagnification = numberAfter("Magnification:");
    else if (startsWith("Unit:")) preUnit = numberAfter("Unit:");
    else if (startsWith("X Offset:")) preXOffset = numberAfter("X Offset:");
    else if (startsWith("Y Offset:")) preYOffset = numberAfter("Y Offset:");
    else if (startsWith("Content:")) state = MAIN;
  };

  const dimension = (prefix: string): number => {
    const m = /^\s*(-?[\d.]+(?:e[-+]?\d+)?)\s*([a-z]{2})?/i.exec(rest(pos + prefix.length));
    if (!m) return NaN;
    return parseFloat(m[1]) * (DIMENSION_TO_SP[(m[2] || "pt").toLowerCase()] ?? 65536);
  };
  const postambleLine = () => {
    if (startsWith("Post scriptum:")) inPostScriptum = true;
    else if (inPostScriptum) {
      if (startsWith("Magnification:")) postMagnification = numberAfter("Magnification:");
      else if (startsWith("X Offset:")) postXOffset = dimension("X Offset:");
      else if (startsWith("Y Offset:")) postYOffset = dimension("Y Offset:");
    }
  };

  const processLine = (b: Uint8Array, from: number, to: number) => {
    if (to <= from) return;
    buf = b;
    pos = from;
    end = to;
    if (state === CONTENT) contentLine();
    else if (state === MAIN) mainLine();
    else if (state === PREAMBLE) preambleLine();
    else postambleLine();
  };

  let carry: Uint8Array | null = null;

  // ── Forms: every reference becomes a copy of the form's content, shifted into place ──
  const copyTree = (src: number, dh: number, dv: number, into: number, page: number): number => {
    const n = newNode(type[src], tag[src], line[src], h[src] + dh, v[src] + dv, w[src], ht[src], dp[src]);
    proxy[n] = 1;
    parent[n] = into;
    if (type[src] === HBOX) {
      const sx = hx[src];
      const x = hx[n];
      hV[x] = hV[sx] + dh;
      vV[x] = vV[sx] + dv;
      wV[x] = wV[sx];
      htV[x] = htV[sx];
      dpV[x] = dpV[sx];
      mean[x] = mean[sx];
      weight[x] = weight[sx];
    }
    if (page > 0) {
      makeFriend(n);
      if (type[n] === HBOX) {
        const list = proxyHboxes.get(page);
        if (list) list.push(n);
        else proxyHboxes.set(page, [n]);
      }
    }
    let last = -1;
    for (let c = child[src]; c >= 0; c = next[c]) {
      const copy = copyTree(c, dh, dv, n, page);
      if (last >= 0) next[last] = copy;
      else child[n] = copy;
      last = copy;
    }
    return n;
  };
  const proxyHboxes = new Map<number, number[]>();
  const pageOfNode = (n: number): number => {
    let p = n;
    while (parent[p] >= 0) p = parent[p];
    return type[p] === SHEET ? line[p] : -1;
  };
  const replaceRef = (ref: number) => {
    const owner = parent[ref];
    if (owner < 0) return;
    let prev = -1;
    for (let n = child[owner]; n >= 0 && n !== ref; n = next[n]) prev = n;
    const form = forms.get(tag[ref]);
    const content = form !== undefined ? child[form] : -1;
    let replacement = next[ref];
    if (content >= 0 && (type[content] === HBOX || type[content] === VBOX)) {
      // A form's content hangs from its top edge at the point of use, so the box's own height comes off the vertical shift.
      const copy = copyTree(content, h[ref], v[ref] - ht[content], owner, pageOfNode(owner));
      next[copy] = next[ref];
      replacement = copy;
    }
    if (prev >= 0) next[prev] = replacement;
    else child[owner] = replacement;
    parent[ref] = -1;
    next[ref] = -1;
  };

  return {
    push(chunk: Uint8Array) {
      let start = 0;
      if (carry) {
        const nl = chunk.indexOf(10);
        if (nl < 0) {
          const joined = new Uint8Array(carry.length + chunk.length);
          joined.set(carry);
          joined.set(chunk, carry.length);
          carry = joined;
          return;
        }
        const joined = new Uint8Array(carry.length + nl);
        joined.set(carry);
        joined.set(chunk.subarray(0, nl), carry.length);
        carry = null;
        processLine(joined, 0, joined.length);
        start = nl + 1;
      }
      const len = chunk.length;
      while (start < len) {
        const nl = chunk.indexOf(10, start);
        if (nl < 0) {
          carry = chunk.slice(start);
          return;
        }
        processLine(chunk, start, nl);
        start = nl + 1;
      }
    },
    finish(): SyncTexIndex {
      if (carry) {
        processLine(carry, 0, carry.length);
        carry = null;
      }
      // Forms that use other forms first, oldest first, so a copy is made of content that is already complete.
      for (const ref of refsInForms) replaceRef(ref);
      for (const ref of refsInSheets) replaceRef(ref);

      const sheets = new Int32Array(maxPage + 1).fill(-1);
      for (const s of sheetList) sheets[line[s]] = s;
      const hboxStart = new Int32Array(maxPage + 2);
      let at = 0;
      for (let p = 1; p <= maxPage; p++) {
        if (pageHboxStart[p] !== undefined) at = pageHboxStart[p];
        hboxStart[p] = at;
      }
      hboxStart[maxPage + 1] = ocount;
      // A page without a sheet owns no hboxes: its run ends where the next one starts.
      for (let p = maxPage; p >= 1; p--) if (pageHboxStart[p] === undefined) hboxStart[p] = hboxStart[p + 1];

      if (!(preUnit > 0)) preUnit = 8192;
      if (!(preMagnification > 0)) preMagnification = 1000;
      let unit = postMagnification > 0 ? postMagnification * (preUnit / SP_PER_BP) : preUnit / SP_PER_BP;
      unit *= preMagnification / 1000;
      const xOffset = Number.isNaN(postXOffset) ? preXOffset * (preUnit / SP_PER_BP) : postXOffset / SP_PER_BP;
      const yOffset = Number.isNaN(postYOffset) ? preYOffset * (preUnit / SP_PER_BP) : postYOffset / SP_PER_BP;

      return {
        count,
        type: type.subarray(0, count),
        proxy: proxy.subarray(0, count),
        tag: tag.subarray(0, count),
        line: line.subarray(0, count),
        h: h.subarray(0, count),
        v: v.subarray(0, count),
        w: w.subarray(0, count),
        ht: ht.subarray(0, count),
        dp: dp.subarray(0, count),
        parent: parent.subarray(0, count),
        next: next.subarray(0, count),
        child: child.subarray(0, count),
        hx: hx.subarray(0, count),
        hV: hV.subarray(0, hcount),
        vV: vV.subarray(0, hcount),
        wV: wV.subarray(0, hcount),
        htV: htV.subarray(0, hcount),
        dpV: dpV.subarray(0, hcount),
        mean: mean.subarray(0, hcount),
        weight: weight.subarray(0, hcount),
        friendNext: friendNext.subarray(0, count),
        friendHead,
        sheets,
        pageCount: maxPage,
        hboxOrder: hboxOrder.subarray(0, ocount),
        hboxStart,
        proxyHboxes,
        inputs,
        inputByTag,
        unit,
        xOffset,
        yOffset,
        magnification: preMagnification,
        marksTextEnds: (() => {
          let ends = 0;
          let spaces = 0;
          for (let i = 0; i < count; i++) {
            if (type[i] === BOUNDARY) ends++;
            else if (type[i] === KERN || type[i] === GLUE) spaces++;
          }
          return ends * 3 > spaces;
        })(),
        vboxFromTop: (() => {
          // The first line inside a vbox lies above the box's baseline, unless `v` is the box's top.
          let top = 0;
          let baseline = 0;
          for (let n = 0; n < count && top + baseline < 400; n++) {
            if (type[n] !== VBOX || ht[n] <= 0) continue;
            for (let c = child[n]; c >= 0; c = next[c]) {
              if (type[c] !== HBOX && type[c] !== VOID_HBOX) continue;
              if (v[c] > v[n] + dp[n]) top++;
              else baseline++;
              break;
            }
          }
          return top > baseline;
        })(),
        tables: null,
      };
    },
  };
}

/** Parse a whole uncompressed SyncTeX file in one go. Blocks: use `loadSyncTex` in the browser. */
export function parseSyncTexBytes(bytes: Uint8Array): SyncTexIndex {
  const parser = createSyncTexParser();
  parser.push(bytes);
  return parser.finish();
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Gunzip and parse a `.synctex.gz`. The browser inflates off the main thread and hands over the text in pieces; each piece is parsed as it arrives, and the loop gives the page back to the browser whenever it has held it for `sliceMs`, so typing stays smooth while a book-sized file loads.
 */
export async function parseSyncTexGzip(gz: Uint8Array, sliceMs = 8): Promise<SyncTexIndex | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const copy = new Uint8Array(gz.byteLength);
    copy.set(gz);
    const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    const reader = stream.getReader();
    const parser = createSyncTexParser();
    let sliceStart = now();
    // One inflated piece can be large, so it is fed in bites the parser gets through in a millisecond or two.
    const BITE = 1 << 18;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const piece = value as Uint8Array;
      for (let at = 0; at < piece.length; at += BITE) {
        parser.push(piece.subarray(at, Math.min(piece.length, at + BITE)));
        if (now() - sliceStart > sliceMs) {
          await breathe();
          sliceStart = now();
        }
      }
    }
    return parser.finish();
  } catch {
    return null;
  }
}

let cachedKey: string | null = null;
let cachedIndex: Promise<SyncTexIndex | null> | null = null;

/** Parse the compile's base64 `.synctex.gz` once and keep it until the next compile replaces it. */
export function loadSyncTex(base64: string): Promise<SyncTexIndex | null> {
  if (cachedKey === base64 && cachedIndex) return cachedIndex;
  cachedKey = base64;
  cachedIndex = (async () => {
    try {
      return await parseSyncTexGzip(base64ToBytes(base64));
    } catch {
      return null;
    }
  })();
  return cachedIndex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry, as the reference computes it
// ─────────────────────────────────────────────────────────────────────────────

const isBoxType = (t: number): boolean => t === HBOX || t === VBOX || t === VOID_HBOX || t === VOID_VBOX;

/** The page a node is on, or -1 for a node inside a form definition. */
export function pageOf(ix: SyncTexIndex, n: number): number {
  let p = n;
  while (ix.parent[p] >= 0) p = ix.parent[p];
  return ix.type[p] === SHEET ? ix.line[p] : -1;
}

/** Signed horizontal distance: positive when the node is to the right of the point. */
function hOrdered(ix: SyncTexIndex, hitH: number, n: number): number {
  let min: number;
  let max: number;
  switch (ix.type[n]) {
    case VBOX:
    case VOID_VBOX:
    case VOID_HBOX:
      min = ix.h[n];
      max = min + Math.abs(ix.w[n]);
      return hitH < min ? min - hitH : hitH > max ? max - hitH : 0;
    case HBOX: {
      const x = ix.hx[n];
      min = ix.hV[x];
      max = min + Math.abs(ix.wV[x]);
      return hitH < min ? min - hitH : hitH > max ? max - hitH : 0;
    }
    case KERN: {
      // A kern is recorded after the move, and there is no text inside it, so the distance is taken to its nearer edge.
      max = ix.w[n];
      if (max < 0) {
        min = ix.h[n];
        max = min - max;
      } else {
        min = -max;
        max = ix.h[n];
        min += max;
      }
      const med = Math.trunc((min + max) / 2);
      if (hitH < min) return min - hitH + 1;
      if (hitH > max) return max - hitH - 1;
      if (hitH > med) return max - hitH + 1;
      return min - hitH - 1;
    }
    case RULE:
    case GLUE:
    case MATH:
    case BOUNDARY:
    case BOX_BDRY:
      return ix.h[n] - hitH;
    default:
      return INT_MAX;
  }
}

/** Signed vertical distance: positive when the node is below the point. */
function vOrdered(ix: SyncTexIndex, hitV: number, n: number): number {
  let min: number;
  let max: number;
  switch (ix.type[n]) {
    case VBOX:
    case VOID_VBOX:
    case VOID_HBOX:
      min = ix.v[n];
      max = min + Math.abs(ix.dp[n]);
      min -= Math.abs(ix.ht[n]);
      break;
    case HBOX: {
      const x = ix.hx[n];
      min = ix.vV[x];
      max = min + Math.abs(ix.dpV[x]);
      min -= Math.abs(ix.htV[x]);
      break;
    }
    case RULE:
    case KERN:
    case GLUE:
    case MATH: {
      const p = ix.parent[n];
      min = ix.v[n];
      max = min + (p >= 0 ? Math.abs(ix.dp[p]) : 0);
      min -= p >= 0 ? Math.abs(ix.ht[p]) : 0;
      break;
    }
    default:
      return INT_MAX;
  }
  return hitV < min ? min - hitV : hitV > max ? max - hitV : 0;
}

const pointInBox = (ix: SyncTexIndex, hitH: number, hitV: number, n: number): boolean => n >= 0 && hOrdered(ix, hitH, n) === 0 && vOrdered(ix, hitV, n) === 0;

/** Distance from a point to a rectangle: zero inside, straight to the nearest edge beside it, L1 to the nearest corner otherwise. */
function distanceToBox(hitH: number, hitV: number, minH: number, maxH: number, minV: number, maxV: number): number {
  if (hitV < minV) {
    if (hitH < minH) return minV - hitV + minH - hitH;
    if (hitH <= maxH) return minV - hitV;
    return minV - hitV + hitH - maxH;
  }
  if (hitV <= maxV) {
    if (hitH < minH) return minH - hitH;
    if (hitH <= maxH) return 0;
    return hitH - maxH;
  }
  if (hitH < minH) return hitV - maxV + minH - hitH;
  if (hitH <= maxH) return hitV - maxV;
  return hitV - maxV + hitH - maxH;
}

function nodeDistance(ix: SyncTexIndex, hitH: number, hitV: number, n: number): number {
  if (n < 0) return INT_MAX;
  switch (ix.type[n]) {
    case VBOX: {
      const minH = ix.h[n];
      const minV = ix.v[n];
      return distanceToBox(hitH, hitV, minH, minH + Math.abs(ix.w[n]), minV - Math.abs(ix.ht[n]), minV + Math.abs(ix.dp[n]));
    }
    case HBOX: {
      const x = ix.hx[n];
      const minH = ix.hV[x];
      const minV = ix.vV[x];
      return distanceToBox(hitH, hitV, minH, minH + Math.abs(ix.wV[x]), minV - Math.abs(ix.htV[x]), minV + Math.abs(ix.dpV[x]));
    }
    case VOID_VBOX:
    case VOID_HBOX: {
      const minV = ix.v[n] - Math.abs(ix.ht[n]);
      const maxV = ix.v[n] + Math.abs(ix.dp[n]);
      const left = ix.h[n];
      const right = left + Math.abs(ix.w[n]);
      return Math.min(distanceToBox(hitH, hitV, left, left, minV, maxV), distanceToBox(hitH, hitV, right, right, minV, maxV));
    }
    case KERN: {
      const p = ix.parent[n];
      const maxV = ix.v[n];
      const minV = maxV - (p >= 0 ? Math.abs(ix.ht[p]) : 0);
      const a = ix.h[n];
      const b = a - ix.w[n];
      return Math.min(distanceToBox(hitH, hitV, a, a, minV, maxV), distanceToBox(hitH, hitV, b, b, minV, maxV));
    }
    case GLUE:
    case MATH:
    case BOUNDARY:
    case BOX_BDRY: {
      const p = ix.parent[n];
      const maxV = ix.v[n];
      const minV = maxV - (p >= 0 ? Math.abs(ix.ht[p]) : 0);
      return distanceToBox(hitH, hitV, ix.h[n], ix.h[n], minV, maxV);
    }
    default:
      return INT_MAX;
  }
}

/** Of two hboxes holding the point, the one with the smaller area. */
function smallestContainer(ix: SyncTexIndex, a: number, b: number): number {
  const ax = ix.hx[a];
  const bx = ix.hx[b];
  const aw = Math.abs(ix.wV[ax]);
  const bw = Math.abs(ix.wV[bx]);
  const aTall = Math.abs(ix.dpV[ax]) + Math.abs(ix.htV[ax]);
  const bTall = Math.abs(ix.dpV[bx]) + Math.abs(ix.htV[bx]);
  const aArea = aTall * aw;
  const bArea = bTall * bw;
  if (aArea < bArea) return a;
  if (aArea > bArea) return b;
  if (Math.abs(ix.w[a]) > Math.abs(ix.w[b])) return a;
  if (Math.abs(ix.w[a]) < Math.abs(ix.w[b])) return b;
  if (aTall < bTall) return a;
  if (aTall > bTall) return b;
  return a;
}

/** The deepest box under `n` that holds the point; inside a vbox, the nearest line when the point is between lines. */
function deepestContainer(ix: SyncTexIndex, hitH: number, hitV: number, n: number): number {
  if (n < 0 || ix.child[n] < 0) return -1;
  for (let c = ix.child[n]; c >= 0; c = ix.next[c]) {
    if (pointInBox(ix, hitH, hitV, c)) {
      const deep = deepestContainer(ix, hitH, hitV, c);
      if (deep >= 0) return deep;
    }
  }
  if (ix.type[n] === VBOX) {
    let best = -1;
    let bestD = INT_MAX;
    for (let c = ix.child[n]; c >= 0; c = ix.next[c]) {
      if (ix.child[c] >= 0) {
        const d = nodeDistance(ix, hitH, hitV, c);
        if (d <= bestD) {
          best = c;
          bestD = d;
        }
      }
    }
    if (best >= 0) return best;
  }
  return pointInBox(ix, hitH, hitV, n) ? n : -1;
}

interface Nd {
  node: number;
  distance: number;
}
const ND0 = (): Nd => ({ node: -1, distance: INT_MAX });

function deepestContainer3(ix: SyncTexIndex, hitH: number, hitV: number, n: number): Nd {
  if (n < 0 || ix.child[n] < 0) return ND0();
  for (let c = ix.child[n]; c >= 0; c = ix.next[c]) {
    const deep = deepestContainer3(ix, hitH, hitV, c);
    if (deep.node >= 0) return deep;
  }
  if (ix.type[n] === VBOX) {
    const best = ND0();
    for (let c = ix.child[n]; c >= 0; c = ix.next[c]) {
      if (ix.child[c] >= 0) {
        const d = nodeDistance(ix, hitH, hitV, c);
        if (d < best.distance) {
          best.node = c;
          best.distance = d;
        }
      }
    }
    if (best.node >= 0) return best;
  }
  return pointInBox(ix, hitH, hitV, n) ? { node: n, distance: 0 } : ND0();
}

/** The leaf under `n` closest to the point, boxes searched all the way down. */
function closestDeepChild(ix: SyncTexIndex, hitH: number, hitV: number, n: number): Nd {
  const best = ND0();
  if (n < 0) return best;
  for (let c = ix.child[n]; c >= 0; c = ix.next[c]) {
    const nd = isBoxType(ix.type[c]) ? closestDeepChild(ix, hitH, hitV, c) : { node: c, distance: nodeDistance(ix, hitH, hitV, c) };
    if (nd.distance < best.distance || (nd.distance === best.distance && (nd.node < 0 || ix.type[nd.node] !== KERN))) {
      best.node = nd.node;
      best.distance = nd.distance;
    }
  }
  return best;
}

/** What the reference reads as a node's own tag and line: zero for a node copied from a form. */
const dataTag = (ix: SyncTexIndex, n: number): number => (ix.proxy[n] ? 0 : ix.tag[n]);
const dataLine = (ix: SyncTexIndex, n: number): number => (ix.proxy[n] ? 0 : ix.line[n]);

interface NdPair {
  l: Nd;
  r: Nd;
}

/** The nodes just left and just right of the point among the children of an hbox. */
function closestChildrenInHbox(ix: SyncTexIndex, hitH: number, hitV: number, n: number): NdPair {
  const nds: NdPair = { l: ND0(), r: ND0() };
  if (ix.child[n] < 0) return nds;
  for (let c = ix.child[n]; c >= 0; c = ix.next[c]) {
    let d = hOrdered(ix, hitH, c);
    if (d > 0) {
      if (nds.r.distance > d) nds.r = { node: c, distance: d };
      else if (nds.r.distance === d && nds.r.node >= 0) {
        if (dataTag(ix, nds.r.node) === dataTag(ix, c) && dataLine(ix, nds.r.node) > dataLine(ix, c)) nds.r = { node: c, distance: d };
      }
    } else if (d === 0) {
      if (ix.child[c] >= 0) return closestChildrenInBox(ix, hitH, hitV, c);
      nds.l = { node: c, distance: d };
    } else {
      d = -d;
      if (nds.l.distance > d) nds.l = { node: c, distance: d };
      else if (nds.l.distance === d && nds.l.node >= 0) {
        if (dataTag(ix, nds.l.node) === dataTag(ix, c) && dataLine(ix, nds.l.node) > dataLine(ix, c)) nds.l = { node: c, distance: d };
      }
    }
  }
  for (const side of [nds.l, nds.r]) {
    if (side.node < 0) continue;
    const deep = deepestContainer3(ix, hitH, hitV, side.node);
    if (deep.node >= 0) {
      side.node = deep.node;
      side.distance = deep.distance;
    }
    const closest = closestDeepChild(ix, hitH, hitV, side.node);
    if (closest.node >= 0) side.node = closest.node;
  }
  return nds;
}

function closestChildrenInBox(ix: SyncTexIndex, hitH: number, hitV: number, n: number): NdPair {
  // Only an hbox is searched: for a vbox the reference returns nothing here and the caller answers with the box itself.
  if (n >= 0 && ix.child[n] >= 0 && ix.type[n] === HBOX) return closestChildrenInHbox(ix, hitH, hitV, n);
  return { l: ND0(), r: ND0() };
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF → source, as `synctex edit` answers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The nodes `synctex edit -o page:x:y:file` reports for a point, best first: one, or two when the nodes on either side of the point come from different lines. `contained` says whether some hbox held the point.
 */
export function editQueryNodes(ix: SyncTexIndex, page: number, xBp: number, yBp: number): { nodes: number[]; contained: boolean; distances: number[] } {
  const none = { nodes: [], contained: false, distances: [] };
  if (page < 1 || page > ix.pageCount || !(ix.unit > 0)) return none;
  const sheet = ix.sheets[page];
  if (sheet < 0) return none;
  const hitH = Math.trunc((xBp - ix.xOffset) / ix.unit);
  const hitV = Math.trunc((yBp - ix.yOffset) / ix.unit);

  // Hboxes of the page, last closed first, form copies ahead of them.
  let container = -1;
  const visit = (n: number) => {
    if (!pointInBox(ix, hitH, hitV, n)) return;
    container = container < 0 ? n : smallestContainer(ix, n, container);
  };
  const copies = ix.proxyHboxes.get(page);
  if (copies) for (let i = copies.length - 1; i >= 0; i--) visit(copies[i]);
  for (let i = ix.hboxStart[page + 1] - 1; i >= ix.hboxStart[page]; i--) visit(ix.hboxOrder[i]);

  let nds: NdPair;
  let fallback = -1;
  const contained = container >= 0;
  if (contained) {
    fallback = deepestContainer(ix, hitH, hitV, container);
    nds = closestChildrenInBox(ix, hitH, hitV, fallback);
  } else {
    const first = ix.child[sheet];
    if (first < 0) return none;
    fallback = first;
    nds = { l: closestDeepChild(ix, hitH, hitV, first), r: ND0() };
  }

  if (nds.r.node >= 0 && nds.l.node >= 0) {
    if (dataTag(ix, nds.r.node) !== dataTag(ix, nds.l.node) || dataLine(ix, nds.r.node) !== dataLine(ix, nds.l.node)) {
      // Two lines meet here: the earlier line first, the nearer node when it is the same line.
      let l = nds.l;
      let r = nds.r;
      if (dataLine(ix, r.node) < dataLine(ix, l.node) || (dataLine(ix, r.node) === dataLine(ix, l.node) && l.distance > r.distance)) {
        const t = l;
        l = r;
        r = t;
      }
      return { nodes: [l.node, r.node], contained, distances: [l.distance, r.distance] };
    }
    const nearer = nds.l.distance > nds.r.distance ? nds.r : nds.l;
    return { nodes: [nearer.node], contained, distances: [nearer.distance] };
  }
  if (nds.r.node >= 0) return { nodes: [nds.r.node], contained, distances: [nds.r.distance] };
  if (nds.l.node >= 0) return { nodes: [nds.l.node], contained, distances: [nds.l.distance] };
  return fallback >= 0 ? { nodes: [fallback], contained, distances: [0] } : none;
}

export interface EditResult {
  tag: number;
  /** Input name as TeX recorded it. */
  input: string;
  line: number;
}

/** `synctex edit` for a point in PDF points from the page's top-left. */
export function editQuery(ix: SyncTexIndex, page: number, xBp: number, yBp: number): EditResult[] {
  return editQueryNodes(ix, page, xBp, yBp).nodes.map((n) => ({
    tag: ix.tag[n],
    input: ix.inputByTag.get(ix.tag[n])?.name ?? "",
    line: ix.line[n],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Source → PDF, as `synctex view` answers
// ─────────────────────────────────────────────────────────────────────────────

interface Handle {
  target: number;
  child: Handle | null;
  sibling: Handle | null;
  weight: number;
}

/** Walk one hash list for the nodes of (tag, line), grouped by page the way the reference builds its result tree. */
function collectFriends(ix: SyncTexIndex, tag: number, line: number, excludeBoxes: boolean): Handle | null {
  let first: Handle | null = null;
  let target = ix.friendHead[(tag + line) % FRIEND_LISTS];
  const matches = (n: number) => !(excludeBoxes && isBoxType(ix.type[n])) && ix.tag[n] === tag && ix.line[n] === line;
  const handle = (n: number): Handle => ({ target: n, child: null, sibling: null, weight: 0 });

  while (target >= 0 && !matches(target)) target = ix.friendNext[target];
  if (target < 0) return null;
  first = handle(target);
  const page = pageOf(ix, target);
  for (target = ix.friendNext[target]; target >= 0; target = ix.friendNext[target]) {
    if (!matches(target)) continue;
    const result = handle(target);
    if (pageOf(ix, target) === page) {
      result.child = first;
      first = result;
      continue;
    }
    // A second page: from here on each match joins the list of its own page.
    first.sibling = result;
    for (target = ix.friendNext[target]; target >= 0; target = ix.friendNext[target]) {
      if (!matches(target)) continue;
      const more = handle(target);
      const p = pageOf(ix, target);
      let same: Handle | null = first;
      for (;;) {
        if (pageOf(ix, same.target) === p) {
          more.child = same.child;
          same.child = more;
          break;
        }
        if (same.sibling) {
          same = same.sibling;
          continue;
        }
        more.sibling = first;
        first = more;
        break;
      }
    }
    return first;
  }
  return first;
}

/** The reference's per-page ordering: one node per parent hbox, the parents holding most of the line first. */
function sortPageChain(ix: SyncTexIndex, head: Handle): { node: Handle; count: number } {
  const hasWeight = (n: number) => n >= 0 && ix.type[n] === HBOX && !ix.proxy[n];
  const parentWeight = new Map<number, number>();
  const tag = ix.tag[head.target];
  const line = ix.line[head.target];
  for (let hd: Handle | null = head; hd; hd = hd.child) {
    const p = ix.parent[hd.target];
    let weight = hasWeight(p) ? (parentWeight.get(p) ?? 0) : 0;
    if (weight === 0) {
      for (let c = p >= 0 ? ix.child[p] : -1; c >= 0; c = ix.next[c]) if (ix.tag[c] === tag && ix.line[c] === line) weight++;
      hd.weight = weight;
      if (hasWeight(p)) parentWeight.set(p, weight);
    }
  }
  let hd: Handle | null = head.child;
  head.child = null;
  let result = head;
  while (hd) {
    const nextHandle: Handle | null = hd.child;
    if (hd.weight > result.weight) {
      hd.child = result;
      result = hd;
    } else if (hd.weight !== 0) {
      let at = result;
      while (at.child) {
        at = at.child;
        if (hd.weight < at.weight) continue;
        break;
      }
      hd.child = at.child;
      at.child = hd;
    }
    hd = nextHandle;
  }
  let count = 1;
  for (let at = result; at.child; at = at.child) {
    if (at.child.weight === 0) {
      at.child = null;
      break;
    }
    count++;
  }
  return { node: result, count };
}

/**
 * The nodes `synctex view -i line:0:file` reports, in its order. Like the CLI, a line without output is answered by its nearest neighbor, tried as line + 1, line − 1, line + 2, and so on.
 */
export function displayQueryNodes(ix: SyncTexIndex, tag: number, line: number, pageHint = 0): number[] {
  const input = ix.inputByTag.get(tag);
  if (!input) return [];
  const maxLine = input.maxLine;
  if (line > maxLine) line = maxLine;
  let offset = 1;
  for (let tries = 100; tries > 0; tries--) {
    if (line > maxLine) continue;
    if (tag + line >= 0) {
      const found = collectFriends(ix, tag, line, true) ?? collectFriends(ix, tag, line, false);
      if (found) {
        let nextSibling = found.sibling;
        found.sibling = null;
        let bestMatch = Math.abs(pageHint - pageOf(ix, found.target));
        let sorted = sortPageChain(ix, found);
        let total = sorted.count;
        let result = sorted.node;
        while (nextSibling) {
          const sibling: Handle = nextSibling;
          nextSibling = sibling.sibling;
          sibling.sibling = null;
          sorted = sortPageChain(ix, sibling);
          total += sorted.count;
          const group = sorted.node;
          const match = Math.abs(pageHint - pageOf(ix, group.target));
          if (match < bestMatch) {
            group.sibling = result;
            result = group;
            bestMatch = match;
          } else {
            group.sibling = result.sibling;
            result.sibling = group;
          }
        }
        const out: number[] = [];
        let top: Handle | null = result;
        let at: Handle | null = result;
        while (at && out.length < total) {
          out.push(at.target);
          if (at.child) at = at.child;
          else {
            top = top ? top.sibling : null;
            at = top;
          }
        }
        return out;
      }
    }
    line += offset;
    offset = offset < 0 ? -(offset - 1) : -(offset + 1);
    if (line <= 0) {
      line += offset;
      offset = offset < 0 ? -(offset - 1) : -(offset + 1);
    }
  }
  return [];
}

const meanLineOf = (ix: SyncTexIndex, n: number): number => {
  if (ix.type[n] === HBOX) return ix.mean[ix.hx[n]];
  const p = ix.parent[n];
  if (p >= 0 && ix.type[p] === HBOX) return ix.mean[ix.hx[p]];
  return ix.line[n];
};

/** Above this width or height (about 22.8 pt) the reference stops looking for a larger enclosing box. */
const bigBoxBound = (ix: SyncTexIndex): number => Math.trunc(1500000 / (ix.magnification / 1000));

/** The box the reference highlights for a node: the highest enclosing hbox whose mean line stays within one of the node's. */
function visibleBox(ix: SyncTexIndex, node: number): number {
  let n = node;
  if (!isBoxType(ix.type[n])) {
    const p = ix.parent[n];
    if (p < 0) return n;
    n = p;
  }
  const bound = bigBoxBound(ix);
  const mean = meanLineOf(ix, n);
  for (let p = ix.parent[n]; p >= 0; p = ix.parent[p]) {
    if (ix.type[p] !== HBOX) continue;
    if (Math.abs(mean - meanLineOf(ix, p)) > 1) return n;
    if (ix.w[p] > bound) return p;
    if (ix.ht[p] + ix.dp[p] > bound) return p;
    n = p;
  }
  return n;
}

export interface ViewResult {
  page: number;
  /** The node itself. */
  x: number;
  y: number;
  /** Left edge and bottom of the box to highlight, then its width and its height above the bottom. */
  h: number;
  v: number;
  W: number;
  H: number;
}

function viewResultOf(ix: SyncTexIndex, n: number): ViewResult {
  const t = ix.type[n];
  const width = ix.w[n];
  const nodeH = t === KERN ? (width > 0 ? ix.h[n] - width : ix.h[n]) : t === RULE ? (width > 0 ? ix.h[n] : ix.h[n] - width) : ix.h[n];
  const box = visibleBox(ix, n);
  const isH = ix.type[box] === HBOX;
  const bx = ix.hx[box];
  const boxH = isH ? ix.hV[bx] : ix.h[box];
  const boxV = isH ? ix.vV[bx] : ix.v[box];
  const boxW = isH ? ix.wV[bx] : ix.w[box];
  const boxHt = isH ? ix.htV[bx] : ix.ht[box];
  const boxDp = isH ? ix.dpV[bx] : ix.dp[box];
  return {
    page: pageOf(ix, n),
    x: nodeH * ix.unit + ix.xOffset,
    y: ix.v[n] * ix.unit + ix.yOffset,
    h: boxH * ix.unit + ix.xOffset,
    v: boxV * ix.unit + ix.yOffset + boxDp * ix.unit,
    W: boxW * ix.unit,
    H: boxHt * ix.unit + boxDp * ix.unit,
  };
}

/** `synctex view` for a tag and line. */
export function displayQuery(ix: SyncTexIndex, tag: number, line: number, pageHint = 0): ViewResult[] {
  return displayQueryNodes(ix, tag, line, pageHint).map((n) => viewResultOf(ix, n));
}

// ─────────────────────────────────────────────────────────────────────────────
// Input names ↔ project paths
// ─────────────────────────────────────────────────────────────────────────────

/** `/a/./b/../c.tex` → `/a/c.tex`, with backslashes turned into slashes. */
export function normalizeTexPath(name: string): string {
  const absolute = /^([a-zA-Z]:)?[\\/]/.test(name);
  const out: string[] = [];
  for (const part of name.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(part);
  }
  return (absolute ? "/" : "") + out.join("/");
}

export interface SyncFileMap {
  /** Project path for an input tag; undefined for a file that is not in the project (a class, a package, a generated .toc). */
  pathOfTag: Map<number, string>;
  /** Every tag a project file was read under: one per \input, so a file read twice has two. */
  tagsOfPath: Map<string, number[]>;
}

/**
 * Match TeX's input names to project paths. TeX records what it opened: `/tmp/job/./main.tex`, `/tmp/job/./chapters/intro.tex`, `./a.tex`, or an absolute path into the TeX tree. The job folder is read off the main file's own record, and only names under it can be project files, so `article.cls` in the TeX tree never matches a project file that happens to be called the same.
 */
export function mapInputsToProject(ix: SyncTexIndex, projectPaths: Iterable<string>, mainFile?: string): SyncFileMap {
  const byNormal = new Map<string, string>();
  for (const p of projectPaths) byNormal.set(normalizeTexPath(p).replace(/^\/+/, ""), p);

  const names = ix.inputs.map((input) => ({ tag: input.tag, name: normalizeTexPath(input.name) }));
  let root: string | null = null;
  const main = mainFile ? normalizeTexPath(mainFile).replace(/^\/+/, "") : null;
  if (main) {
    for (const { name } of names) {
      if (name === main) {
        root = "";
        break;
      }
      if (name.endsWith("/" + main)) {
        root = name.slice(0, name.length - main.length);
        break;
      }
    }
  }
  if (root === null) {
    // No main file to go by: the folder of the first input that is a project file by its longest suffix.
    for (const { name } of names) {
      let best = "";
      for (const p of byNormal.keys()) if ((name === p || name.endsWith("/" + p)) && p.length > best.length) best = p;
      if (best) {
        root = name.slice(0, name.length - best.length);
        break;
      }
    }
  }

  const pathOfTag = new Map<number, string>();
  const tagsOfPath = new Map<string, number[]>();
  for (const { tag, name } of names) {
    let relative: string | null = null;
    if (!name.startsWith("/")) relative = name;
    else if (root) relative = name.startsWith(root) ? name.slice(root.length) : null;
    if (relative === null) continue;
    const path = byNormal.get(relative);
    if (path === undefined) continue;
    pathOfTag.set(tag, path);
    const tags = tagsOfPath.get(path);
    if (tags) tags.push(tag);
    else tagsOfPath.set(path, [tag]);
  }
  return { pathOfTag, tagsOfPath };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages TeX turned (pdflscape)
// ─────────────────────────────────────────────────────────────────────────────

export interface PageGeometry {
  /** The page box [x0, y0, x1, y1] in PDF user space, as pdf.js reports `page.view`. */
  view: readonly number[];
  /** Clockwise rotation the page is shown with: 0, 90, 180, or 270. */
  rotation: number;
}

interface TurnedContent {
  /** The box holding everything that was turned. */
  box: number;
  /** The pivot, in scaled points. */
  px: number;
  py: number;
  /** +1 when the content was turned a quarter counter-clockwise (the page is then shown turned clockwise), -1 for the other way. */
  sign: number;
}

/**
 * The turned part of a landscape page, if the page has one.
 *
 * A landscape page (pdflscape) is a portrait page whose body TeX typesets upright and then turns a quarter with a PDF transformation, plus a flag telling the viewer to show the page turned back. SyncTeX never sees the transformation: its records describe the body upright, hanging off the pivot and running far past the page's right edge. That overhang is how the body is recognized, and its reference point is the pivot.
 */
function turnedContentsOf(ix: SyncTexIndex, page: number, geometry: PageGeometry | undefined): TurnedContent[] {
  if (!geometry) return [];
  const turns = ((Math.round(geometry.rotation / 90) % 4) + 4) % 4;
  if (turns !== 1 && turns !== 3) return [];
  const sheet = page >= 1 && page <= ix.pageCount ? ix.sheets[page] : -1;
  if (sheet < 0) return [];
  let perPage = turnedCache.get(ix);
  if (!perPage) turnedCache.set(ix, (perPage = new Map()));
  const key = `${page}:${turns}:${geometry.view[2]}`;
  const known = perPage.get(key);
  if (known) return known;

  const pageRight = (geometry.view[2] - ix.xOffset + 20) / ix.unit;
  const hasText = (n: number): boolean => {
    for (let c = ix.child[n]; c >= 0; c = ix.next[c]) if (isLeaf(ix.type[c]) || (ix.child[c] >= 0 && hasText(c))) return true;
    return false;
  };
  // In output order, outermost first: a box that sticks out of the page and has text in it. An empty box may stick out for other reasons (the unused second column of a two-column layout).
  const found: TurnedContent[] = [];
  const walk = (n: number) => {
    for (let c = ix.child[n]; c >= 0; c = ix.next[c]) {
      if (ix.type[c] !== HBOX && ix.type[c] !== VBOX) continue;
      // The pivot is the box's reference point: its left end on the baseline, which for a vbox without depth is its bottom.
      if (ix.h[c] + ix.w[c] > pageRight && hasText(c)) found.push({ box: c, px: ix.h[c], py: boxBottom(ix, c) - Math.abs(ix.dp[c]), sign: turns === 1 ? 1 : -1 });
      else walk(c);
    }
  };
  walk(sheet);
  perPage.set(key, found);
  return found;
}
const turnedCache = new WeakMap<SyncTexIndex, Map<string, TurnedContent[]>>();

/** Top and bottom of a box as it really sits on the page, whichever way the engine recorded vboxes. */
const boxTop = (ix: SyncTexIndex, n: number): number => (ix.type[n] === VBOX && ix.vboxFromTop ? ix.v[n] : ix.v[n] - Math.abs(ix.ht[n]));
const boxBottom = (ix: SyncTexIndex, n: number): number => (ix.type[n] === VBOX && ix.vboxFromTop ? ix.v[n] + Math.abs(ix.ht[n]) + Math.abs(ix.dp[n]) : ix.v[n] + Math.abs(ix.dp[n]));

const isInside = (ix: SyncTexIndex, n: number, box: number): boolean => {
  for (let p = n; p >= 0; p = ix.parent[p]) if (p === box) return true;
  return false;
};

// ─────────────────────────────────────────────────────────────────────────────
// PDF → source for the editor
// ─────────────────────────────────────────────────────────────────────────────

export interface InverseHit {
  tag: number;
  line: number;
  /** Everything SyncTeX offers for this click, best first: the node on each side of the click, then the other lines on the same PDF line. The clicked word is looked for in these lines only. */
  candidates: { tag: number; line: number }[];
  /** How far through the output of `line` the click is, 0 to 1: tells apart a word that occurs twice on a long source line. */
  fraction: number;
  /** Whether a box held the click; false for a margin, where the nearest record answers. */
  contained: boolean;
  /** True when the record under the click belongs to a file outside the project and the answer is the nearest record of a project file instead. */
  rerouted: boolean;
}

const isLeaf = (t: number): boolean => t === KERN || t === GLUE || t === MATH || t === BOUNDARY;

/** The nearest record of a project file around `n` in output order: before it first (the call site), then after. */
function nearestProjectNode(ix: SyncTexIndex, n: number, inProject: (tag: number) => boolean): number {
  let sheet = n;
  while (ix.parent[sheet] >= 0) sheet = ix.parent[sheet];
  const page = ix.type[sheet] === SHEET ? ix.line[sheet] : -1;
  if (page < 0) return -1;
  // A page's own nodes follow its sheet node back to back; a node copied from a form sits past the last page and is searched from its place of use.
  let at = n;
  while (ix.proxy[at] && ix.parent[at] >= 0) at = ix.parent[at];
  let endOfPage = ix.count;
  for (let p = page + 1; p <= ix.pageCount; p++) {
    if (ix.sheets[p] >= 0) {
      endOfPage = ix.sheets[p];
      break;
    }
  }
  const ok = (i: number, leavesOnly: boolean) => !ix.proxy[i] && ix.line[i] > 0 && (leavesOnly ? isLeaf(ix.type[i]) : ix.type[i] !== SHEET && ix.type[i] !== FORM && ix.type[i] !== REF) && inProject(ix.tag[i]);
  for (const leavesOnly of [true, false]) {
    for (let i = at - 1; i > sheet; i--) if (ok(i, leavesOnly)) return i;
    for (let i = at + 1; i < endOfPage; i++) if (ok(i, leavesOnly)) return i;
  }
  return -1;
}

/** Share of the records of (tag, line) that come at or before node `n` in output order. */
function fractionThroughLine(ix: SyncTexIndex, n: number): number {
  const tag = ix.tag[n];
  const line = ix.line[n];
  if (tag + line < 0) return 0;
  let before = 0;
  let total = 0;
  for (let f = ix.friendHead[(tag + line) % FRIEND_LISTS]; f >= 0; f = ix.friendNext[f]) {
    if (ix.tag[f] !== tag || ix.line[f] !== line) continue;
    total++;
    if (f < n) before++;
  }
  return total > 1 ? before / (total - 1) : 0;
}

/**
 * Where in the source a point of the PDF comes from. `inProject` says which input tags are files the person can open; when the record under the click is from anywhere else (a package, the class, a generated .toc or .bbl), the answer moves to the nearest record of a project file, which is where the text was called from.
 */
export function inverseSearch(ix: SyncTexIndex, page: number, xBp: number, yBp: number, inProject?: (tag: number) => boolean, geometry?: PageGeometry): InverseHit | null {
  let query = editQueryNodes(ix, page, xBp, yBp);
  // On a landscape page the click is first read as a point of the turned body: turned back, it is where SyncTeX recorded that text.
  for (const turned of turnedContentsOf(ix, page, geometry)) {
    const ax = (xBp - ix.xOffset) / ix.unit;
    const ay = (yBp - ix.yOffset) / ix.unit;
    const ux = turned.px - turned.sign * (ay - turned.py);
    const uy = turned.py + turned.sign * (ax - turned.px);
    const b = turned.box;
    if (ux >= ix.h[b] && ux <= ix.h[b] + ix.w[b] && uy >= boxTop(ix, b) && uy <= boxBottom(ix, b)) {
      const upright = editQueryNodes(ix, page, ux * ix.unit + ix.xOffset, uy * ix.unit + ix.yOffset);
      if (upright.nodes.length > 0 && isInside(ix, upright.nodes[0], b)) {
        query = upright;
        break;
      }
    }
  }
  if (query.nodes.length === 0) return null;
  const contained = query.contained;
  // pdfTeX and XeTeX stamp a rule with the line being read when the page was shipped out, and the boundaries of a box that holds only a rule inherit that line. The box around the rule knows better, and failing that the record just before it.
  const fromRule = (n: number): boolean => {
    if (ix.type[n] === RULE) return true;
    if (ix.type[n] !== BOX_BDRY) return false;
    const box = ix.parent[n];
    if (box < 0) return false;
    let rules = 0;
    for (let c = ix.child[box]; c >= 0; c = ix.next[c]) {
      if (ix.type[c] === RULE) rules++;
      else if (ix.type[c] !== BOX_BDRY) return false;
    }
    return rules > 0;
  };
  const reliable = (n: number): number => {
    if (!fromRule(n)) return n;
    const box = ix.parent[n];
    if (box >= 0 && ix.type[box] === HBOX && ix.line[box] > 0) return box;
    for (let i = n - 1; i >= 0 && ix.type[i] !== SHEET; i--) if (isLeaf(ix.type[i]) && ix.line[i] > 0) return i;
    return n;
  };
  let nodes = query.nodes.map(reliable);
  // Two records from places far apart in the source (running text beside an equation number, a margin note beside a paragraph): the one nearer the click is the one meant. Neighboring lines keep the reference's order, the earlier line first.
  if (nodes.length === 2 && (ix.tag[nodes[0]] !== ix.tag[nodes[1]] || Math.abs(ix.line[nodes[0]] - ix.line[nodes[1]]) > 2) && query.distances[1] < query.distances[0]) nodes = [nodes[1], nodes[0]];
  nodes = nodes.filter((n, i, all) => all.indexOf(n) === i);
  let rerouted = false;
  let picks = nodes;
  if (inProject) {
    const own = nodes.filter((n) => inProject(ix.tag[n]) && ix.line[n] > 0);
    if (own.length > 0) picks = own;
    else {
      const near = nearestProjectNode(ix, nodes[0], inProject);
      if (near < 0) return null;
      picks = [near];
      rerouted = true;
    }
  }
  const primary = picks[0];
  const candidates: { tag: number; line: number }[] = [];
  const add = (tag: number, line: number) => {
    if (line > 0 && !candidates.some((c) => c.tag === tag && c.line === line)) candidates.push({ tag, line });
  };
  for (const n of picks) add(ix.tag[n], ix.line[n]);
  if (picks.length === 2 && ix.tag[picks[0]] === ix.tag[picks[1]]) {
    const a = Math.min(ix.line[picks[0]], ix.line[picks[1]]);
    const b = Math.max(ix.line[picks[0]], ix.line[picks[1]]);
    if (b - a <= 4) for (let l = a + 1; l < b; l++) add(ix.tag[primary], l);
  }
  if (!rerouted) {
    const box = ix.parent[primary];
    if (box >= 0 && ix.type[box] === HBOX) {
      const lines: number[] = [];
      for (let c = ix.child[box]; c >= 0; c = ix.next[c]) if (ix.tag[c] === ix.tag[primary] && !lines.includes(ix.line[c])) lines.push(ix.line[c]);
      lines.sort((a, b) => Math.abs(a - ix.line[primary]) - Math.abs(b - ix.line[primary]));
      for (const l of lines.slice(0, 12)) add(ix.tag[primary], l);
    }
  }
  return { tag: ix.tag[primary], line: ix.line[primary], candidates, fraction: fractionThroughLine(ix, primary), contained, rerouted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Source → PDF for the viewer
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncRect {
  page: number;
  /** PDF points from the page's top-left corner, y down. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ForwardHit {
  /** The page to scroll to. */
  page: number;
  /** Highlights on every page the line appears on, in reading order. */
  rects: SyncRect[];
  /** Index into `rects` of the one to bring into view. */
  primary: number;
  /** The line that was found: the requested one, or the nearest line with output. */
  line: number;
  /** False when the requested line has no output of its own. */
  exact: boolean;
}

const lineKey = (tag: number, line: number): number => tag * 4194304 + line;

/**
 * Which lines have something to show, and the boxes that stand for a line.
 *
 * Rule records are left out: pdfTeX and XeTeX stamp a rule with the line being read when the page was shipped out, not the line that made it, so a rule says nothing about its source. The box around it does.
 */
function lineTables(ix: SyncTexIndex): LineTables {
  if (ix.tables) return ix.tables;
  const sets = new Map<number, Set<number>>();
  const note = (tag: number, line: number) => {
    let set = sets.get(tag);
    if (!set) sets.set(tag, (set = new Set()));
    set.add(line);
  };
  for (let b = 0; b < FRIEND_LISTS; b++) {
    for (let n = ix.friendHead[b]; n >= 0; n = ix.friendNext[n]) {
      // A node whose line changed after it was filed sits in the wrong list and is never found, here or by the CLI.
      if ((ix.tag[n] + ix.line[n]) % FRIEND_LISTS !== b || ix.type[n] === RULE) continue;
      note(ix.tag[n], ix.line[n]);
    }
  }
  const boxes = new Map<number, number[]>();
  for (let n = 0; n < ix.count; n++) {
    if (!isBoxType(ix.type[n]) || ix.line[n] <= 0) continue;
    const p = ix.parent[n];
    // Only a box that sits in a line of text was made by its own source line. A box in a vertical list is a paragraph line or a page part, stamped with wherever TeX was when it was packaged.
    if (p < 0 || ix.type[p] !== HBOX || ix.w[n] === 0 || ix.ht[n] + ix.dp[n] <= 0) continue;
    const key = lineKey(ix.tag[n], ix.line[n]);
    const list = boxes.get(key);
    if (list) list.push(n);
    else boxes.set(key, [n]);
    note(ix.tag[n], ix.line[n]);
  }
  const lines = new Map<number, Int32Array>();
  for (const [t, set] of sets) lines.set(t, Int32Array.from(set).sort());
  ix.tables = { lines, boxes };
  return ix.tables;
}

/** The hbox whose frame a highlight takes: `box` itself when it is line-sized, else the nearest line-sized hbox around it from the same stretch of source. */
function frameBox(ix: SyncTexIndex, box: number): number {
  const bound = bigBoxBound(ix);
  const mean = meanLineOf(ix, box);
  let n = box;
  while (ix.w[n] <= bound && ix.ht[n] + ix.dp[n] <= bound) {
    let p = ix.parent[n];
    while (p >= 0 && ix.type[p] !== HBOX) p = ix.parent[p];
    if (p < 0 || Math.abs(mean - meanLineOf(ix, p)) > 1) break;
    n = p;
  }
  return n;
}

/** Where a node's own extent ends. A kern or glue is recorded after the move, so `h` is already its right end. */
const rightEdge = (ix: SyncTexIndex, n: number): number => {
  if (ix.type[n] === HBOX) {
    const x = ix.hx[n];
    return Math.max(ix.hV[x], ix.hV[x] + ix.wV[x]);
  }
  if (isBoxType(ix.type[n]) || ix.type[n] === RULE) return Math.max(ix.h[n], ix.h[n] + ix.w[n]);
  return ix.h[n];
};
/** Where a node's own extent starts: for a kern, before the move. */
const leftEdge = (ix: SyncTexIndex, n: number): number => {
  const t = ix.type[n];
  if (t === HBOX) {
    const x = ix.hx[n];
    return Math.min(ix.hV[x], ix.hV[x] + ix.wV[x]);
  }
  if (t === KERN) return ix.w[n] > 0 ? ix.h[n] - ix.w[n] : ix.h[n];
  if (isBoxType(t) || t === RULE) return Math.min(ix.h[n], ix.h[n] + ix.w[n]);
  return ix.h[n];
};

export interface ForwardOptions {
  /** Box and rotation of a page as the viewer knows them: lets highlights on a landscape page follow the turned text. */
  pageGeometry?: (page: number) => PageGeometry | undefined;
  /** The page on screen: a file read twice shows the copy nearest to it. */
  pageHint?: number;
  /** How far along the source line the cursor is, 0 to 1: picks which piece of a line that wraps over several PDF lines or pages to bring into view. */
  fraction?: number;
}

interface Ink {
  /** The row the piece belongs to: pieces of one row are shown as one highlight. */
  row: number;
  page: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  first: number;
}

/** The outermost box of the horizontal list a box sits in: cells of one table row or one equation line share it, columns and paragraphs do not. */
function rowOf(ix: SyncTexIndex, box: number): number {
  let n = box;
  for (let p = ix.parent[n]; p >= 0 && ix.type[p] === HBOX; p = ix.parent[p]) n = p;
  return n;
}

/** Whether everything recorded inside a box comes from one source line. */
function isAllFromLine(ix: SyncTexIndex, box: number, tags: Set<number>, line: number): boolean {
  let budget = 4000;
  const walk = (n: number): boolean => {
    for (let c = ix.child[n]; c >= 0; c = ix.next[c]) {
      if (--budget < 0) return false;
      const t = ix.type[c];
      if (t === KERN || t === GLUE || t === MATH || t === BOUNDARY) {
        if (ix.line[c] !== line || !tags.has(ix.tag[c])) return false;
      } else if (ix.child[c] >= 0 && !walk(c)) return false;
    }
    return true;
  };
  return walk(box);
}

/**
 * What one source line put on paper, as rectangles in scaled points.
 *
 * SyncTeX records no characters, only what lies between them: a kern or glue for each space (recorded after the move, carrying the line being read when the space was made), an `x` where a run of characters ends (pdfTeX and LuaTeX), math switches, rules, and boxes. So the text of a line is what precedes each of its `x` records and what follows each of its space records up to the next record. Records with nothing after them are layout, not text: the glue that centers a line, or the fill at the end of a paragraph, which carries the number of the blank line that ended it. Those leave no stretch, so such a line counts as having no output.
 *
 * A box set inside a line of text whose whole content comes from this line (an image, a \rule, an \mbox, a cell of an equation) is taken whole, at its own size.
 */
function inkOfLine(ix: SyncTexIndex, tags: Set<number>, line: number, nodes: number[]): Ink[] {
  const EPSILON = Math.round(0.5 / ix.unit);
  const pieces: Ink[] = [];
  const matches = (n: number) => tags.has(ix.tag[n]) && ix.line[n] === line;

  // Whole boxes first, outermost only.
  const whole = new Set<number>();
  const insideWhole = (n: number): boolean => {
    for (let p = n; p >= 0 && ix.type[p] !== SHEET; p = ix.parent[p]) if (whole.has(p)) return true;
    return false;
  };
  const tables = lineTables(ix);
  for (const tag of tags) {
    for (const box of tables.boxes.get(lineKey(tag, line)) ?? []) {
      if (pageOf(ix, box) < 1 || insideWhole(ix.parent[box]) || !isAllFromLine(ix, box, tags, line)) continue;
      whole.add(box);
      pieces.push({
        row: rowOf(ix, box),
        page: pageOf(ix, box),
        left: Math.min(ix.h[box], ix.h[box] + ix.w[box]),
        right: Math.max(ix.h[box], ix.h[box] + ix.w[box]),
        top: boxTop(ix, box),
        bottom: boxBottom(ix, box),
        first: box,
      });
    }
  }

  const seen = new Set<number>();
  for (const node of nodes) {
    const box = ix.parent[node];
    if (box < 0 || ix.type[box] !== HBOX || seen.has(box)) continue;
    seen.add(box);
    if (insideWhole(box)) continue;
    let left = Infinity;
    let right = -Infinity;
    const add = (a: number, b: number) => {
      if (b - a <= EPSILON) return;
      if (a < left) left = a;
      if (b > right) right = b;
    };
    let prev = -1;
    /** The last record before `c` that is not a kern of no width to speak of (under a sixteenth of a point). Such kerns are bookkeeping (a margin note's anchor, an index entry), not spaces, and carry lines of their own. */
    let solid = -1;
    let firstReal = true;
    for (let c = ix.child[box]; c >= 0; prev = c, c = ix.next[c]) {
      const t = ix.type[c];
      if (t === BOX_BDRY) continue;
      const leading = firstReal;
      firstReal = false;
      const before = solid;
      if (!(t === KERN && Math.abs(ix.w[c]) < 4096)) solid = c;
      if (t === BOUNDARY) {
        // The text before an `x` goes with the space that precedes it: the engine stamps the `x` with whatever it recorded last, which is that space unless bookkeeping came between.
        const space = before >= 0 && (ix.type[before] === KERN || ix.type[before] === GLUE) ? before : c;
        if (prev >= 0 && matches(space)) add(rightEdge(ix, prev), ix.h[c]);
        continue;
      }
      if (!matches(c)) continue;
      if (t === KERN || t === GLUE || t === MATH) {
        const after = ix.next[c];
        const afterType = after >= 0 ? ix.type[after] : -1;
        if (ix.marksTextEnds) {
          // Text always ends in an `x` here, so only a stretch up to something with a known left edge can be text. Up to a glue or the end of the box it is the glue itself: the fill that centers a line or ends a paragraph.
          if (after >= 0 && afterType !== GLUE && afterType !== BOX_BDRY && afterType !== BOUNDARY && !whole.has(after)) add(ix.h[c], leftEdge(ix, after));
        } else {
          // No `x` records to go by: text at the very start of a box goes with the first record, and text runs up to whatever comes next. A box that holds something recorded larger than it is drawn (a scaled image) ends where the box says, not where its content does.
          if (leading && prev >= 0 && t !== MATH) add(rightEdge(ix, prev), leftEdge(ix, c));
          if (after >= 0) add(ix.h[c], afterType === BOX_BDRY && ix.w[box] > 0 ? Math.min(ix.h[after], Math.max(ix.h[c], ix.h[box] + ix.w[box])) : leftEdge(ix, after));
        }
      }
    }
    if (left === Infinity) continue;
    const frame = frameBox(ix, box);
    const fx = ix.hx[frame];
    // Across, the box grown to hold its content: text often overflows a box that is too narrow for it (a margin note). Up and down, the box's own height when it has one: the grown height overshoots around a scaled image, whose content is recorded unscaled.
    const frameLeft = Math.min(ix.hV[fx], ix.hV[fx] + ix.wV[fx]);
    const frameRight = Math.max(ix.hV[fx], ix.hV[fx] + ix.wV[fx]);
    const tall = ix.ht[frame] + ix.dp[frame] > 0;
    const clippedLeft = Math.max(frameLeft, Math.min(left, frameRight));
    const clippedRight = Math.min(frameRight, Math.max(right, frameLeft));
    pieces.push({
      row: rowOf(ix, frame),
      page: pageOf(ix, node),
      left: clippedRight > clippedLeft ? clippedLeft : left,
      right: clippedRight > clippedLeft ? clippedRight : right,
      top: tall ? ix.v[frame] - Math.abs(ix.ht[frame]) : ix.vV[fx] - Math.abs(ix.htV[fx]),
      bottom: tall ? ix.v[frame] + Math.abs(ix.dp[frame]) : ix.vV[fx] + Math.abs(ix.dpV[fx]),
      first: node,
    });
  }

  // One highlight per row: the cells of a table row or the two halves of an aligned equation belong together.
  const rows = new Map<number, Ink>();
  for (const piece of pieces) {
    const row = rows.get(piece.row);
    if (!row) rows.set(piece.row, piece);
    else {
      row.left = Math.min(row.left, piece.left);
      row.right = Math.max(row.right, piece.right);
      row.top = Math.min(row.top, piece.top);
      row.bottom = Math.max(row.bottom, piece.bottom);
      row.first = Math.min(row.first, piece.first);
    }
  }
  return Array.from(rows.values());
}

/** Every record of (tags, line) that is on a page, in output order. */
function recordsOfLine(ix: SyncTexIndex, tags: number[], line: number): number[] {
  const nodes: number[] = [];
  for (const tag of tags) {
    if (tag + line < 0) continue;
    for (let n = ix.friendHead[(tag + line) % FRIEND_LISTS]; n >= 0; n = ix.friendNext[n]) {
      if (ix.tag[n] !== tag || ix.line[n] !== line || ix.type[n] === RULE) continue;
      // A record straight under the sheet is a stray: pdfTeX writes the content of a PDF form there, in the form's own coordinates.
      const p = ix.parent[n];
      if (p < 0 || ix.type[p] === SHEET || pageOf(ix, n) < 1) continue;
      nodes.push(n);
    }
  }
  return nodes.sort((a, b) => a - b);
}

/**
 * Where a source line lands in the PDF. `tags` are all the tags the file was read under.
 *
 * A line with nothing on paper (a comment, a blank line, the preamble, the body of an environment such as align that TeX reads whole and typesets at its \end line) is answered by the next line that has something, or failing that the last one before it. Each highlight is the part of one PDF line that the source line produced, not the whole line box.
 */
export function forwardSearch(ix: SyncTexIndex, tags: number[], line: number, options: ForwardOptions = {}): ForwardHit | null {
  const tagSet = new Set(tags);
  const tables = lineTables(ix);
  // Lines with records, nearest following first, then nearest preceding.
  const order: number[] = [];
  {
    const all = new Set<number>();
    for (const tag of tags) for (const l of tables.lines.get(tag) ?? []) all.add(l);
    const sorted = Array.from(all).sort((a, b) => a - b);
    let at = 0;
    while (at < sorted.length && sorted[at] < line) at++;
    for (let i = at; i < sorted.length && order.length < 400; i++) order.push(sorted[i]);
    for (let i = at - 1; i >= 0 && order.length < 800; i--) order.push(sorted[i]);
  }

  let found = -1;
  let nodes: number[] = [];
  let inks: Ink[] = [];
  let fallbackLine = -1;
  for (const candidate of order) {
    const records = recordsOfLine(ix, tags, candidate);
    const ink = inkOfLine(ix, tagSet, candidate, records);
    if (ink.length === 0) {
      if (fallbackLine < 0 && records.length > 0) fallbackLine = candidate;
      continue;
    }
    found = candidate;
    nodes = records;
    inks = ink;
    break;
  }

  const toBp = (sp: number) => sp * ix.unit;
  let rects: (SyncRect & { first: number })[] = [];
  if (found >= 0) {
    // A file read twice puts the line in two places: keep the run of pages nearest to the page on screen.
    const pages = Array.from(new Set(inks.map((ink) => ink.page))).sort((a, b) => a - b);
    const runs: number[][] = [];
    for (const p of pages) {
      const last = runs[runs.length - 1];
      if (last && p - last[last.length - 1] <= 1) last.push(p);
      else runs.push([p]);
    }
    let run = runs[0];
    if (options.pageHint && runs.length > 1) {
      const hint = options.pageHint;
      const far = (r: number[]) => (hint < r[0] ? r[0] - hint : hint > r[r.length - 1] ? hint - r[r.length - 1] : 0);
      for (const r of runs) if (far(r) < far(run)) run = r;
    }
    inks = inks.filter((ink) => run.includes(ink.page));
    nodes = nodes.filter((n) => run.includes(pageOf(ix, n)));

    const MIN_HEIGHT = 9;
    for (const ink of inks) {
      let top = ink.top;
      let bottom = ink.bottom;
      if (toBp(bottom - top) < MIN_HEIGHT) {
        // Next to no height of its own: stand a line's height on the baseline.
        bottom = ink.bottom + Math.round(2 / ix.unit);
        top = bottom - Math.round(MIN_HEIGHT / ix.unit);
      }
      let left = ink.left;
      let right = Math.max(ink.right, ink.left + Math.round(3 / ix.unit));
      // Inside the turned body of a landscape page the rectangle turns with it, about the same pivot.
      const turned = turnedContentsOf(ix, ink.page, options.pageGeometry?.(ink.page)).find((t) => isInside(ix, ink.first, t.box));
      if (turned) {
        const turn = (x: number, y: number): [number, number] => [turned.px + turned.sign * (y - turned.py), turned.py - turned.sign * (x - turned.px)];
        const a = turn(left, top);
        const b = turn(right, bottom);
        left = Math.min(a[0], b[0]);
        right = Math.max(a[0], b[0]);
        top = Math.min(a[1], b[1]);
        bottom = Math.max(a[1], b[1]);
      }
      rects.push({ page: ink.page, x: toBp(left) + ix.xOffset, y: toBp(top) + ix.yOffset, width: toBp(right - left), height: toBp(bottom - top), first: ink.first });
    }
  } else if (fallbackLine >= 0) {
    // Nothing near has text on paper (a document of rules and space only): mark where the nearest record sits.
    found = fallbackLine;
    nodes = recordsOfLine(ix, tags, found);
    const seen = new Set<string>();
    for (const n of nodes) {
      const page = pageOf(ix, n);
      const key = page + ":" + ix.v[n];
      if (seen.has(key)) continue;
      seen.add(key);
      const box = ix.parent[n];
      const width = ix.type[box] === HBOX ? Math.abs(ix.wV[ix.hx[box]]) : Math.abs(ix.w[box]);
      const left = ix.type[box] === HBOX ? leftEdge(ix, box) : ix.h[box];
      rects.push({ page, x: toBp(left) + ix.xOffset, y: toBp(ix.v[n]) + ix.yOffset - 6, width: Math.max(toBp(width), 24), height: 8, first: n });
    }
    const firstPage = Math.min(...rects.map((r) => r.page));
    rects = rects.filter((r) => r.page === firstPage);
  }
  if (rects.length === 0) return null;
  rects.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);

  let primary = 0;
  if (options.fraction !== undefined && nodes.length > 1) {
    const target = nodes[Math.round(Math.min(1, Math.max(0, options.fraction)) * (nodes.length - 1))];
    const page = pageOf(ix, target);
    // The highlight that holds the record at that share of the line: the last one starting at or before it.
    let best = -1;
    for (let i = 0; i < rects.length; i++) {
      if (rects[i].page > page || (rects[i].page === page && rects[i].first > target)) continue;
      if (best < 0 || rects[i].page > rects[best].page || (rects[i].page === rects[best].page && rects[i].first > rects[best].first)) best = i;
    }
    if (best >= 0) primary = best;
  }
  return {
    page: rects[primary].page,
    rects: rects.map(({ page, x, y, width, height }) => ({ page, x, y, width, height })),
    primary,
    line: found,
    exact: found === line,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lines that moved since the compile
// ─────────────────────────────────────────────────────────────────────────────

interface LineHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  same: boolean;
}

export interface LineMap {
  /** False when the two texts are identical. */
  changed: boolean;
  /** Compiled line → line in the text as it is now. `exact` is false when that line itself was edited or removed, and the answer is the closest surviving place. */
  toCurrent(line: number): { line: number; exact: boolean };
  /** Line in the text as it is now → compiled line. */
  toCompiled(line: number): { line: number; exact: boolean };
}

const IDENTITY: LineMap = {
  changed: false,
  toCurrent: (line) => ({ line, exact: true }),
  toCompiled: (line) => ({ line, exact: true }),
};

/**
 * Line correspondence between the text TeX compiled and the text in the editor now. SyncTeX only knows the compiled lines, so every jump goes through this: lines typed above the target shift it, and a jump into an edited stretch is flagged instead of landing somewhere unrelated without a word.
 */
export function createLineMap(compiled: string | undefined, current: string | undefined): LineMap {
  if (compiled === undefined || current === undefined || compiled === current) return IDENTITY;
  const a = compiled.split("\n");
  const b = current.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const hunks: LineHunk[] = [];
  if (head > 0) hunks.push({ oldStart: 1, oldCount: head, newStart: 1, newCount: head, same: true });
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  let oldAt = head + 1;
  let newAt = head + 1;
  const parts = midA.length > 0 && midB.length > 0 ? diffArrays(midA, midB, { maxEditLength: 20000 }) : undefined;
  if (parts) {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const n = part.value.length;
      if (!part.added && !part.removed) {
        hunks.push({ oldStart: oldAt, oldCount: n, newStart: newAt, newCount: n, same: true });
        oldAt += n;
        newAt += n;
        continue;
      }
      // A removal and the addition after it are one edited stretch.
      let removed = 0;
      let added = 0;
      if (part.removed) removed = n;
      else added = n;
      const after = parts[i + 1];
      if (after && (after.added || after.removed) && !!after.added !== !!part.added) {
        if (after.removed) removed += after.value.length;
        else added += after.value.length;
        i++;
      }
      hunks.push({ oldStart: oldAt, oldCount: removed, newStart: newAt, newCount: added, same: false });
      oldAt += removed;
      newAt += added;
    }
  } else if (midA.length > 0 || midB.length > 0) {
    // Nothing in common worth computing (or one side empty): the whole middle is one edited stretch.
    hunks.push({ oldStart: oldAt, oldCount: midA.length, newStart: newAt, newCount: midB.length, same: false });
    oldAt += midA.length;
    newAt += midB.length;
  }
  if (tail > 0) hunks.push({ oldStart: oldAt, oldCount: tail, newStart: newAt, newCount: tail, same: true });

  const convert = (line: number, forward: boolean, limit: number): { line: number; exact: boolean } => {
    for (const hunk of hunks) {
      const from = forward ? hunk.oldStart : hunk.newStart;
      const size = forward ? hunk.oldCount : hunk.newCount;
      const to = forward ? hunk.newStart : hunk.oldStart;
      const toSize = forward ? hunk.newCount : hunk.oldCount;
      if (line < from || line >= from + size) continue;
      if (hunk.same) return { line: to + (line - from), exact: true };
      // Inside an edit: the same share of the way through the replacement, or the line that took its place.
      if (toSize === 0) return { line: Math.max(1, Math.min(limit, to)), exact: false };
      const share = size > 1 ? (line - from) / (size - 1) : 0;
      return { line: to + Math.round(share * (toSize - 1)), exact: false };
    }
    return { line: Math.max(1, Math.min(limit, line)), exact: false };
  };
  return {
    changed: true,
    toCurrent: (line) => convert(line, true, b.length),
    toCompiled: (line) => convert(line, false, a.length),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The column: which word on the line
// ─────────────────────────────────────────────────────────────────────────────

export interface ClickedWord {
  word: string;
  /** Words on the same PDF line before the clicked one, nearest first. */
  before: string[];
  /** Words on the same PDF line after it, nearest first. */
  after: string[];
}

const LIGATURES: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };

/** PDF text made comparable with source text: ligatures split, typographic quotes and dashes dropped back to what is typed. */
export function normalizePdfText(text: string): string {
  return text
    .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/ /g, " ");
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

/** Where a position in `normalizePdfText(text)` falls in `text` itself. */
export function rawOffsetOf(text: string, normalizedOffset: number): number {
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (seen >= normalizedOffset) return i;
    seen += normalizePdfText(text[i]).length;
  }
  return text.length;
}

/** The words of a string with where each starts. */
export function wordsOf(text: string): { word: string; index: number }[] {
  const out: { word: string; index: number }[] = [];
  for (const m of text.matchAll(WORD)) out.push({ word: m[0], index: m.index ?? 0 });
  return out;
}

/**
 * The word at a character offset of a PDF line, with the words around it. Returns null when the offset is not on a word.
 */
export function clickedWordAt(lineText: string, rawOffset: number): ClickedWord | null {
  const text = normalizePdfText(lineText);
  // A ligature before the click is one character in the PDF and two or three once split.
  const offset = normalizePdfText(lineText.slice(0, rawOffset)).length;
  const words = wordsOf(text);
  let at = words.findIndex((w) => offset >= w.index && offset <= w.index + w.word.length);
  if (at < 0) return null;
  // On the seam between two words the one that starts there wins, as a double-click selects it.
  if (at + 1 < words.length && words[at + 1].index === offset) at++;
  return {
    word: words[at].word,
    before: words.slice(Math.max(0, at - 6), at).map((w) => w.word).reverse(),
    after: words.slice(at + 1, at + 7).map((w) => w.word),
  };
}

export interface WordMatch {
  /** Index into the `lines` given. */
  index: number;
  /** 0-based column where the word starts. */
  column: number;
  length: number;
}

/**
 * Find the clicked word in the lines SyncTeX named. Occurrences are ranked by how many of the neighboring PDF words sit around them in the source, then by the order of `lines` (best SyncTeX candidate first), then by which is nearest to `fraction` of the way along the line. Nothing outside `lines` is ever looked at: the text only refines what SyncTeX found.
 */
export function findWordInLines(lines: string[], clicked: ClickedWord, fraction?: number): WordMatch | null {
  const needle = normalizePdfText(clicked.word);
  if (!needle) return null;
  const lower = needle.toLowerCase();
  const before = clicked.before.map((s) => s.toLowerCase());
  const after = clicked.after.map((s) => s.toLowerCase());
  let best: (WordMatch & { score: number }) | null = null;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const words = wordsOf(text);
    const lowered = words.map((w) => w.word.toLowerCase());
    for (let k = 0; k < words.length; k++) {
      let column = words[k].index;
      let length = words[k].word.length;
      let quality: number;
      if (words[k].word === needle) quality = 3;
      else if (lowered[k] === lower) quality = 2;
      else if (lower.length >= 4 && lowered[k].startsWith(lower)) {
        // The first half of a word TeX hyphenated at the end of a PDF line.
        quality = 1;
        length = needle.length;
      } else if (lower.length >= 4 && lowered[k].endsWith(lower)) {
        quality = 1;
        column += words[k].word.length - needle.length;
        length = needle.length;
      } else continue;

      // Markup sits between words in the source (\textbf{…}, \cite{…}), so a neighbor may be a few words away.
      let context = 0;
      const nearBefore = lowered.slice(Math.max(0, k - 8), k);
      const nearAfter = lowered.slice(k + 1, k + 9);
      before.forEach((word, d) => {
        if (lowered[k - 1 - d] === word) context += 2;
        else if (nearBefore.includes(word)) context += 1;
      });
      after.forEach((word, d) => {
        if (lowered[k + 1 + d] === word) context += 2;
        else if (nearAfter.includes(word)) context += 1;
      });

      let score = quality * 100 + context * 1000 - i * 10;
      if (fraction !== undefined && text.length > 0) score -= Math.abs(column / text.length - fraction) * 5;
      if (!best || score > best.score) best = { index: i, column, length, score };
    }
  }
  if (best) return { index: best.index, column: best.column, length: best.length };

  // Not a word of its own in the source (glued to markup, part of a longer token): a plain substring on the best line. Too short a word would match anywhere.
  if (lower.length < 3) return null;
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].toLowerCase().indexOf(lower);
    if (at >= 0) return { index: i, column: at, length: needle.length };
  }
  return null;
}

/** The word under a column of a source line, with its neighbors, for finding it again in the PDF text. */
export function sourceWordAt(lineText: string, column: number): ClickedWord | null {
  const words = wordsOf(lineText);
  if (words.length === 0) return null;
  let at = words.findIndex((w) => column >= w.index && column <= w.index + w.word.length);
  if (at < 0) {
    // Between words: the next word, or the last one on the line.
    at = words.findIndex((w) => w.index >= column);
    if (at < 0) at = words.length - 1;
  }
  return {
    word: words[at].word,
    before: words.slice(Math.max(0, at - 6), at).map((w) => w.word).reverse(),
    after: words.slice(at + 1, at + 7).map((w) => w.word),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// From a click to a place in the editor, and from the cursor to a place in the PDF
// ─────────────────────────────────────────────────────────────────────────────

/** Unmatched closing and opening braces of one source line, comments and escaped braces aside. */
function braceBalance(text: string): { closers: number; openers: number } {
  let closers = 0;
  let openers = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "%") break;
    else if (c === "{") openers++;
    else if (c === "}") {
      if (openers > 0) openers--;
      else closers++;
    }
  }
  return { closers, openers };
}

/**
 * The lines TeX had already read when it typeset what SyncTeX files under `line` (1-based), or an empty list.
 *
 * TeX stamps a record with the line it is reading at the moment the material is made. An argument is read to its closing brace before anything in it is typeset, and environments such as align or tabularx collect their whole body first, so everything in them carries the line of the closing brace or of \end{…}. The clicked word is then on one of the lines between the opening and that line, and those are the only extra lines worth searching.
 */
export function linesReadTogether(lines: string[], line: number): number[] {
  const text = lines[line - 1];
  if (text === undefined) return [];
  const LIMIT = 600;
  let start = line;

  const end = /\\end\s*\{([^}]*)\}/.exec(text.replace(/(^|[^\\])%.*$/, "$1"));
  if (end) {
    const name = end[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const token = new RegExp(`\\\\(begin|end)\\s*\\{${name}\\}`, "g");
    let depth = 1;
    // Anything on the \end line before the \end itself may open or close the same environment.
    for (const m of text.slice(0, end.index).matchAll(token)) depth += m[1] === "end" ? 1 : -1;
    for (let l = line - 1; l >= 1 && line - l <= LIMIT && depth > 0; l--) {
      const found = Array.from(lines[l - 1].matchAll(token)).reverse();
      for (const m of found) {
        depth += m[1] === "end" ? 1 : -1;
        if (depth === 0) break;
      }
      if (depth === 0) start = l;
    }
  }

  let need = braceBalance(text).closers;
  for (let l = line - 1; l >= 1 && line - l <= LIMIT && need > 0; l--) {
    const { closers, openers } = braceBalance(lines[l - 1]);
    if (openers >= need) {
      need = 0;
      if (l < start) start = l;
    } else need += closers - openers;
  }

  const out: number[] = [];
  for (let l = start; l < line; l++) out.push(l);
  return out;
}

const splitCache = new Map<string, string[]>();
/** A text's lines, remembered for the few files a session jumps around in. */
function linesOfText(text: string): string[] {
  let lines = splitCache.get(text);
  if (!lines) {
    if (splitCache.size >= 12) splitCache.delete(splitCache.keys().next().value as string);
    lines = text.split("\n");
    splitCache.set(text, lines);
  }
  return lines;
}

let lastMap: { compiled: string; current: string; map: LineMap } | null = null;
function lineMapFor(compiled: string | undefined, current: string | undefined): LineMap {
  if (compiled === undefined || current === undefined || compiled === current) return IDENTITY;
  if (lastMap && lastMap.compiled === compiled && lastMap.current === current) return lastMap.map;
  const map = createLineMap(compiled, current);
  lastMap = { compiled, current, map };
  return map;
}

export interface SourceTexts {
  /** The file as TeX compiled it, when known: what SyncTeX's line numbers count. */
  compiled(path: string): string | undefined;
  /** The file as it is in the editor now. */
  current(path: string): string | undefined;
}

export interface SourceJump {
  path: string;
  /** 1-based line and 0-based column in the text as it is now. */
  line: number;
  column: number;
  /** Length of the word to select, 0 when only the line is known. */
  length: number;
  /** The text at that place, empty when only the line is known. An editor whose copy of the file is newer than the one this was resolved against can look for it again nearby. */
  word: string;
  /** False when the place was edited after the compile and the answer is the nearest surviving spot. */
  exact: boolean;
}

/**
 * The full PDF → editor resolution: SyncTeX names the file and line, the clicked word names the column, and the difference between the compiled text and the editor's text moves the result to where that line is now.
 */
export function resolveSourceJump(ix: SyncTexIndex, files: SyncFileMap, texts: SourceTexts, page: number, xBp: number, yBp: number, clicked: ClickedWord | null, geometry?: PageGeometry): SourceJump | null {
  const hit = inverseSearch(ix, page, xBp, yBp, (tag) => files.pathOfTag.has(tag), geometry);
  if (!hit) return null;
  const path = files.pathOfTag.get(hit.tag);
  if (path === undefined) return null;

  const compiledLines = (p: string): string[] | null => {
    const text = texts.compiled(p) ?? texts.current(p);
    return text === undefined ? null : linesOfText(text);
  };

  let jumpPath = path;
  let line = hit.line;
  let column = -1;
  let length = 0;
  if (clicked && clicked.word) {
    const candidates = hit.candidates.map((c) => ({ path: files.pathOfTag.get(c.tag), line: c.line })).filter((c): c is { path: string; line: number } => c.path !== undefined);
    const found = findWordInLines(
      candidates.map((c) => compiledLines(c.path)?.[c.line - 1] ?? ""),
      clicked,
      hit.fraction,
    );
    if (found) {
      jumpPath = candidates[found.index].path;
      line = candidates[found.index].line;
      column = found.column;
      length = found.length;
    } else {
      // Not on SyncTeX's lines: the argument or environment that closes on its line was read before any of it was typeset.
      const lines = compiledLines(path);
      const together = lines ? linesReadTogether(lines, hit.line) : [];
      const inside = lines && together.length > 0 ? findWordInLines(together.map((l) => lines[l - 1]), clicked) : null;
      if (inside) {
        line = together[inside.index];
        column = inside.column;
        length = inside.length;
      }
    }
  }

  // From the compiled text to the text in the editor.
  const compiled = texts.compiled(jumpPath);
  const current = texts.current(jumpPath);
  const map = lineMapFor(compiled, current);
  const moved = map.toCurrent(line);
  const exact = moved.exact;
  let currentLine = moved.line;
  const currentLines = current !== undefined ? linesOfText(current) : null;
  if (currentLines) {
    currentLine = Math.max(1, Math.min(currentLines.length, currentLine));
    const text = currentLines[currentLine - 1] ?? "";
    const word = clicked?.word ? normalizePdfText(clicked.word) : "";
    const stillThere = column >= 0 && length > 0 && text.slice(column, column + length).toLowerCase() === word.toLowerCase().slice(0, length);
    if (!stillThere && clicked && clicked.word) {
      // The line was edited, or its text was never known: look for the word again around where the line is now, nearest line first.
      const around: number[] = [];
      for (let d = 0; d <= (exact ? 0 : 3); d++) for (const l of d === 0 ? [currentLine] : [currentLine - d, currentLine + d]) if (l >= 1 && l <= currentLines.length) around.push(l);
      const again = findWordInLines(around.map((l) => currentLines[l - 1]), clicked);
      if (again) {
        currentLine = around[again.index];
        column = again.column;
        length = again.length;
      } else {
        column = -1;
        length = 0;
      }
    }
    if (column < 0) column = (currentLines[currentLine - 1] ?? "").search(/\S/);
  }
  if (column < 0) column = 0;
  const word = length > 0 && currentLines ? (currentLines[currentLine - 1] ?? "").slice(column, column + length) : "";
  return { path: jumpPath, line: currentLine, column, length, word, exact };
}

export interface PdfJump extends ForwardHit {
  /** False when the cursor's line was typed or changed after the compile, so the highlight is where the nearest compiled line landed. */
  current: boolean;
  /** The word under the cursor with its neighbors, for the viewer to pick it out inside the highlight. */
  word: ClickedWord | null;
}

/** The full editor → PDF resolution for a cursor at `line` (1-based) and `column` (0-based) of a project file. */
export function resolvePdfJump(ix: SyncTexIndex, files: SyncFileMap, texts: SourceTexts, path: string, line: number, column: number, pageHint?: number, pageGeometry?: (page: number) => PageGeometry | undefined): PdfJump | null {
  const tags = files.tagsOfPath.get(path);
  if (!tags || tags.length === 0) return null;
  const current = texts.current(path);
  const map = lineMapFor(texts.compiled(path), current);
  const compiledLine = map.toCompiled(line);
  const text = current !== undefined ? (linesOfText(current)[line - 1] ?? "") : "";
  const fraction = text.length > 0 ? Math.min(1, Math.max(0, column / text.length)) : undefined;
  const hit = forwardSearch(ix, tags, compiledLine.line, { pageHint, fraction, pageGeometry });
  if (!hit) return null;
  return { ...hit, current: compiledLine.exact, word: text ? sourceWordAt(text, column) : null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page geometry
// ─────────────────────────────────────────────────────────────────────────────

const quarterTurns = (rotation: number): number => ((Math.round(rotation / 90) % 4) + 4) % 4;

/**
 * A point of the page as shown on screen (as fractions of the shown width and height, from its top-left) → SyncTeX's point in PDF points from the top-left of the page as TeX laid it out. Fractions make this independent of zoom, device pixel ratio, and CSS transforms: only the rotation and the page box matter.
 */
export function shownToPage(fx: number, fy: number, page: PageGeometry): { x: number; y: number } {
  const width = page.view[2] - page.view[0];
  const height = page.view[3] - page.view[1];
  let ux: number;
  let uy: number;
  switch (quarterTurns(page.rotation)) {
    case 1:
      ux = fy * width;
      uy = (1 - fx) * height;
      break;
    case 2:
      ux = (1 - fx) * width;
      uy = (1 - fy) * height;
      break;
    case 3:
      ux = (1 - fy) * width;
      uy = fx * height;
      break;
    default:
      ux = fx * width;
      uy = fy * height;
  }
  // TeX's x is the PDF x itself; its y runs down from the top of the page box, which for a page TeX wrote is the top of the media box.
  return { x: ux + page.view[0], y: uy };
}

/** The reverse: a rectangle in SyncTeX page points → fractions of the page as shown, ready to be used as CSS percentages. */
export function pageRectToShown(rect: { x: number; y: number; width: number; height: number }, page: PageGeometry): { left: number; top: number; width: number; height: number } {
  const width = page.view[2] - page.view[0];
  const height = page.view[3] - page.view[1];
  const x0 = (rect.x - page.view[0]) / width;
  const y0 = rect.y / height;
  const x1 = (rect.x + rect.width - page.view[0]) / width;
  const y1 = (rect.y + rect.height) / height;
  let corners: [number, number, number, number];
  switch (quarterTurns(page.rotation)) {
    case 1:
      corners = [1 - y1, x0, 1 - y0, x1];
      break;
    case 2:
      corners = [1 - x1, 1 - y1, 1 - x0, 1 - y0];
      break;
    case 3:
      corners = [y0, 1 - x1, y1, 1 - x0];
      break;
    default:
      corners = [x0, y0, x1, y1];
  }
  return { left: corners[0], top: corners[1], width: corners[2] - corners[0], height: corners[3] - corners[1] };
}
