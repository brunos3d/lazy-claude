import React from 'react';
import os from 'node:os';
import { Box, Text } from 'ink';
import type { Project } from '../services/DiscoveryService.js';
import type { SessionDetail, SessionEntry } from '../services/SessionService.js';
import { formatBytes, formatKb, formatRelativeTime, shortenPath } from '../core/format.js';
import { Panel } from './Panel.js';

interface DetailPanelProps {
  height: number;
  session: SessionEntry | null;
  detail: SessionDetail | null;
  project: Project | null;
  showingSession: boolean;
  allSummary: { projects: number; sessions: number; broken: number; orphans: number } | null;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Text wrap="truncate">
      <Text dimColor>{label.padEnd(10)}</Text>
      {value}
    </Text>
  );
}

export function DetailPanel({
  height,
  session,
  detail,
  project,
  showingSession,
  allSummary,
}: DetailPanelProps) {
  const home = os.homedir();

  return (
    <Panel title="Detail" focused={false} height={height}>
      <Box flexDirection="column" paddingX={1}>
        {showingSession && session ? (
          <>
            <Row label="Session" value={session.id} />
            <Row
              label="Project"
              value={detail?.cwd ? shortenPath(detail.cwd, home) : session.encoded}
            />
            <Row
              label="Modified"
              value={`${formatRelativeTime(session.modifiedAt)} (${session.modifiedAt.toLocaleString()})`}
            />
            <Row
              label="Size"
              value={`${formatBytes(session.sizeBytes)}${session.archived ? '  [archived]' : ''}`}
            />
            {detail?.summary ? <Row label="Summary" value={detail.summary} /> : null}
            {detail && detail.invalidRecords > 0 ? (
              <Row label="Integrity" value={`${detail.invalidRecords} invalid record(s) in scanned range`} />
            ) : null}
            {detail?.firstMessage ? (
              <Box marginTop={1} flexDirection="column">
                <Text dimColor>First message</Text>
                <Text wrap="wrap">{detail.firstMessage}</Text>
              </Box>
            ) : detail ? (
              <Text dimColor>No user message found in scanned records.</Text>
            ) : (
              <Text dimColor>Loading…</Text>
            )}
          </>
        ) : project ? (
          <>
            <Row
              label="Path"
              value={project.orphaned ? project.encoded : shortenPath(project.path, home)}
            />
            <Row
              label="Status"
              value={
                project.orphaned
                  ? 'orphaned session folder (project path unknown)'
                  : project.exists
                    ? 'healthy'
                    : 'missing (project directory not found)'
              }
            />
            <Row label="Sessions" value={String(project.sessions)} />
            <Row label="Size" value={`sessions ${formatKb(project.sessionSizeKb)}`} />
            {project.lastActivity > 0 ? (
              <Row
                label="Activity"
                value={formatRelativeTime(new Date(project.lastActivity * 1000))}
              />
            ) : null}
          </>
        ) : allSummary ? (
          <>
            <Row label="Scope" value="All Claude Code projects on this machine" />
            <Row label="Projects" value={String(allSummary.projects)} />
            <Row label="Sessions" value={String(allSummary.sessions)} />
            <Row
              label="Health"
              value={`${allSummary.broken} missing, ${allSummary.orphans} orphaned`}
            />
          </>
        ) : (
          <Text dimColor>Nothing selected.</Text>
        )}
      </Box>
    </Panel>
  );
}
