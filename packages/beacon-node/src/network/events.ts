import {EventEmitter} from "events";
import {PeerId} from "@libp2p/interface-peer-id";
import StrictEventEmitter from "strict-event-emitter-types";
import {TopicValidatorResult} from "@libp2p/interface-pubsub";
import {phase0} from "@lodestar/types";
import {BlockInput} from "../chain/blocks/types.js";
import {RequestTypedContainer} from "./reqresp/ReqRespBeaconNode.js";
import {PendingGossipsubMessage, ReqRespIncomingRequest, ReqRespOutgoingResponse} from "./processor/types.js";
import {GossipTopic} from "./gossip/interface.js";
import {PeerAction} from "./peers/index.js";

export enum NetworkEvent {
  /** A relevant peer has connected or has been re-STATUS'd */
  peerConnected = "peer-manager.peer-connected",
  peerDisconnected = "peer-manager.peer-disconnected",
  gossipStart = "gossip.start",
  gossipStop = "gossip.stop",
  gossipHeartbeat = "gossipsub.heartbeat",
  reqRespRequest = "req-resp.request",
  unknownBlockParent = "unknownBlockParent",

  // Network processor events
  pendingGossipsubMessage = "gossip.pendingGossipsubMessage",
  gossipMessageValidationResult = "gossip.messageValidationResult",
  reqRespIncomingRequest = "reqResp.incomingRequest",
  reqRespOutgoingResponse = "reqResp.outgoingResponse",

  // Gossip control events
  subscribeTopic = "gossip.subscribeTopic",
  unsubscribeTopic = "gossip.unsubscribeTopic",

  // Peer manager events
  reportPeer = "peerScore.reportPeer",
  restatusPeers = "peerManager.restatusPeers",
  /** Chain's head state has changed, and this is the new status */
  localStatusUpdate = "peerManager.localStatusUpdate",
}

export type NetworkEvents = {
  [NetworkEvent.peerConnected]: (peer: PeerId, status: phase0.Status) => void;
  [NetworkEvent.peerDisconnected]: (peer: PeerId) => void;
  [NetworkEvent.reqRespRequest]: (request: RequestTypedContainer, peer: PeerId) => void;
  [NetworkEvent.unknownBlockParent]: (blockInput: BlockInput, peerIdStr: string) => void;
  [NetworkEvent.pendingGossipsubMessage]: (data: PendingGossipsubMessage) => void;
  [NetworkEvent.gossipMessageValidationResult]: (
    msgId: string,
    propagationSource: PeerId,
    acceptance: TopicValidatorResult
  ) => void;
  [NetworkEvent.reqRespIncomingRequest]: (data: ReqRespIncomingRequest) => void;
  [NetworkEvent.reqRespOutgoingResponse]: (data: ReqRespOutgoingResponse) => void;
  [NetworkEvent.subscribeTopic]: (topic: GossipTopic) => void;
  [NetworkEvent.unsubscribeTopic]: (topic: GossipTopic) => void;
  [NetworkEvent.reportPeer]: (peer: PeerId, action: PeerAction, actionName: string) => void;
  [NetworkEvent.restatusPeers]: (peers: PeerId[]) => void;
  [NetworkEvent.localStatusUpdate]: (localStatus: phase0.Status) => void;
};

export type INetworkEventBus = StrictEventEmitter<EventEmitter, NetworkEvents>;

export class NetworkEventBus extends (EventEmitter as {new (): INetworkEventBus}) {}
