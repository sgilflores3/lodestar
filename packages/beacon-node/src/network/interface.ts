import {Libp2p as ILibp2p} from "libp2p";
import {Connection} from "@libp2p/interface-connection";
import {Registrar} from "@libp2p/interface-registrar";
import {Multiaddr} from "@multiformats/multiaddr";
import {PeerId} from "@libp2p/interface-peer-id";
import {ConnectionManager} from "@libp2p/interface-connection-manager";
import {phase0} from "@lodestar/types";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {routes} from "@lodestar/api";
import {BlockInput} from "../chain/blocks/types.js";
import {INetworkEventBus} from "./events.js";
import {PeerAction, PeerScoreStats} from "./peers/index.js";
import {IReqRespBeaconNode} from "./reqresp/interface.js";
import {CommitteeSubscription} from "./subnets/index.js";
import {GossipBeaconNode, GossipPublishResult} from "./gossip/interface.js";

export type PeerSearchOptions = {
  supportsProtocols?: string[];
  count?: number;
};

/**
 * The architecture of the network looks like so:
 * - NetworkCore - This module contains core network functionality (libp2p and dependent modules)
 *   - We provide both a MainThreadNetworkCore and a WorkerNetworkCore implementation
 * - INetwork - This module wraps NetworkCore and crucially allows for a connection to the BeaconChain module.
 */

/**
 * Contains core network functionality (libp2p and dependent modules)
 *
 * All properties/methods should be async to allow for a worker implementation
 */
export interface NetworkCore extends IReqRespBeaconNode, GossipBeaconNode {
  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;

  // Peer manager control
  /** Subscribe, search peers, join long-lived attnets */
  prepareBeaconCommitteeSubnet(subscriptions: CommitteeSubscription[]): Promise<void>;
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

export interface INetwork extends NetworkCore {
  /** Our network identity */
  peerId: PeerId;

  events: INetworkEventBus;

  // TODO move these pubsub / reqresp methods into their respective modules (?)
  // Or move the other methods up to this level (?)
  publishBeaconBlockMaybeBlobs(signedBlock: BlockInput): Promise<GossipPublishResult>;
  beaconBlocksMaybeBlobsByRange(peerId: PeerId, request: phase0.BeaconBlocksByRangeRequest): Promise<BlockInput[]>;
  beaconBlocksMaybeBlobsByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<BlockInput[]>;

  reStatusPeers(peers: PeerId[]): Promise<void>;
  reportPeer(peer: PeerId, action: PeerAction, actionName: string): void;
}

export type PeerDirection = Connection["stat"]["direction"];
export type PeerStatus = Connection["stat"]["status"];

export type Libp2p = ILibp2p & {connectionManager: ConnectionManager; registrar: Registrar};

export type Eth2Context = {
  activeValidatorCount: number;
  currentSlot: number;
  currentEpoch: number;
};
