import React, { useEffect, useMemo, useState } from 'react';
import { Text } from 'ink';
import { SearchEngine } from '../../services/search/SearchEngine.js';
import { SearchHistory } from '../../services/search/SearchHistory.js';
import { SearchIndexer } from '../../services/search/SearchIndexer.js';
import type { ResultKind, SearchHit, WorkspaceIndex } from '../../services/search/types.js';
import { fit, highlighted } from '../highlight.js';
import { useTerminalSize } from '../useTerminalSize.js';
import {
  Modal,
  ModalLine,
  ROW_BACKGROUND,
  blankLine,
  rowPadding,
  textLine,
  useModalWidth,
  type Segment,
} from './Modal.js';
import { useOverlayInput, type PaletteSpec } from './OverlayContext.js';
import { resolveRowOffset } from './window.js';

/**
 * Global command palette.
 *
 * Two things live here: navigation, which selects a project or session, and
 * workspace actions, which change what the interface is doing. Neither is
 * executed by the palette. It reports what was chosen through `onSelect`
 * and App decides what that means, which is what keeps this component free
 * of every operation's semantics.
 *
 * Results come from the in-memory workspace index, so opening this never
 * starts a scan and never waits for one. A build still in flight simply
 * means fewer results for a moment.
 *
 * One category is visible at a time, chosen by a tab bar, and the active
 * tab owns the whole result area. That is what makes every hit reachable:
 * rendering all groups at once forced a per-group cap, and anything past
 * the cap could not be scrolled to because navigation ran on into the next
 * group instead of into the remainder.
 *
 * Recent searches are a tab like any other rather than a separate empty
 * state. That is what puts the Actions tab on screen before anything is
 * typed: an action nobody can see until they guess a matching word is not
 * discoverable, and discovery is the reason the tab exists.
 *
 * Only single-width characters appear inside the frame. Modal rows pad
 * their opaque background using text.length, so a wide glyph would leave
 * the interface behind the palette showing through the row.
 */

/** One rendered line. A hit takes two of them when there is room. */
type PaletteRow =
  | { kind: 'spacer' }
  | { kind: 'header'; title: string }
  | { kind: 'hit'; hit: SearchHit; pick: number }
  | { kind: 'hitSub'; hit: SearchHit }
  | { kind: 'recent'; query: string; pick: number }
  | { kind: 'note'; text: string; dim?: boolean };

/** What enter does. Recent entries refine the query; hits are selected. */
type Selection = { kind: 'hit'; hit: SearchHit } | { kind: 'recent'; query: string };

/**
 * One tab. Recent is not a ResultKind, because recent searches are a
 * palette affordance rather than something the search layer knows about.
 */
type PaletteGroup =
  | { key: 'recent'; title: string; entries: string[] }
  | { key: ResultKind; title: string; hits: SearchHit[] };

function groupCount(group: PaletteGroup): number {
  return 'hits' in group ? group.hits.length : group.entries.length;
}

/** Cursor and scroll offset, kept per tab so switching back restores both. */
interface TabState {
  index: number;
  scroll: number;
}

const ORIGIN: TabState = { index: 0, scroll: 0 };

/** State key used when there is no tab at all. */
const EMPTY_KEY = 'empty';

const PLACEHOLDER = 'Search projects, sessions and actions…';
const TITLE_COLOR: Record<ResultKind, string> = {
  project: 'blue',
  session: 'cyan',
  message: 'magenta',
  action: 'yellow',
};

/**
 * A result row. Written as a Text rather than a ModalLine because the title
 * carries per-character highlight markup, which ModalLine's flat segments
 * cannot express. It paints itself with ModalLine's own ROW_BACKGROUND and
 * rowPadding, so the one property that must never diverge, an opaque row,
 * has a single implementation.
 */
function HitLine({
  hit,
  selected,
  width,
}: {
  hit: SearchHit;
  selected: boolean;
  width: number;
}) {
  const meta = hit.meta ?? '';
  const metaColumn = meta ? Math.min(meta.length, Math.max(0, width - 14)) : 0;
  const metaUsed = metaColumn ? metaColumn + 2 : 0;
  const titleWidth = Math.max(8, width - 6 - metaUsed);
  const color = selected ? 'green' : hit.danger ? 'red' : TITLE_COLOR[hit.kind];

  return (
    <Text backgroundColor={ROW_BACKGROUND} wrap="truncate">
      <Text color="green" bold>
        {selected ? '  > ' : '    '}
      </Text>
      <Text color={color} bold={selected}>
        {highlighted('', hit.title, hit.highlights, titleWidth)}
      </Text>
      {metaColumn ? <Text dimColor>{`  ${fit(meta.slice(0, metaColumn), metaColumn)}`}</Text> : null}
      {rowPadding(width, 4 + titleWidth + metaUsed)}
    </Text>
  );
}

