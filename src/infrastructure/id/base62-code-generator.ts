import type { CodeGenerator } from "../../application/ports";
import type { IdSequence } from "./block-sequence";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = BigInt(ALPHABET.length);

/** Odd and not a multiple of 31, hence coprime with 62^n: the mapping below is a bijection. */
const MULTIPLIER = 2_654_435_761n;
const OFFSET = 0x9e3779b9n;

/**
 * Turns a monotonically increasing id into a fixed-length base62 code.
 * The id is first passed through a bijective scramble so that codes are
 * collision-free by construction yet not guessable or enumerable in order.
 */
export class Base62CodeGenerator implements CodeGenerator {
  private readonly space: bigint;

  constructor(
    private readonly sequence: IdSequence,
    private readonly length: number,
  ) {
    this.space = BASE ** BigInt(length);
  }

  async next(): Promise<string> {
    const id = BigInt(await this.sequence.nextId());
    if (id >= this.space) throw new Error("Short code space exhausted; increase CODE_LENGTH");
    return this.encode((id * MULTIPLIER + OFFSET) % this.space);
  }

  private encode(value: bigint): string {
    const chars = new Array<string>(this.length);
    let remaining = value;
    for (let i = this.length - 1; i >= 0; i--) {
      chars[i] = ALPHABET[Number(remaining % BASE)] as string;
      remaining /= BASE;
    }
    return chars.join("");
  }
}
