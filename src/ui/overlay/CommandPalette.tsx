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
 * Only single-width characters appear inside the frame. ModalLine pads its
 * opaque background using text.length, so a wide glyph would leave the
 * interface behind the palette showing through the row.
 */

/** One rendered line. A hit takes two of them when there is room. */
type PaletteRow =
  | { kind: 'spacer' }
  | { kind: 'header'; title: string }
  | { kind: 'hit'; hit: SearchHit; pick: number }
  | { kind: 'hitSub'; hit: SearchHit }
  | { kind: 'recent'; query: string; pick: number }
  | { kind: 'more'; count: number }
  | { kind: 'note'; text: string; dim?: boolean };

/** What enter does. Recent entries refine the query; hits navigate. */
type Selection = { kind: 'hit'; hit: SearchHit } | { kind: 'recent'; query: string };

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
  const [index, setIndex] = useState(0);
  const [scroll, setScroll] = useState(0);
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

  // Width follows the terminal but stays inside a readable band.
  const width = useModalWidth(Math.max(40, Math.min(100, Math.round(columns * 0.7))));
  const compact = terminalRows < 18;
  const tiny = terminalRows < 10;
  // border, input, two rules, footer, and the padding around the body.
  const chrome = tiny ? 5 : compact ? 7 : 9;
  const twoLine = !compact && width >= 50;

  const { rowList, picks } = useMemo(() => {
    const list: PaletteRow[] = [];
    const selections: Selection[] = [];
    const trimmed = query.trim();

    const pushHit = (hit: SearchHit) => {
      selections.push({ kind: 'hit', hit });
      list.push({ kind: 'hit', hit, pick: selections.length - 1 });
      if (twoLine && hit.subtitle) list.push({ kind: 'hitSub', hit });
    };

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

    if (groups.length === 0) {
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

    groups.forEach((group, groupIndex) => {
      if (groupIndex > 0) list.push({ kind: 'spacer' });
      list.push({ kind: 'header', title: group.title });
      for (const hit of group.hits) pushHit(hit);
      if (group.total > group.hits.length) {
        list.push({ kind: 'more', count: group.total - group.hits.length });
      }
    });
    return { rowList: list, picks: selections };
  }, [query, groups, twoLine, snapshot.status, snapshot.done, snapshot.total]);

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

  const select = (next: number) => {
    const clamped = Math.max(0, Math.min(picks.length - 1, next));
    setIndex(clamped);
    setScroll((s) => resolveOffset(s, clamped));
  };

  // picks can shrink out from under the selection: a rescan re-runs the
  // search effect (it depends on snapshot) and SearchIndexer.build() wipes
  // sessions back to empty at the start of a rebuild, so an index that
  // pointed at a valid hit a moment ago can point past the end of the new,
  // shorter list. Clamping on read (rather than only in select()) keeps a
  // row selected and enter functional through that window, instead of
  // waiting for the next arrow key to recover.
  const active = Math.min(index, Math.max(0, picks.length - 1));

  useOverlayInput(overlay.id, (input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    // Arrows only. Every printable character has to reach the query, so
    // there is no j/k navigation here the way there is in the action menu.
    if (key.upArrow) {
      select(index - 1);
      return;
    }
    if (key.downArrow) {
      select(index + 1);
      return;
    }
    if (key.pageUp) {
      select(index - viewport);
      return;
    }
    if (key.pageDown) {
      select(index + viewport);
      return;
    }
    if (key.return) {
      const choice = picks[active];
      if (!choice) return;
      if (choice.kind === 'recent') {
        setQuery(choice.query);
        setIndex(0);
        setScroll(0);
        return;
      }
      // Only a query that produced a jump is worth remembering.
      SearchHistory.record(query);
      onClose();
      overlay.onSelect(choice.hit.target);
      return;
    }
    if (key.ctrl && (input === 'u' || input === 'w')) {
      setQuery('');
      setIndex(0);
      setScroll(0);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setIndex(0);
      setScroll(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setIndex(0);
      setScroll(0);
    }
  });

  const offset = resolveOffset(scroll, active);
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

      case 'more':
        return (
          <ModalLine
            key={key}
            width={width}
            segments={[{ text: `      +${row.count} more`, dim: true }]}
          />
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

  const counter = rowList.length > viewport && picks.length > 0 ? `${active + 1}/${picks.length}` : '';
  const indexing =
    snapshot.status !== 'ready' && snapshot.total > 0
      ? `indexing ${snapshot.done}/${snapshot.total}`
      : '';
  const separator = '  ·  ';
  const trailing = [indexing, counter].filter(Boolean).join(separator);
  const room = Math.max(0, width - 4 - (trailing ? trailing.length + separator.length : 0));
  const long = 'enter jumps to the result, esc closes';
  const short = 'enter jump, esc close';
  const hint = long.length <= room ? long : short.length <= room ? short : '';
  const footer = hint && trailing ? `${hint}${separator}${trailing}` : hint || trailing;

  const visibleQuery =
    query.length > width - 8 ? `…${query.slice(-(width - 9))}` : query;

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

      {rowList.slice(offset, offset + viewport).map((row, i) => renderRow(row, offset + i))}

      {tiny ? null : rule}
      {textLine(footer, width, { dim: true })}
      {compact ? null : blankLine(width)}
    </Modal>
  );
}
