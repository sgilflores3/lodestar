import {deneb, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {ContextBytesType, Encoding, ProtocolDefinitionGenerator} from "../types.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const BlobSidecarsByRoot: ProtocolDefinitionGenerator<deneb.BlobSidecarsByRootRequest, deneb.BlobSidecar> = (
  modules,
  handler
) => {
  return {
    method: "blob_sidecars_by_root",
    version: 1,
    encoding: Encoding.SSZ_SNAPPY,
    handler,
    requestType: () => ssz.deneb.BlobSidecarsByRootRequest,
    // TODO: Make it fork compliant
    responseType: () => ssz.deneb.BlobSidecar,
    renderRequestBody: (req) => req.map(({blockRoot, index}) => `${toHex(blockRoot)}-${index}`).join(","),
    contextBytes: {
      type: ContextBytesType.ForkDigest,
      forkDigestContext: modules.config,
      forkFromResponse: (blobsSidecar) => modules.config.getForkName(blobsSidecar.slot),
    },
    inboundRateLimits: {
      // TODO DENEB: For now same value as BeaconBlocksByRoot https://github.com/sigp/lighthouse/blob/bf533c8e42cc73c35730e285c21df8add0195369/beacon_node/lighthouse_network/src/rpc/mod.rs#L118-L130
      byPeer: {quota: 128, quotaTimeMs: 10_000},
      getRequestCount: (req) => req.length,
    },
  };
};
