import {PublishResult} from "@libp2p/interface-pubsub";
import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
import {Observable} from "@chainsafe/threads/observable";
import {routes} from "@lodestar/api";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {phase0} from "@lodestar/types";
import {PendingGossipsubMessage} from "../processor/types.js";
import {NetworkOptions} from "../options.js";
import {IReqRespBeaconNode} from "../reqresp/interface.js";
import {CommitteeSubscription} from "../subnets/interface.js";
import {GossipBeaconNode} from "../gossip/interface.js";
import {PeerScoreStats} from "../peers/index.js";

export interface IBaseNetwork {
  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;

  // chain updates
  updateStatus(status: phase0.Status): Promise<void>;

  // Peer manager control
  /** Subscribe, search peers, join long-lived attnets */
  prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void>;
  /** Subscribe, search peers, join long-lived syncnets */
  prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void>;

  // REST API getters
  getConnectedPeers(): Promise<PeerId[]>;
  getConnectedPeerCount(): Promise<number>;
  getNetworkIdentity(): Promise<routes.node.NetworkIdentity>;

  // Gossip control
  subscribeGossipCoreTopics(): Promise<void>;
  unsubscribeGossipCoreTopics(): Promise<void>;
  isSubscribedToGossipCoreTopics(): Promise<boolean>;

  // Debug
  connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void>;
  disconnectPeer(peer: PeerId): Promise<void>;
  dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]>;
  dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined>;
  dumpPeerScoreStats(): Promise<PeerScoreStats>;
  dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump>;
  dumpDiscv5KadValues(): Promise<string[]>;
  dumpMeshPeers(): Promise<Record<string, string[]>>;
}

/**
 * Contains core network functionality (libp2p and dependent modules)
 *
 * All properties/methods should be async to allow for a worker implementation
 */
export interface NetworkCore extends IBaseNetwork, IReqRespBeaconNode, GossipBeaconNode {}

/**
 * libp2p worker contructor (start-up) data
 */
export type NetworkWorkerData = {
  // TODO: Review if NetworkOptions is safe for passing
  opts: NetworkOptions;
  chainConfigJson: Record<string, string>;
  genesisValidatorsRoot: Uint8Array;
  genesisTime: number;
  activeValidatorCount: number;
  peerIdProto: Uint8Array;
  bindAddr: string;
  metrics: boolean;
  peerStoreDir: string;
};

/**
 * API exposed by the libp2p worker
 */
export type NetworkWorkerApi = Omit<NetworkCore, keyof GossipBeaconNode> & {
  publishGossipObject(topic: string, data: Uint8Array, opts?: PublishOpts): Promise<PublishResult>;

  // TODO: Gossip events
  // Main -> Worker: NetworkEvent.gossipMessageValidationResult
  // Worker -> Main: NetworkEvent.pendingGossipsubMessage
  pendingGossipsubMessage(): Observable<PendingGossipsubMessage>;

  // TODO: ReqResp outgoing
  // TODO: ReqResp incoming
};
