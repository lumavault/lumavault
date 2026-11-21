import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Lists TypeScript or JavaScript source files under dir, including subfolders, in a stable
 * order. Skips tests and type declarations. A missing folder has no files.
 */
export async function listSourceFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
  return entries
    .filter((f) => /\.(ts|js)$/.test(f) && !/\.d\.ts$|\.test\.(ts|js)$/.test(f))
    .sort()
    .map((f) => join(dir, f));
}
