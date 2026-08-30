import { type ComponentType } from "react";

import { CheckIcon, FileIcon, FolderIcon, MagnifyingGlassIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";

import { NARRATIVE, REPO_LABEL } from "../data";
import { Reveal } from "../primitives/reveal";
import type { NarrativeEntry } from "../types";

const HEADING_ID = "how-heading";

// ─── Primary "blocks" design ──────────────────────────────────────────

type StepKey = "search" | "index" | "cite";

type Step = {
  key: StepKey;
  /**
   * Renders the step's literal mini-UI mockup. Each visual is a tiny
   * looping diagram of the operation rather than abstract geometry — a
   * URL input gets a URL, a file tree gets scanned, an answer cites a
   * line — so a visitor reads "this is exactly what happens" before
   * they even reach the caption underneath. The keyframe loops live in
   * `index.css` under `narrative-*`.
   */
  Visual: ComponentType;
  /** Copy for this step, pulled from the canonical NARRATIVE array in
   *  `data.ts`. Binding it here (rather than parallel-indexing two
   *  separate arrays at render time) makes misalignment a visible,
   *  reviewable concern instead of a silent runtime bug. */
  entry: NarrativeEntry;
};

const STEPS: ReadonlyArray<Step> = [
  { key: "search", Visual: PasteBlock, entry: NARRATIVE[0] },
  { key: "index", Visual: IndexBlock, entry: NARRATIVE[1] },
  { key: "cite", Visual: CiteBlock, entry: NARRATIVE[2] },
];

/**
 * "How it works" — three blocks, each a literal mini-mockup of the step
 * it represents (URL input → file tree scan → answer + citation), with a
 * lead headline and a one-sentence description underneath. The visuals
 * loop on their own so the section reads as a live diagram even without
 * interaction; the captions guarantee the meaning lands even when the
 * visitor doesn't watch a full loop.
 *
 * Each step binds its visual config to the matching `NARRATIVE` entry
 * from `data.ts` at definition time (not at render time via parallel
 * indexing), so wording lives in one place and misalignment is visible
 * in code review.
 */
export function Narrative() {
  return (
    <Reveal>
      <section id="how" aria-labelledby={HEADING_ID} className="relative flex flex-col gap-12 sm:gap-16">
        <header className="flex max-w-3xl flex-col gap-3">
          <h2 id={HEADING_ID} className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">
            A repo name becomes a grounded answer in three moves.
          </h2>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-muted-foreground sm:text-[11px]">
            search → index → cite
          </p>
        </header>

        <ol className="grid grid-cols-1 gap-y-12 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-0 lg:gap-x-8">
          {STEPS.map((step, i) => (
            <Block key={step.key} step={step} index={i} />
          ))}
        </ol>
      </section>
    </Reveal>
  );
}

function Block({ step, index }: { step: Step; index: number }) {
  const { entry, Visual } = step;
  return (
    <li className="flex animate-fade-up list-none flex-col gap-5" style={{ animationDelay: `${index * 110}ms` }}>
      <div className="relative aspect-5/4 w-full overflow-hidden border border-border bg-card/60 backdrop-blur">
        <Visual />
      </div>

      <div className="flex flex-col gap-2.5">
        {/* Step header — number, hairline rule, verb keyword */}
        <div className="flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.22em]">
          <span className="text-lg font-semibold leading-none text-primary">{entry.num}</span>
          <span aria-hidden className="block h-px flex-1 bg-border/60" />
          <span className="text-muted-foreground">{step.key}</span>
        </div>
        <h3 className="text-pretty text-base font-semibold leading-snug tracking-tight sm:text-lg">{entry.lead}</h3>
        <p className="text-pretty text-[13.5px] leading-relaxed text-muted-foreground sm:text-[14px]">{entry.trail}</p>
      </div>
    </li>
  );
}

// ─── Block visuals (loop continuously) ────────────────────────────────

/**
 * Step 01 — paste. The card runs three scenes in sequence over its 10 s
 * loop (slower than the 5 s tempo of the index/cite cards because this
 * card has more beats to read), layered as absolutely-positioned
 * siblings whose wrappers cross-fade so each takes the full card in
 * turn:
 *
 *   1. **Search** (0–54%) — a repo-name input that *types* the query
 *      character-by-character via a `steps(7, end)` width animation,
 *      then a dropdown of matches slides in beneath it and a
 *      hover/click highlight peaks on the top result at 52%. Picking
 *      a row from the dropdown is itself the import action — there's
 *      no separate `send` button beat.
 *   2. **Cloning** (60–72%) — a horizontal progress bar that fills
 *      left-to-right from 0 → 100% under a "cloning sandbox…" label,
 *      the loader the visitor would see while we clone the repo into
 *      a Daytona sandbox.
 *   3. **Chat ready** (78–95%) — the final frame: a chat-room shell
 *      scoped to the imported repo. A header names the repo (with a
 *      pulsing dot to flag the thread as live), a single
 *      "✓ sandbox ready" chip sits under it as the success marker,
 *      and a generously sized composer at the bottom shows the
 *      surface is ready to take a question. We don't repeat "cloned"
 *      here — the cloning loader in scene 2 has already played that
 *      beat.
 *
 * The card-level paste verb reads as "type → list → click → cloning →
 * ready to chat" — the third card (`<CiteBlock />`) then takes over
 * with an actual exchange and citation, so this card stays scoped to
 * the import step and just hands off a ready surface.
 */
function PasteBlock() {
  return (
    <div className="relative h-full">
      {/* ── Scene 1 · Search ──────────────────────────────────────── */}
      <div className="animate-narrative-paste-scene-search absolute inset-0 grid grid-rows-[auto_1fr] gap-2 p-3 sm:p-4">
        {/* Search input. Typing happens on the inner `<span>` whose
            width animates 0 → 7ch in `steps(7, end)` so "systify"
            appears one character at a time. */}
        <div>
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">repo name</p>
          <div className="relative flex items-center gap-2 border border-border bg-background/80 px-2 py-1.5">
            <MagnifyingGlassIcon weight="bold" className="size-3 shrink-0 text-muted-foreground/70" />
            {/* Reserved-height text region. Placeholder is an absolute
                overlay; the typed query is an absolutely-positioned
                inline-block whose `width` animates 0 → 7ch in seven
                discrete `steps(7, end)` jumps — same typewriter pattern
                as `<HeroChat />`'s composer (`animate-hero-typing`).
                The typed span's `border-right` doubles as the caret,
                so the cursor sits flush against the trailing character
                rather than the input's right gutter. (`box-sizing:
                content-box` is set in CSS so the 1px caret border
                doesn't eat into the text's content area when width
                reaches its 7ch target.) */}
            <div className="relative h-3.5 min-w-0 flex-1 overflow-hidden font-mono text-[10.5px] leading-3.5 sm:text-[11px]">
              <span className="animate-narrative-paste-placeholder absolute inset-0 truncate text-muted-foreground/55">
                search repo name…
              </span>
              <span className="animate-narrative-paste-typed absolute left-0 top-0 leading-3.5 text-foreground">
                systify
              </span>
            </div>
          </div>
        </div>

        {/* Search results dropdown — fills the rest of the scene below
            the input via a `1fr` grid row, so the list is visually the
            dominant element of the card while it's open. Each row
            takes an equal share of the available height (`flex-1`),
            and the top match gets a hover/click highlight that peaks
            at the click moment (52%) — that click is also the import
            trigger that hands off to the cloning scene below. */}
        <div className="animate-narrative-paste-list flex flex-col overflow-hidden border border-border bg-background/80">
          {SEARCH_RESULTS.map((result, i) => (
            <div
              key={result.repo}
              className="relative flex flex-1 items-center gap-2 border-b border-border/40 px-2.5 font-mono text-[10px] last:border-b-0 sm:text-[10.5px]"
            >
              {i === 0 ? (
                <span
                  aria-hidden
                  className="animate-narrative-paste-list-highlight pointer-events-none absolute inset-0 bg-primary/20"
                />
              ) : null}
              <FolderIcon weight="duotone" className="relative size-3.5 shrink-0 text-muted-foreground/80" />
              <span className="relative min-w-0 flex-1 truncate text-foreground/85">{result.repo}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Scene 2 · Cloning loader ──────────────────────────────── */}
      <div className="animate-narrative-paste-scene-cloning absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-3 sm:p-4">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
          cloning sandbox…
        </span>
        {/* Progress bar — outer rail is the unfilled track, inner span
            is the fill that grows 0 → 100% width across the cloning
            window so the loader has a clear arc instead of an open
            -ended spinner. */}
        <div className="relative h-1 w-32 overflow-hidden rounded-full bg-muted/50">
          <span
            aria-hidden
            className="animate-narrative-paste-cloning-bar absolute inset-y-0 left-0 rounded-full bg-primary"
          />
        </div>
      </div>

      {/* ── Scene 3 · Chat ready (final frame) ────────────────────── */}
      <div className="animate-narrative-paste-scene-chat absolute inset-0 grid grid-rows-[auto_auto_1fr_auto] gap-2 p-3 sm:p-4">
        {/* Chat-room header — names the repo this thread is scoped to,
            with a small pulse on the right that flags the thread as
            live. No "ready" label here; the success chip below carries
            that beat instead. */}
        <div className="flex items-center gap-1.5 border-b border-border/60 pb-1.5">
          <FolderIcon weight="duotone" aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] tracking-tight text-foreground/85">
            {REPO_LABEL}
          </span>
          <span aria-hidden className="animate-pulse-soft size-1.5 shrink-0 rounded-full bg-emerald-500" />
        </div>

        {/* Sandbox-ready chip — the single success marker for this
            scene. The cloning loader in scene 2 has already played
            "we cloned this", so we only state the post-condition
            ("the sandbox is ready") here, with the check icon for
            the success colour cue. */}
        <div className="flex items-center">
          <span className="inline-flex items-center gap-1 border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
            <CheckIcon weight="bold" className="size-2.5" />
            sandbox ready
          </span>
        </div>

        {/* Spacer — keeps the composer pinned to the bottom while the
            success chip sits up top. Empty by design: the card is
            "ready to chat", not "showing a chat". The third card
            (`<CiteBlock />`) takes over with an actual exchange. */}
        <div aria-hidden />

        {/* Composer — placeholder + decorative send icon so the
            surface clearly reads as "type here to ask". Sized like a
            real chat input (multi-line height via `min-h`) so it
            anchors the bottom of the card with visual weight rather
            than reading as a tight one-liner. Static; the send icon
            does not press during this scene. */}
        <div className="flex min-h-12 items-start gap-2 border border-border bg-background/80 px-2.5 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground/55">ask anything…</span>
          <span
            aria-hidden
            className="inline-flex size-5 shrink-0 items-center justify-center border border-primary/40 bg-primary/10 text-primary"
          >
            <PaperPlaneTiltIcon weight="bold" className="size-3" />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Mock search hits shown in the dropdown. Kept tiny — three rows is
 * enough for "list of matches" to read while still leaving the card
 * the breathing room a real GitHub typeahead would have. The first
 * entry is the canonical match the loop ends up selecting; the other
 * two are plausible noise so the click choice has weight.
 */
const SEARCH_RESULTS: ReadonlyArray<{ repo: string }> = [
  { repo: REPO_LABEL },
  { repo: "octocat/systify-app" },
  { repo: "hubot/systify-utils" },
];

/**
 * Step 02 — index. A miniature file tree (one folder, three files inside,
 * plus a README) that the indexer "scans" top-to-bottom. Each row gets a
 * primary-tinted highlight as the scan passes through it, then a green
 * ✓ check fades in on the right edge to mark it as indexed. The per-row
 * stagger makes the scan direction unmistakable — top → bottom, like a
 * real indexer reading rows of files — and replaces the old 3×3 abstract
 * pulse grid that gave no clue *what* was being read.
 *
 * The check on each row uses a per-row keyframe (`narrative-index-check-N`)
 * instead of `animationDelay` on a shared keyframe. Keyframes baked the
 * fade-in stagger into different appear-percentages, but every row's
 * disappear phase sits at the same 92%–100% range — so all five checks
 * clear together at the loop reset rather than vanishing in the same
 * staggered order they appeared. The row scan can keep `animationDelay`
 * because its on/off pulse only occupies the first ~14% of the cycle;
 * it's already invisible at the loop boundary, and a staggered cycle
 * there has no visual cost.
 *
 * Each row in `INDEX_FILES` carries its own `checkClass`, so adding a
 * row means adding a matching `narrative-index-check-N` keyframe +
 * utility class in `index.css` and a `checkClass` entry on the new row.
 */
function IndexBlock() {
  return (
    <div className="flex h-full flex-col justify-center gap-0.5 p-3 sm:p-4">
      <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">scanning files</p>
      {INDEX_FILES.map((file, i) => (
        <div
          key={`${file.depth}-${file.name}`}
          className="relative flex items-center gap-2 px-1.5 py-0.75 font-mono text-[10px] sm:text-[10.5px]"
        >
          {/* Per-row scan highlight — fades in/out as the scan passes. */}
          <span
            aria-hidden
            className="animate-narrative-index-row pointer-events-none absolute inset-0 bg-primary/15"
            style={{ animationDelay: `${i * 220}ms` }}
          />
          <span className="relative flex shrink-0 items-center" style={{ paddingLeft: `${file.depth * 10}px` }}>
            {file.isDir ? (
              <FolderIcon weight="duotone" className="size-3 text-muted-foreground" />
            ) : (
              <FileIcon className="size-3 text-muted-foreground/80" />
            )}
          </span>
          <span
            className={`relative min-w-0 flex-1 truncate ${
              file.isDir ? "text-muted-foreground" : "text-foreground/85"
            }`}
          >
            {file.name}
          </span>
          {/* "Indexed" check — pinned right; fades in once that row's been
              scanned and stays visible until the cycle resets. The class
              picks the row's keyframe variant so all five disappear in
              sync at 92%–100% of the loop instead of one-by-one. */}
          <CheckIcon
            weight="bold"
            aria-hidden
            className={`${file.checkClass} relative size-2.5 shrink-0 text-emerald-600 dark:text-emerald-400`}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Index-block file tree. Each entry carries its own check-animation
 * class so `INDEX_FILES` is the single source of truth for both the
 * rendered tree and the per-row keyframe binding — adding or removing
 * a row can no longer silently break the animation by leaving the old
 * `INDEX_CHECK_CLASSES` array out of sync.
 *
 * The `checkClass` values are listed as literal strings (not built via
 * template-literal at render time) so Tailwind/PostCSS class scanners
 * and any production purge step still see every variant in source. If
 * you add a row, add the matching `narrative-index-check-N` keyframe +
 * utility class in `index.css`.
 */
const INDEX_FILES: ReadonlyArray<{
  depth: number;
  name: string;
  isDir?: boolean;
  /** Tailwind utility that binds this row to its per-row check keyframe. */
  checkClass: string;
}> = [
  { depth: 0, name: "src/", isDir: true, checkClass: "animate-narrative-index-check-0" },
  { depth: 1, name: "main.tsx", checkClass: "animate-narrative-index-check-1" },
  { depth: 1, name: "App.tsx", checkClass: "animate-narrative-index-check-2" },
  { depth: 1, name: "router.tsx", checkClass: "animate-narrative-index-check-3" },
  { depth: 0, name: "README.md", checkClass: "animate-narrative-index-check-4" },
];

/**
 * Step 03 — cite. Same two-pane layout as the rest of the section
 * (answer card on top, code mini-frame underneath); the scrolling
 * happens *inside* the code frame only. Three coordinated beats over
 * the 7 s loop:
 *
 *   1. **Scroll** (0–30%) — the inner row stack of the code frame
 *      `translateY`s upward inside an `overflow: hidden` viewport, so
 *      the file reads as being skimmed top-to-bottom while the rest of
 *      the card stays put. GPU-accelerated; never reflows.
 *   2. **Mark** (40–92%) — the scroll has settled with line 42 in view
 *      and the existing primary-tinted highlighter sweep draws
 *      left-to-right across the cited row.
 *   3. **File** (65–92%) — *only after* the line is marked does the
 *      found-file chip surface in the answer card on top with the
 *      cited path (`src/auth.ts:42`), so the loop reads as
 *      "scroll → mark → file": a literal demo of an answer being
 *      grounded in a real source line.
 *
 * The cite card runs at a 7 s tempo (slower than the 5 s index card)
 * because three beats need more reading time than a single scan.
 * Keyframes live in `index.css` under `narrative-cite-*`.
 */
function CiteBlock() {
  return (
    <div className="grid h-full grid-rows-[auto_1fr] gap-2 p-3 sm:p-4">
      {/* Answer card with citation chip — chip surfaces only *after*
          the highlighter sweep finishes drawing on line 42, so the
          loop reads as "scroll → mark → file". The chip's reveal is
          opacity + transform only, so it never reflows the card. */}
      <div className="flex flex-col gap-1.5 border border-border bg-background/80 px-2.5 py-2">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">assistant</p>
        <div className="flex flex-col gap-1">
          <span aria-hidden className="block h-0.75 w-[88%] bg-foreground/20" />
          <span aria-hidden className="block h-0.75 w-[64%] bg-foreground/20" />
        </div>
        <span className="animate-narrative-cite-file mt-0.5 inline-flex w-fit items-center gap-1 border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.04em] text-primary">
          <FileIcon weight="duotone" aria-hidden className="size-2.5 shrink-0" />
          src/auth.ts:42
        </span>
      </div>

      {/* Code mini-frame — the inner row stack scrolls upward inside
          this `overflow: hidden` viewport so the document reads as
          being browsed from top to bottom; once it settles, the
          highlighter sweep paints line 42. */}
      <div className="relative overflow-hidden border border-border bg-background/80 px-2 py-2">
        <div className="animate-narrative-cite-scroll flex flex-col gap-0.75 font-mono text-[10px] leading-3.5 will-change-transform">
          {CITE_LINES.map(({ n, w, target }) => (
            <div key={n} className="relative flex items-center gap-2 py-px">
              <span className="w-4 shrink-0 text-right text-muted-foreground/45 tabular-nums">{n}</span>
              <span
                aria-hidden
                className={`block h-0.75 ${target ? "bg-foreground/55" : "bg-foreground/20"}`}
                style={{ width: w }}
              />
              {/* Highlighter sweep — only on the cited line. Anchored
                  to the left of the content area so it draws across
                  the line rather than ballooning outward from centre. */}
              {target ? (
                <span
                  aria-hidden
                  className="animate-narrative-cite-sweep pointer-events-none absolute inset-y-px left-6 right-1 bg-primary/30"
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Lines drawn in the scrolling code frame. The `narrative-cite-scroll`
 * keyframe pulls the stack upward by a fixed offset that lands the
 * `target: true` row near the vertical centre of the (smaller) code
 * frame viewport at rest. If you reorder rows or change
 * `CITE_LINES.length`, retune the keyframe's `translateY` value
 * (currently `-100px`, calibrated for the target at index 8 of 12
 * rows at the row pitch implied by `gap-[3px]`, `py-[1px]`, and
 * `leading-3.5` — about 19 px per row). The list starts well
 * before line 42 so the initial frame shows "the top of the file"
 * and the scroll reads as a downward skim.
 */
const CITE_LINES: ReadonlyArray<{ n: number; w: string; target?: boolean }> = [
  { n: 34, w: "58%" },
  { n: 35, w: "42%" },
  { n: 36, w: "70%" },
  { n: 37, w: "36%" },
  { n: 38, w: "64%" },
  { n: 39, w: "50%" },
  { n: 40, w: "74%" },
  { n: 41, w: "46%" },
  { n: 42, w: "88%", target: true },
  { n: 43, w: "38%" },
  { n: 44, w: "66%" },
  { n: 45, w: "48%" },
];
