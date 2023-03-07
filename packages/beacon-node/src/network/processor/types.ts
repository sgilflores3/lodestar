import {PeerId} from "@libp2p/interface-peer-id";
import {Message} from "@libp2p/interface-pubsub";
import {EncodedPayloadBytes} from "@lodestar/reqresp";
import {phase0, Slot} from "@lodestar/types";
import {GossipTopic} from "../gossip/index.js";
import type {ReqRespMethod} from "../reqresp/types.js";

export type GossipAttestationsWork = {
  messages: PendingGossipsubMessage[];
};

export type PendingGossipsubMessage = {
  topic: GossipTopic;
  msg: Message;
  msgId: string;
  // TODO: Refactor into accepting string (requires gossipsub changes) for easier multi-threading
  propagationSource: PeerId;
  /** From AttnetsService and SyncnetsService signaling if message only needs to be validated */
  importUpToSlot: Slot | null;
  seenTimestampSec: number;
  startProcessUnixSec: number | null;
};

export type ReqRespIncomingRequest = {
  from: PeerId;
  requestId: number;
  payload: ReqRespRequestPayload;
};

export type ReqRespRequestPayload = {
  method: ReqRespMethod;
  // TODO: Use different type than unknown
  data: unknown;
};

export type ReqRespResponsePayload =
  | {method: ReqRespMethod.Status; data: phase0.Status}
  | {method: ReqRespMethod.BeaconBlocksByRange; data: EncodedPayloadBytes}
  | {method: ReqRespMethod.BeaconBlocksByRoot; data: EncodedPayloadBytes};

export type ReqRespOutgoingResponse = {
  requestId: number;
  payload: IteratorEvent<EncodedPayloadBytes>;
};

export enum IteratorEventType {
  nextItem,
  error,
  done,
}

export type IteratorEvent<T> =
  | {type: IteratorEventType.nextItem; item: T}
  | {type: IteratorEventType.error; error: Error}
  | {type: IteratorEventType.done};
