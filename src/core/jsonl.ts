import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';

/**
 * Chunked readers for Claude Code session files. These files reach several
 * megabytes, so nothing reads a whole file unless the caller explicitly
 * asks for a full scan.
 */

const DEFAULT_CHUNK = 128 * 1024;

/** Read the first `bytes` of a file as UTF-8. */
export async function readHead(file: string, bytes = DEFAULT_CHUNK): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(bytes, size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Read the last `bytes` of a file as UTF-8. */
export async function readTail(file: string, bytes = DEFAULT_CHUNK): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

export type JsonlRecord = Record<string, unknown> & { type?: string };

/** Parse complete JSON lines out of a chunk, skipping partial edges. */
export function parseChunk(chunk: string): JsonlRecord[] {
  const records: JsonlRecord[] = [];
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as JsonlRecord);
    } catch {
      // Partial line at a chunk boundary, or a corrupt record.
    }
  }
  return records;
}

/**
 * Stream every record of a file. `onRecord` may return false to stop early,
 * which closes the stream without reading the rest.
 */
export async function streamRecords(
  file: string,
  onRecord: (record: JsonlRecord, index: number) => boolean | void,
): Promise<{ lines: number; invalid: number }> {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lines = 0;
  let invalid = 0;
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      lines += 1;
      let record: JsonlRecord;
      try {
        record = JSON.parse(line) as JsonlRecord;
      } catch {
        invalid += 1;
        continue;
      }
      if (onRecord(record, lines - 1) === false) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return { lines, invalid };
}
