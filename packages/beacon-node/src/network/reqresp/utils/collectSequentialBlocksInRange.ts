import {EncodedPayloadBytesIncoming} from "@lodestar/reqresp";
import {phase0, Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {getSlotFromSignedBeaconBlock} from "../../../util/multifork.js";

/**
 * Asserts a response from BeaconBlocksByRange respects the request and is sequential
 * Note: MUST allow missing block for skipped slots.
 */
export async function collectSequentialBlocksInRange(
  blockStream: AsyncIterable<EncodedPayloadBytesIncoming>,
  {count, startSlot}: Pick<phase0.BeaconBlocksByRangeRequest, "count" | "startSlot">
): Promise<EncodedPayloadBytesIncoming[]> {
  const blocks: EncodedPayloadBytesIncoming[] = [];
  const blockSlots: Slot[] = [];

  for await (const block of blockStream) {
    const blockSlot = getSlotFromSignedBeaconBlock(block.bytes);

    // Note: step is deprecated and assumed to be 1
    if (blockSlot >= startSlot + count) {
      throw new BlocksByRangeError({code: BlocksByRangeErrorCode.OVER_MAX_SLOT});
    }

    if (blockSlot < startSlot) {
      throw new BlocksByRangeError({code: BlocksByRangeErrorCode.UNDER_START_SLOT});
    }

    const prevBlockSlot = blockSlots.length === 0 ? null : blockSlots[blockSlots.length - 1];
    if (prevBlockSlot !== null) {
      if (prevBlockSlot >= blockSlot) {
        throw new BlocksByRangeError({code: BlocksByRangeErrorCode.BAD_SEQUENCE});
      }
    }

    blocks.push(block);
    if (blocks.length >= count) {
      break; // Done, collected all blocks
    }
  }

  return blocks;
}

export enum BlocksByRangeErrorCode {
  UNDER_START_SLOT = "BLOCKS_BY_RANGE_ERROR_UNDER_START_SLOT",
  OVER_MAX_SLOT = "BLOCKS_BY_RANGE_ERROR_OVER_MAX_SLOT",
  BAD_SEQUENCE = "BLOCKS_BY_RANGE_ERROR_BAD_SEQUENCE",
}

type BlocksByRangeErrorType =
  | {code: BlocksByRangeErrorCode.UNDER_START_SLOT}
  | {code: BlocksByRangeErrorCode.OVER_MAX_SLOT}
  | {code: BlocksByRangeErrorCode.BAD_SEQUENCE};

export class BlocksByRangeError extends LodestarError<BlocksByRangeErrorType> {}
