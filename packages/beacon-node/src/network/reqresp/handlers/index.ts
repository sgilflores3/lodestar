import {HandlerTypeFromMessage} from "@lodestar/reqresp";
import * as protocols from "@lodestar/reqresp/protocols";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {ReqRespMethod} from "../types.js";
import {onBeaconBlocksByRange} from "./beaconBlocksByRange.js";
import {onBeaconBlocksByRoot} from "./beaconBlocksByRoot.js";
import {onBeaconBlockAndBlobsSidecarByRoot} from "./beaconBlockAndBlobsSidecarByRoot.js";
import {onBlobsSidecarsByRange} from "./blobsSidecarsByRange.js";
import {onLightClientBootstrap} from "./lightClientBootstrap.js";
import {onLightClientFinalityUpdate} from "./lightClientFinalityUpdate.js";
import {onLightClientOptimisticUpdate} from "./lightClientOptimisticUpdate.js";
import {onLightClientUpdatesByRange} from "./lightClientUpdatesByRange.js";
import {onStatus} from "./status.js";

/* eslint-disable func-names */

export interface ReqRespHandlers {
  [ReqRespMethod.Status]: HandlerTypeFromMessage<typeof protocols.Status>;
  [ReqRespMethod.BeaconBlocksByRange]: HandlerTypeFromMessage<typeof protocols.BeaconBlocksByRange>;
  [ReqRespMethod.BeaconBlocksByRoot]: HandlerTypeFromMessage<typeof protocols.BeaconBlocksByRoot>;
  [ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot]: HandlerTypeFromMessage<
    typeof protocols.BeaconBlockAndBlobsSidecarByRoot
  >;
  [ReqRespMethod.BlobsSidecarsByRange]: HandlerTypeFromMessage<typeof protocols.BlobsSidecarsByRange>;
  [ReqRespMethod.LightClientBootstrap]: HandlerTypeFromMessage<typeof protocols.LightClientBootstrap>;
  [ReqRespMethod.LightClientUpdatesByRange]: HandlerTypeFromMessage<typeof protocols.LightClientUpdatesByRange>;
  [ReqRespMethod.LightClientFinalityUpdate]: HandlerTypeFromMessage<typeof protocols.LightClientFinalityUpdate>;
  [ReqRespMethod.LightClientOptimisticUpdate]: HandlerTypeFromMessage<typeof protocols.LightClientOptimisticUpdate>;
}

/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export function getReqRespHandlers({db, chain}: {db: IBeaconDb; chain: IBeaconChain}): ReqRespHandlers {
  return {
    [ReqRespMethod.Status]: async function* () {
      yield* onStatus(chain);
    },
    [ReqRespMethod.BeaconBlocksByRange]: async function* (req) {
      yield* onBeaconBlocksByRange(req, chain, db);
    },
    [ReqRespMethod.BeaconBlocksByRoot]: async function* (req) {
      yield* onBeaconBlocksByRoot(req, chain, db);
    },
    [ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot]: async function* (req) {
      yield* onBeaconBlockAndBlobsSidecarByRoot(req, chain, db);
    },
    [ReqRespMethod.BlobsSidecarsByRange]: async function* (req) {
      yield* onBlobsSidecarsByRange(req, chain, db);
    },
    [ReqRespMethod.LightClientBootstrap]: async function* (req) {
      yield* onLightClientBootstrap(req, chain);
    },
    [ReqRespMethod.LightClientUpdatesByRange]: async function* (req) {
      yield* onLightClientUpdatesByRange(req, chain);
    },
    [ReqRespMethod.LightClientFinalityUpdate]: async function* () {
      yield* onLightClientFinalityUpdate(chain);
    },
    [ReqRespMethod.LightClientOptimisticUpdate]: async function* () {
      yield* onLightClientOptimisticUpdate(chain);
    },
  };
}
