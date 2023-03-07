import {EncodedPayloadBytesOutgoing, EncodedPayloadType, ContextBytesType} from "@lodestar/reqresp";
import {phase0, Slot} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {getSlotFromSignedBeaconBlock} from "../../../util/multifork.js";

export async function* onBeaconBlocksByRoot(
  requestBody: phase0.BeaconBlocksByRootRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<EncodedPayloadBytesOutgoing> {
  for (const blockRoot of requestBody) {
    const root = blockRoot;
    const summary = chain.forkChoice.getBlock(root);
    let blockBytes: Uint8Array | null = null;

    // finalized block has summary in forkchoice but it stays in blockArchive db
    if (summary) {
      blockBytes = await db.block.getBinary(root);
    }

    let slot: Slot | undefined = undefined;
    if (!blockBytes) {
      const blockEntry = await db.blockArchive.getBinaryEntryByRoot(root);
      if (blockEntry) {
        slot = blockEntry.key;
        blockBytes = blockEntry.value;
      }
    }
    if (blockBytes) {
      yield {
        type: EncodedPayloadType.bytes,
        bytes: blockBytes,
        contextBytes: {
          type: ContextBytesType.ForkDigest,
          fork: chain.config.getForkName(slot ?? getSlotFromSignedBeaconBlock(blockBytes)),
        },
      };
    }
  }
}
