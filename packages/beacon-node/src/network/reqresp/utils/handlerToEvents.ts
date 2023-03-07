import {PeerId} from "@libp2p/interface-peer-id";
import {EncodedPayloadBytes, ReqRespHandler} from "@lodestar/reqresp";
import {ReqRespMethod} from "../types.js";
import type {ReqRespHandlers} from "../handlers/index.js";
import {NetworkEvent, NetworkEventBus} from "../../events.js";
import {IteratorEventType, ReqRespIncomingRequest, ReqRespOutgoingResponse} from "../../processor/types.js";

/* eslint-disable func-names */

/**
 * The ReqRespHandler module handles app-level requests / responses from other peers,
 * fetching state from the chain and database as needed.
 *
 * On the worker's side the ReqResp module will call the async generator when the stream
 * is ready to send responses to the multiplexed libp2p stream.
 *
 * - libp2p inbound stream opened for reqresp method
 * - request data fully streamed
 * - ResResp handler called with request data and started
 * - stream calls next() on handler
 * - handler fetches block from DB, yields value
 * - stream calls next() again
 * - handler fetches block from DB, yields value
 * (case a)
 * - remote peer disconnects, stream aborted, calls return() on handler
 * (case b)
 * - handler has yielded all blocks, returns
 * (case c)
 * - handler encounters error, throws
 *
 * ```
 * handler type = AsyncIterable<EncodedPayload<Resp>>
 * ```
 */
export function getReqRespHandlersEventBased(events: NetworkEventBus): ReqRespHandlers {
  const iterableBridge = new AsyncIterableWorker(events);
  const getHandler = iterableBridge.getHandler.bind(iterableBridge);

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

type PendingItem<T> = {
  items: T[];
  done: boolean;
  error: null | Error;
  onNext: null | (() => void);
};

class AsyncIterableWorker {
  private nextRequestId = 0;

  // TODO: Track count of pending with metrics to ensure no leaks
  // TODO: Consider expiring the requests after no reply for long enough, t
  private readonly pending = new Map<number, PendingItem<EncodedPayloadBytes>>();

  constructor(private readonly events: NetworkEventBus) {
    events.on(NetworkEvent.reqRespOutgoingResponse, this.onOutgoingResponse.bind(this));
  }

  getHandler(method: ReqRespMethod): (req: unknown, peerId: PeerId) => AsyncIterable<EncodedPayloadBytes> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    return function handler(reqData, from) {
      return {
        [Symbol.asyncIterator]() {
          const requestId = self.nextRequestId++;
          const req: PendingItem<EncodedPayloadBytes> = {
            items: [],
            done: false,
            error: null,
            onNext: null,
          };
          self.pending.set(requestId, req);

          self.events.emit(NetworkEvent.reqRespIncomingRequest, {
            from,
            requestId,
            payload: {method, data: reqData},
          });

          return {
            async next() {
              // eslint-disable-next-line no-constant-condition
              while (true) {
                if (req.items.length > 0) {
                  return {value: req.items[0], done: false};
                }

                if (req.error) {
                  throw req.error;
                }

                if (req.done) {
                  // Is it correct to return undefined on done: true?
                  return {value: (undefined as unknown) as EncodedPayloadBytes, done: true};
                }

                await new Promise<void>((resolve) => {
                  req.onNext = resolve;
                });
              }
            },

            async return() {
              // This will be reached if the consumer called 'break' or 'return' early in the loop.
              return {value: undefined, done: true};
            },
          };
        },
      };
    };
  }

  private onOutgoingResponse(data: ReqRespOutgoingResponse): void {
    const req = this.pending.get(data.requestId);
    if (!req) {
      // TODO: Log or track error, should never happen
      return;
    }

    switch (data.payload.type) {
      case IteratorEventType.done:
        // What if it's already done?
        req.done = true;

        // Do not expect more responses
        this.pending.delete(data.requestId);
        break;

      case IteratorEventType.error:
        // What if there's already an error?
        req.error = data.payload.error;

        // Do not expect more responses
        this.pending.delete(data.requestId);
        break;

      case IteratorEventType.nextItem:
        // Should check that's it's already done or error?
        req.items.push(data.payload.item);
        break;
    }

    req.onNext?.();
  }
}

export class ReqRespByEventsMain {
  constructor(private readonly handlers: ReqRespHandlers, private readonly events: NetworkEventBus) {
    events.on(NetworkEvent.reqRespIncomingRequest, this.onIncomingRequest.bind(this));
  }

  private async onIncomingRequest(data: ReqRespIncomingRequest): Promise<void> {
    try {
      const handler: ReqRespHandler<unknown, EncodedPayloadBytes> | undefined = this.handlers[data.payload.method];
      if (handler === undefined) {
        throw Error(`Unknown reqresp method ${data.payload.method}`);
      }

      for await (const item of handler(data.payload.data, data.from)) {
        this.events.emit(NetworkEvent.reqRespOutgoingResponse, {
          requestId: data.requestId,
          // TODO: Ensure EncodedPayloadBytes
          payload: {type: IteratorEventType.nextItem, item: item as EncodedPayloadBytes},
        });
      }

      this.events.emit(NetworkEvent.reqRespOutgoingResponse, {
        requestId: data.requestId,
        payload: {type: IteratorEventType.done},
      });
    } catch (e) {
      // TODO: Also log locally
      this.events.emit(NetworkEvent.reqRespOutgoingResponse, {
        requestId: data.requestId,
        payload: {type: IteratorEventType.error, error: e as Error},
      });
    }
  }
}
