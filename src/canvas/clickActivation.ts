/** One pointer gesture that may become a card activation. */
interface ActivationCandidate {
  itemId: string;
  pointerId: number;
}

/** Separates click activation from drag selection. tldraw remains responsible
 * for selecting and translating shapes; this tracker only recognizes a
 * completed, unmodified primary-button click on one item. */
export class ClickActivation {
  private candidate: ActivationCandidate | null = null;

  /** Begin tracking a possible activation. Invalid starts clear any older
   * gesture so stale candidates cannot survive another pointer-down. */
  pointerDown({
    itemId,
    pointerId,
    button,
    modified,
  }: {
    itemId: string | null;
    pointerId: number;
    button: number;
    modified: boolean;
  }) {
    this.candidate =
      itemId !== null && button === 0 && !modified
        ? { itemId, pointerId }
        : null;
  }

  /** Cancel activation once tldraw recognizes the pointer as a drag. */
  pointerMove(pointerId: number, dragging: boolean) {
    if (
      dragging &&
      this.candidate !== null &&
      this.candidate.pointerId === pointerId
    ) {
      this.candidate = null;
    }
  }

  /** Complete the gesture. Returns the item only when pointer-down and
   * pointer-up belong to the same item and pointer. */
  pointerUp(pointerId: number, itemId: string | null): string | null {
    const candidate = this.candidate;
    this.candidate = null;
    if (
      candidate === null ||
      candidate.pointerId !== pointerId ||
      candidate.itemId !== itemId
    ) {
      return null;
    }
    return candidate.itemId;
  }

  /** Cancel an incomplete gesture after interruption or teardown. */
  cancel() {
    this.candidate = null;
  }
}
