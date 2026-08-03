/**
 * Undo journal for multi-step filesystem operations. Every mutating step
 * records its inverse; on failure the whole operation rolls back in
 * reverse order. Individual rollback errors are collected, not thrown, so
 * one failed undo does not stop the rest.
 */
export class Journal {
  private undos: Array<{ label: string; undo: () => Promise<void> }> = [];

  record(label: string, undo: () => Promise<void>): void {
    this.undos.push({ label, undo });
  }

  async rollback(): Promise<string[]> {
    const errors: string[] = [];
    for (let i = this.undos.length - 1; i >= 0; i--) {
      const { label, undo } = this.undos[i];
      try {
        await undo();
      } catch (error) {
        errors.push(`${label}: ${(error as Error).message}`);
      }
    }
    this.undos = [];
    return errors;
  }
}
