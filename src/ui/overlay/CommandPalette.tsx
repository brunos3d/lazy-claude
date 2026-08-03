import React, { useEffect, useMemo, useState } from 'react';
import { Text } from 'ink';
import { SearchEngine } from '../../services/search/SearchEngine.js';
import { SearchHistory } from '../../services/search/SearchHistory.js';
import { SearchIndexer } from '../../services/search/SearchIndexer.js';
import type { SearchGroup, SearchHit, WorkspaceIndex } from '../../services/search/types.js';
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
 * A "go to" system, not an action launcher: everything here navigates.
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

/** What enter does. Recent entries refine the query; hits navigate. */
type Selection = { kind: 'hit'; hit: SearchHit } | { kind: 'recent'; query: string };

/** Cursor and scroll offset, kept per tab so switching back restores both. */
interface TabState {
  index: number;
  scroll: number;
}

const ORIGIN: TabState = { index: 0, scroll: 0 };

/** State key for the no-query view, which has results but no tab bar. */
const RECENT_KEY = 'recent';

const PLACEHOLDER = 'Search projects, sessions, messages…';
const TITLE_COLOR: Record<SearchHit['kind'], string> = {
  project: 'blue',
  session: 'cyan',
  message: 'magenta',
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

  return (
    <Text backgroundColor={ROW_BACKGROUND} wrap="truncate">
      <Text color="green" bold>
        {selected ? '  > ' : '    '}
      </Text>
      <Text color={selected ? 'green' : TITLE_COLOR[hit.kind]} bold={selected}>
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
function tabSegments(groups: SearchGroup[], activeIndex: number, width: number): Segment[] {
  const segments: Segment[] = [{ text: '  ' }];
  let used = 2;

  groups.forEach((group, i) => {
    const label = ` ${group.title} (${group.hits.length}) `;
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
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [tabState, setTabState] = useState<Record<string, TabState>>({});
  const [snapshot, setSnapshot] = useState<WorkspaceIndex>(() => SearchIndexer.snapshot());

  // Re-render as the background build publishes more of the workspace.
  useEffect(() => SearchIndexer.subscribe(setSnapshot), []);

  useEffect(() => {
    if (!query.trim()) {
      setGroups([]);
      return;
    }
    let cancelled = false;
    SearchEngine.search(query, snapshot)
      .then((result) => {
        if (!cancelled) setGroups(result);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [query, snapshot]);

  // The active tab is derived, never stored as an index. SearchEngine drops
  // empty groups, so falling back to the first group is exactly the "never
  // land on an empty tab" rule: if the category the user was on stops
  // matching, they land on one that still has results rather than on
  // nothing. Deriving it also means no effect can leave the two out of sync.
  const activeIndex = Math.max(
    0,
    groups.findIndex((group) => group.kind === activeKind),
  );
  const activeGroup: SearchGroup | null = groups[activeIndex] ?? null;
  const stateKey = activeGroup?.kind ?? RECENT_KEY;

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
    const trimmed = query.trim();

    if (!trimmed) {
      // History only changes on select, which closes the palette, so
      // reading it once per query state is enough.
      const recent = SearchHistory.list();
      if (recent.length === 0) {
        list.push({
          kind: 'note',
          text: 'Type to search every project and session in the workspace.',
          dim: true,
        });
      } else {
        list.push({ kind: 'header', title: 'Recent' });
        for (const entry of recent) {
          selections.push({ kind: 'recent', query: entry });
          list.push({ kind: 'recent', query: entry, pick: selections.length - 1 });
        }
      }
      return { rowList: list, picks: selections };
    }

    if (!activeGroup) {
      list.push({ kind: 'note', text: 'No matching projects or sessions.' });
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

    // Only the active category is rendered, and all of it: the tab owns the
    // whole result area, so the viewport is the only limit on what can be
    // scrolled to.
    for (const hit of activeGroup.hits) {
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
    setActiveKind(groups[next].kind);
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
      // Only a query that produced a jump is worth remembering.
      SearchHistory.record(query);
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
  const long =
    groups.length > 1
      ? 'enter jumps, tab switches category, esc closes'
      : 'enter jumps to the result, esc closes';
  const short = groups.length > 1 ? 'enter jump, tab category' : 'enter jump, esc close';
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
