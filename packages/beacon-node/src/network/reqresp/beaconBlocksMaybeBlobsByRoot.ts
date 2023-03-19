import {PeerId} from "@libp2p/interface-peer-id";
import {BeaconConfig} from "@lodestar/config";
import {phase0, deneb} from "@lodestar/types";
import {BlockInput} from "../../chain/blocks/types.js";
import {IReqRespBeaconNode} from "./interface.js";
import {matchBlockWithBlobs} from "./beaconBlocksMaybeBlobsByRange.js";

export async function beaconBlocksMaybeBlobsByRoot(
  config: BeaconConfig,
  reqResp: IReqRespBeaconNode,
  peerId: PeerId,
  request: phase0.BeaconBlocksByRootRequest
): Promise<BlockInput[]> {
  const allBlocks = await reqResp.beaconBlocksByRoot(peerId, request);
  const blobIdentifiers: deneb.BlobIdentifier[] = [];

  for (const block of allBlocks) {
    const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    const blobKzgCommitmentsLen = (block.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length ?? 0;
    for (let index = 0; index < blobKzgCommitmentsLen; index++) {
      blobIdentifiers.push({blockRoot, index});
    }
  }

  let allBlobSidecars: deneb.BlobSidecar[];
  if (blobIdentifiers.length > 0) {
    allBlobSidecars = await reqResp.blobSidecarsByRoot(peerId, blobIdentifiers);
  } else {
    allBlobSidecars = [];
  }

  // The last arg is to provide slot to which all blobs should be exausted in matching
  // and here it should be infinity since all bobs should match
  return matchBlockWithBlobs(config, allBlocks, allBlobSidecars, Infinity);
}
