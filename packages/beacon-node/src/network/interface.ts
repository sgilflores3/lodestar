import {Libp2p as ILibp2p} from "libp2p";
import {Connection} from "@libp2p/interface-connection";
import {Registrar} from "@libp2p/interface-registrar";
import {Multiaddr} from "@multiformats/multiaddr";
import {PeerId} from "@libp2p/interface-peer-id";
import {ConnectionManager} from "@libp2p/interface-connection-manager";
import {allForks, altair, capella, deneb, phase0} from "@lodestar/types";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {routes} from "@lodestar/api";
import {BlockInput} from "../chain/blocks/types.js";
import {INetworkEventBus} from "./events.js";
import {PeerAction, PeerScoreStats} from "./peers/index.js";
import {IReqRespBeaconNode} from "./reqresp/interface.js";
import {CommitteeSubscription} from "./subnets/index.js";

export type PeerSearchOptions = {
  supportsProtocols?: string[];
  count?: number;
};

export type GossipPublishResult = Promise<number>;

/**
 * Methods that exist with the same API in the worker and the public facing Network class
 */
export interface ILibp2pWorkerShared extends IReqRespBeaconNode {
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

export interface ILibp2pWorkerWrapper extends ILibp2pWorkerShared {
  test(): Promise<void>;
}

export interface INetwork extends ILibp2pWorkerShared {
  /** Our network identity */
  peerId: PeerId;

  events: INetworkEventBus;
  reqResp: IReqRespBeaconNode;

  publishBeaconBlockMaybeBlobs(signedBlock: BlockInput): GossipPublishResult;
  beaconBlocksMaybeBlobsByRange(peerId: PeerId, request: phase0.BeaconBlocksByRangeRequest): Promise<BlockInput[]>;
  beaconBlocksMaybeBlobsByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<BlockInput[]>;

  reStatusPeers(peers: PeerId[]): Promise<void>;
  reportPeer(peer: PeerId, action: PeerAction, actionName: string): void;

  // Gossip handler
  isSubscribedToGossipCoreTopics(): boolean;

  // Gossip publish
  publishBeaconBlock(signedBlock: allForks.SignedBeaconBlock): GossipPublishResult;
  publishSignedBeaconBlockAndBlobsSidecar(item: deneb.SignedBeaconBlockAndBlobsSidecar): GossipPublishResult;
  publishBeaconAggregateAndProof(aggregateAndProof: phase0.SignedAggregateAndProof): GossipPublishResult;
  publishBeaconAttestation(attestation: phase0.Attestation, subnet: number): GossipPublishResult;
  publishVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): GossipPublishResult;
  publishBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): GossipPublishResult;
  publishProposerSlashing(proposerSlashing: phase0.ProposerSlashing): GossipPublishResult;
  publishAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): GossipPublishResult;
  publishSyncCommitteeSignature(signature: altair.SyncCommitteeMessage, subnet: number): GossipPublishResult;
  publishContributionAndProof(contributionAndProof: altair.SignedContributionAndProof): GossipPublishResult;
  publishLightClientFinalityUpdate(lightClientFinalityUpdate: allForks.LightClientFinalityUpdate): GossipPublishResult;
  publishLightClientOptimisticUpdate(
    lightClientOptimisitcUpdate: allForks.LightClientOptimisticUpdate
  ): GossipPublishResult;

  // Service
  metrics(): Promise<string>;
  close(): Promise<void>;
}

export type PeerDirection = Connection["stat"]["direction"];
export type PeerStatus = Connection["stat"]["status"];

export type Libp2p = ILibp2p & {connectionManager: ConnectionManager; registrar: Registrar};

export type Eth2Context = {
  activeValidatorCount: number;
  currentSlot: number;
  currentEpoch: number;
};