/**
 * Category tabs, in the same visual language as the inspector's TabBar:
 * the active tab is a filled blue chip, the rest sit muted.
 *
 * Unlike TabBar these carry no number prefix. The inspector can bind 1..4
 * because its panel is not a text field; here every printable character
 * has to reach the query, so tabs are reachable by tab/shift+tab only.
 */
function tabSegments(groups: PaletteGroup[], activeIndex: number, width: number): Segment[] {
  const segments: Segment[] = [{ text: '  ' }];
  let used = 2;

  groups.forEach((group, i) => {
    const label = ` ${group.title} (${groupCount(group)}) `;
    const gap = i > 0 ? 1 : 0;
    // Drop whole tabs rather than render a half one: a clipped chip reads
    // as a rendering fault, while a missing one is merely off-screen.
    if (used + gap + label.length > width) return;
    if (gap) segments.push({ text: ' ' });
    segments.push(
      i === activeIndex
        ? { text: label, backgroundColor: 'blue', color: 'white', bold: true }
        : { text: label, color: 'gray', dim: true },
    );
    used += gap + label.length;
  });

  return segments;
}

export function CommandPalette({
  overlay,
  onClose,
}: {
  overlay: PaletteSpec & { id: number };
  onClose: () => void;
}) {
  const { columns, rows: terminalRows } = useTerminalSize();
  const [query, setQuery] = useState('');
  const [hitGroups, setHitGroups] = useState<Array<{ kind: ResultKind; title: string; hits: SearchHit[] }>>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [tabState, setTabState] = useState<Record<string, TabState>>({});
  const [snapshot, setSnapshot] = useState<WorkspaceIndex>(() => SearchIndexer.snapshot());

  // Re-render as the background build publishes more of the workspace.
  useEffect(() => SearchIndexer.subscribe(setSnapshot), []);

  // Runs on an empty query too. The engine answers that with its browsable
  // providers only, which is how the Actions tab is on screen from the
  // moment the palette opens without every project loading into a tab.
  useEffect(() => {
    let cancelled = false;
    SearchEngine.search(query, snapshot, overlay.actions)
      .then((result) => {
        if (!cancelled) setHitGroups(result);
      })
      .catch(() => {
        if (!cancelled) setHitGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [query, snapshot, overlay.actions]);

  const groups = useMemo<PaletteGroup[]>(() => {
    const list: PaletteGroup[] = [];
    // History only changes on select, which closes the palette, so reading
    // it during render is enough.
    const recent = query.trim() ? [] : SearchHistory.list();
    if (recent.length > 0) list.push({ key: 'recent', title: 'Recent', entries: recent });
    for (const group of hitGroups) list.push({ key: group.kind, title: group.title, hits: group.hits });
    return list;
  }, [query, hitGroups]);

  /**
   * Which tab enter would act on, when the user has not picked one.
   *
   * Not the first tab. Tab order is fixed so a kind of result is always in
   * the same place, but fuzzy subsequence matching means a long project
   * path matches almost any word, so "repair" would otherwise open on a
   * project that merely contains those letters in order. Every provider
   * scores through FilterService, whose tiers dominate the score, so the
   * highest scoring group is the one that matched most directly.
   */
  const bestIndex = useMemo(() => {
    if (!query.trim()) return 0;
    let best = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    groups.forEach((group, i) => {
      if (!('hits' in group)) return;
      // Providers return their hits already ranked, so the first is the best.
      const top = group.hits[0]?.score ?? Number.NEGATIVE_INFINITY;
      if (top > bestScore) {
        bestScore = top;
        best = i;
      }
    });
    return best;
  }, [groups, query]);

  // The active tab is derived, never stored as an index. SearchEngine drops
  // empty groups, so falling back is exactly the "never land on an empty
  // tab" rule: if the category the user was on stops matching, they land on
  // one that still has results rather than on nothing. Deriving it also
  // means no effect can leave the two out of sync. With no query the
  // fallback is the first group, which is Recent when there is history and
  // Actions otherwise.
  const chosenIndex = groups.findIndex((group) => group.key === activeKey);
  const activeIndex = chosenIndex >= 0 ? chosenIndex : bestIndex;
  const activeGroup: PaletteGroup | null = groups[activeIndex] ?? null;
  const stateKey = activeGroup?.key ?? EMPTY_KEY;

  // Width follows the terminal but stays inside a readable band.
  const width = useModalWidth(Math.max(40, Math.min(100, Math.round(columns * 0.7))));
  const compact = terminalRows < 18;
  const tiny = terminalRows < 10;
  const showTabs = groups.length > 0;
  // border, input, two rules, footer, and the padding around the body, plus
  // the tab row and its rule when a search is showing categories. Tiny mode
  // renders no rules at all, so tabs cost it one line rather than two.
  const chrome = (tiny ? 5 : compact ? 7 : 9) + (showTabs ? (tiny ? 1 : 2) : 0);
  const twoLine = !compact && width >= 50;

  const { rowList, picks } = useMemo(() => {
    const list: PaletteRow[] = [];
    const selections: Selection[] = [];

    if (!activeGroup) {
      list.push({
        kind: 'note',
        text: query.trim()
          ? 'No matching projects, sessions or actions.'
          : 'Type to search every project and session in the workspace.',
        dim: !query.trim(),
      });
      list.push({ kind: 'spacer' });
      list.push({ kind: 'note', text: 'Press esc to close.', dim: true });
      if (snapshot.status !== 'ready' && snapshot.total > 0) {
        list.push({
          kind: 'note',
          text: `Still indexing ${snapshot.done}/${snapshot.total} sessions.`,
          dim: true,
        });
      }
      return { rowList: list, picks: selections };
    }

    if ('entries' in activeGroup) {
      for (const entry of activeGroup.entries) {
        selections.push({ kind: 'recent', query: entry });
        list.push({ kind: 'recent', query: entry, pick: selections.length - 1 });
      }
      return { rowList: list, picks: selections };
    }

    // Only the active category is rendered, and all of it: the tab owns the
    // whole result area, so the viewport is the only limit on what can be
    // scrolled to.
    let section: string | undefined;
    for (const hit of activeGroup.hits) {
      if (hit.section && hit.section !== section) {
        section = hit.section;
        list.push({ kind: 'header', title: hit.section });
      }
      selections.push({ kind: 'hit', hit });
      list.push({ kind: 'hit', hit, pick: selections.length - 1 });
      if (twoLine && hit.subtitle) list.push({ kind: 'hitSub', hit });
    }
    return { rowList: list, picks: selections };
  }, [query, activeGroup, twoLine, snapshot.status, snapshot.done, snapshot.total]);

  const rowOfPick = useMemo(() => {
    const map: number[] = [];
    rowList.forEach((row, i) => {
      if (row.kind === 'hit' || row.kind === 'recent') map[row.pick] = i;
    });
    return map;
  }, [rowList]);

  const modalHeight = Math.max(tiny ? 6 : 8, Math.floor(terminalRows * 0.6));
  // Bounded by the real terminal budget as well as modalHeight: modalHeight
  // alone is not monotonic across the tiny/compact thresholds (chrome steps
  // 5 -> 7 -> 9 there), so without this a taller terminal could otherwise
  // show fewer result rows than a shorter one.
  const viewport = Math.max(
    1,
    Math.min(rowList.length, terminalRows - chrome, Math.max(3, modalHeight - chrome)),
  );

  const resolveOffset = (base: number, pick: number) => {
    const row = rowOfPick[pick] ?? 0;
    let next = resolveRowOffset({
      base,
      row,
      viewport,
      rowCount: rowList.length,
      headerAbove: rowList[row - 1]?.kind === 'header',
    });
    // Bring a hit's subtitle line along with it, unless the viewport is so
    // short that doing so would push the title itself off screen.
    if (viewport >= 2 && rowList[row + 1]?.kind === 'hitSub') {
      next = resolveRowOffset({
        base: next,
        row: row + 1,
        viewport,
        rowCount: rowList.length,
        headerAbove: false,
      });
    }
    return next;
  };

  const current = tabState[stateKey] ?? ORIGIN;

  // picks can shrink out from under the selection: a rescan re-runs the
  // search effect (it depends on snapshot) and SearchIndexer.build() wipes
  // sessions back to empty at the start of a rebuild, so an index that
  // pointed at a valid hit a moment ago can point past the end of the new,
  // shorter list. Clamping on read (rather than only in select()) keeps a
  // row selected and enter functional through that window, instead of
  // waiting for the next arrow key to recover.
  const active = Math.min(current.index, Math.max(0, picks.length - 1));

  const select = (next: number) => {
    const clamped = Math.max(0, Math.min(picks.length - 1, next));
    setTabState((prev) => {
      const state = prev[stateKey] ?? ORIGIN;
      return { ...prev, [stateKey]: { index: clamped, scroll: resolveOffset(state.scroll, clamped) } };
    });
  };

  /** Editing the query invalidates every tab's cursor, so all of them reset. */
  const retype = (next: string) => {
    setQuery(next);
    setTabState({});
  };

  const switchTab = (delta: number) => {
    if (groups.length < 2) return;
    const next = (activeIndex + delta + groups.length) % groups.length;
    setActiveKey(groups[next].key);
  };

  useOverlayInput(overlay.id, (input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    // Tab before the printable branch: Ink zeroes `input` for tab, but
    // keeping the order explicit means a future binding cannot swallow it.
    if (key.tab) {
      switchTab(key.shift ? -1 : 1);
      return;
    }
    // Arrows only for the list. Every printable character has to reach the
    // query, so there is no j/k navigation here the way there is in the
    // action menu.
    if (key.upArrow) {
      select(active - 1);
      return;
    }
    if (key.downArrow) {
      select(active + 1);
      return;
    }
    if (key.pageUp) {
      select(active - viewport);
      return;
    }
    if (key.pageDown) {
      select(active + viewport);
      return;
    }
    if (key.return) {
      const choice = picks[active];
      if (!choice) return;
      if (choice.kind === 'recent') {
        retype(choice.query);
        return;
      }
      // Only a query that produced a selection is worth remembering, and
      // only a typed one: browsing to an action recorded an empty query.
      if (query.trim()) SearchHistory.record(query);
      // Close first. Several actions open their own dialog, and running
      // before closing would leave the palette sitting under it.
      onClose();
      overlay.onSelect(choice.hit.target);
      return;
    }
    if (key.ctrl && (input === 'u' || input === 'w')) {
      retype('');
      return;
    }
    if (key.backspace || key.delete) {
      retype(query.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      retype(query + input);
    }
  });

  const offset = resolveOffset(current.scroll, active);
  const rule = (
    <ModalLine
      width={width}
      segments={[{ text: `  ${'─'.repeat(Math.max(0, width - 4))}`, dim: true }]}
    />
  );

  const renderRow = (row: PaletteRow, key: number) => {
    switch (row.kind) {
      case 'spacer':
        return <React.Fragment key={key}>{blankLine(width)}</React.Fragment>;

      case 'header':
        return (
          <ModalLine
            key={key}
            width={width}
            segments={[{ text: '  ' }, { text: row.title.toUpperCase(), bold: true, dim: true }]}
          />
        );

      case 'note':
        return (
          <React.Fragment key={key}>{textLine(row.text, width, { dim: row.dim })}</React.Fragment>
        );

      case 'hitSub': {
        const text = (row.hit.subtitle ?? '').slice(0, Math.max(0, width - 8));
        return (
          <ModalLine key={key} width={width} segments={[{ text: `      ${text}`, dim: true }]} />
        );
      }

      case 'recent': {
        const selected = row.pick === active;
        return (
          <ModalLine
            key={key}
            width={width}
            segments={[
              { text: selected ? '  > ' : '    ', color: 'green', bold: true },
              { text: row.query.slice(0, Math.max(0, width - 6)), bold: selected },
            ]}
          />
        );
      }

      case 'hit':
        return <HitLine key={key} hit={row.hit} selected={row.pick === active} width={width} />;
    }
  };

  const counter = picks.length > 0 ? `${active + 1}/${picks.length}` : '';
  const indexing =
    snapshot.status !== 'ready' && snapshot.total > 0
      ? `indexing ${snapshot.done}/${snapshot.total}`
      : '';
  const separator = '  ·  ';
  const trailing = [indexing, counter].filter(Boolean).join(separator);
  const room = Math.max(0, width - 4 - (trailing ? trailing.length + separator.length : 0));
  // What enter does depends on the tab, so the footer has to say which.
  const verb = !activeGroup
    ? 'jumps'
    : 'entries' in activeGroup
      ? 'searches again'
      : activeGroup.key === 'action'
        ? 'runs'
        : 'jumps';
  const long =
    groups.length > 1
      ? `enter ${verb}, tab switches category, esc closes`
      : `enter ${verb}, esc closes`;
  const short = groups.length > 1 ? `enter ${verb}, tab category` : `enter ${verb}`;
  const hint = long.length <= room ? long : short.length <= room ? short : '';
  const footer = hint && trailing ? `${hint}${separator}${trailing}` : hint || trailing;

  const visibleQuery = query.length > width - 8 ? `…${query.slice(-(width - 9))}` : query;

  return (
    <Modal borderColor="blue" borderStyle="round" width={width}>
      {compact ? null : blankLine(width)}
      <ModalLine
        width={width}
        segments={[
          { text: '  ' },
          { text: '> ', color: 'blue', bold: true },
          query
            ? { text: visibleQuery, bold: true }
            : { text: PLACEHOLDER.slice(0, Math.max(0, width - 6)), dim: true },
          { text: ' ', inverse: true },
        ]}
      />
      {tiny ? null : rule}

      {showTabs ? <ModalLine width={width} segments={tabSegments(groups, activeIndex, width)} /> : null}
      {showTabs && !tiny ? rule : null}

      {rowList.slice(offset, offset + viewport).map((row, i) => renderRow(row, offset + i))}

      {tiny ? null : rule}
      {textLine(footer, width, { dim: true })}
      {compact ? null : blankLine(width)}
    </Modal>
  );
}
