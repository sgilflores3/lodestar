import {ReqRespHandler} from "@lodestar/reqresp";
import {ReqRespMethod} from "../types.js";
import type {ReqRespHandlers} from "../handlers/index.js";
import {NetworkEvent, NetworkEventBus} from "../../events.js";
import {IteratorEventType, ReqRespOutgoingResponse} from "../../processor/types.js";

/* eslint-disable func-names */

/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 */
export function getReqRespHandlersEventBased(events: NetworkEventBus): ReqRespHandlers {
  function getHandler(method: ReqRespMethod): ReqRespHandler<any, any> {
    return async function* asEvent(req, from) {
      events.emit(NetworkEvent.reqRespIncomingRequest, {
        from,
        requestId,
        payload: {method, data: req},
      });

      while (true) {
        const nextItemPromise = await new Promise<ReqRespOutgoingResponse>((resolve) => {
          events.once(NetworkEvent.reqRespOutgoingResponse, (data) => {
            resolve(data);
          });
        });

        switch (nextItemPromise.payload.type) {
          case IteratorEventType.nextItem:
            yield nextItemPromise.payload.item;
            break;

          case IteratorEventType.done:
            return;

          case IteratorEventType.error:
            throw nextItemPromise.payload.error;
        }
      }
    };
  }

  return {
    [ReqRespMethod.Status]: getHandler(ReqRespMethod.Status),
    [ReqRespMethod.BeaconBlocksByRange]: getHandler(ReqRespMethod.BeaconBlocksByRange),
    [ReqRespMethod.BeaconBlocksByRoot]: getHandler(ReqRespMethod.BeaconBlocksByRoot),
    [ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot]: getHandler(ReqRespMethod.BeaconBlockAndBlobsSidecarByRoot),
    [ReqRespMethod.BlobsSidecarsByRange]: getHandler(ReqRespMethod.BlobsSidecarsByRange),
    [ReqRespMethod.LightClientBootstrap]: getHandler(ReqRespMethod.LightClientBootstrap),
    [ReqRespMethod.LightClientUpdatesByRange]: getHandler(ReqRespMethod.LightClientUpdatesByRange),
    [ReqRespMethod.LightClientFinalityUpdate]: getHandler(ReqRespMethod.LightClientFinalityUpdate),
    [ReqRespMethod.LightClientOptimisticUpdate]: getHandler(ReqRespMethod.LightClientOptimisticUpdate),
  };
}
