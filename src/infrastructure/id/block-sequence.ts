export interface IdSequence {
  nextId(): Promise<number>;
}

/** Reserves `size` consecutive ids from shared storage and returns the first. */
export interface BlockAllocator {
  allocate(size: number): Promise<number>;
}

/**
 * Hands out ids from a locally reserved block, touching shared storage only
 * once per `blockSize` ids. Instances never overlap, so no coordination is
 * needed on the create path.
 */
export class BlockSequence implements IdSequence {
  private cursor = 0;
  private end = 0;
  private refill: Promise<void> | null = null;

  constructor(
    private readonly allocator: BlockAllocator,
    private readonly blockSize: number,
  ) {}

  async nextId(): Promise<number> {
    while (this.cursor >= this.end) await this.refillBlock();
    return this.cursor++;
  }

  private refillBlock(): Promise<void> {
    this.refill ??= this.allocator
      .allocate(this.blockSize)
      .then((start) => {
        this.cursor = start;
        this.end = start + this.blockSize;
      })
      .finally(() => {
        this.refill = null;
      });
    return this.refill;
  }
}
