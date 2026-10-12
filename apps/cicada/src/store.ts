import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Where a session keeps the small files that must survive a restart: its signing log and open executions. */
export interface SessionStore {
  read(name: string): string | undefined;
  write(name: string, data: string): void;
}

/** Files under `dir`, written atomically (temporary file flushed to disk, then rename). */
export function fileStore(dir: string): SessionStore {
  return {
    read(name) {
      const path = join(dir, name);
      return existsSync(path) ? readFileSync(path, "utf8") : undefined;
    },
    write(name, data) {
      mkdirSync(dir, { recursive: true });
      const temporary = join(dir, `${name}.tmp`);
      const fd = openSync(temporary, "w");
      try {
        writeSync(fd, data);
        // Without it a power loss can leave the rename on disk ahead of the data, and the file reads back empty.
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, join(dir, name));
    },
  };
}

/** Writes `data` to `path` atomically, creating its folder. */
export function writeFileAtomic(path: string, data: string): void {
  fileStore(dirname(path)).write(basename(path), data);
}

/** Keeps everything in memory: the command-line server and tests. */
export function memoryStore(): SessionStore {
  const files = new Map<string, string>();
  return { read: (name) => files.get(name), write: (name, data) => void files.set(name, data) };
}
