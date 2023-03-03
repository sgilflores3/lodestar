import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {PublishResult} from "@libp2p/interface-pubsub";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {allForks, altair, capella, deneb, phase0} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {CommitteeSubscription} from "../subnets/interface.js";
import {PeerScoreStats} from "../peers/index.js";
import {NetworkCore} from "./types.js";
import {BaseNetwork, BaseNetworkInit} from "./baseNetwork.js";

type MainThreadNetworkCoreModules = {
  base: BaseNetwork;
};

export class MainThreadNetworkCore implements NetworkCore {
  private base: BaseNetwork;

  constructor({base}: MainThreadNetworkCoreModules) {
    this.base = base;
  }
  static async init(modules: BaseNetworkInit): Promise<MainThreadNetworkCore> {
    const base = await BaseNetwork.init(modules);
    return new MainThreadNetworkCore({base});
  }
  async close(): Promise<void> {
    return this.base.close();
  }
  async scrapeMetrics(): Promise<string> {
    return this.base.scrapeMetrics();
  }
  async prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.base.prepareBeaconCommitteeSubnets(subscriptions);
  }
  async prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.base.prepareSyncCommitteeSubnets(subscriptions);
  }
  async getConnectedPeers(): Promise<PeerId[]> {
    return this.base.getConnectedPeers();
  }
  async getConnectedPeerCount(): Promise<number> {
    return this.base.getConnectedPeerCount();
  }
  async getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    return this.base.getNetworkIdentity();
  }
  async subscribeGossipCoreTopics(): Promise<void> {
    return this.base.subscribeGossipCoreTopics();
  }
  async unsubscribeGossipCoreTopics(): Promise<void> {
    return this.base.unsubscribeGossipCoreTopics();
  }
  async isSubscribedToGossipCoreTopics(): Promise<boolean> {
    return this.base.isSubscribedToGossipCoreTopics();
  }
  async connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void> {
    return this.base.connectToPeer(peer, multiaddr);
  }
  async disconnectPeer(peer: PeerId): Promise<void> {
    return this.base.disconnectPeer(peer);
  }
  async dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    return this.base.dumpPeers();
  }
  async dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    return this.base.dumpPeer(peerIdStr);
  }
  async dumpPeerScoreStats(): Promise<PeerScoreStats> {
    return this.base.dumpPeerScoreStats();
  }
  async dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump> {
    return this.base.dumpGossipPeerScoreStats();
  }
  async dumpDiscv5KadValues(): Promise<string[]> {
    return this.base.dumpDiscv5KadValues();
  }
  async dumpMeshPeers(): Promise<Record<string, string[]>> {
    return this.base.dumpMeshPeers();
  }
  async status(peerId: PeerId, request: phase0.Status): Promise<phase0.Status> {
    return this.base.reqResp.status(peerId, request);
  }
  async goodbye(peerId: PeerId, request: bigint): Promise<void> {
    return this.base.reqResp.goodbye(peerId, request);
  }
  async ping(peerId: PeerId): Promise<bigint> {
    return this.base.reqResp.ping(peerId);
  }
  async metadata(peerId: PeerId): Promise<allForks.Metadata> {
    return this.base.reqResp.metadata(peerId);
  }
  async beaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    return this.base.reqResp.beaconBlocksByRange(peerId, request);
  }
  async beaconBlocksByRoot(peerId: PeerId, request: Uint8Array[]): Promise<allForks.SignedBeaconBlock[]> {
    return this.base.reqResp.beaconBlocksByRoot(peerId, request);
  }
  async blobsSidecarsByRange(
    peerId: PeerId,
    request: deneb.BlobsSidecarsByRangeRequest
  ): Promise<deneb.BlobsSidecar[]> {
    return this.base.reqResp.blobsSidecarsByRange(peerId, request);
  }
  async beaconBlockAndBlobsSidecarByRoot(
    peerId: PeerId,
    request: Uint8Array[]
  ): Promise<deneb.SignedBeaconBlockAndBlobsSidecar[]> {
    return this.base.reqResp.beaconBlockAndBlobsSidecarByRoot(peerId, request);
  }
  async lightClientBootstrap(peerId: PeerId, request: Uint8Array): Promise<allForks.LightClientBootstrap> {
    return this.base.reqResp.lightClientBootstrap(peerId, request);
  }
  async lightClientOptimisticUpdate(peerId: PeerId): Promise<allForks.LightClientOptimisticUpdate> {
    return this.base.reqResp.lightClientOptimisticUpdate(peerId);
  }
  async lightClientFinalityUpdate(peerId: PeerId): Promise<allForks.LightClientFinalityUpdate> {
    return this.base.reqResp.lightClientFinalityUpdate(peerId);
  }
  async lightClientUpdatesByRange(
    peerId: PeerId,
    request: altair.LightClientUpdatesByRange
  ): Promise<allForks.LightClientUpdate[]> {
    return this.base.reqResp.lightClientUpdatesByRange(peerId, request);
  }
  async publishBeaconBlock(signedBlock: allForks.SignedBeaconBlock): Promise<PublishResult> {
    return this.base.gossip.publishBeaconBlock(signedBlock);
  }
  async publishSignedBeaconBlockAndBlobsSidecar(item: deneb.SignedBeaconBlockAndBlobsSidecar): Promise<PublishResult> {
    return this.base.gossip.publishSignedBeaconBlockAndBlobsSidecar(item);
  }
  async publishBeaconAggregateAndProof(aggregateAndProof: phase0.SignedAggregateAndProof): Promise<PublishResult> {
    return this.base.gossip.publishBeaconAggregateAndProof(aggregateAndProof);
  }
  async publishBeaconAttestation(attestation: phase0.Attestation, subnet: number): Promise<PublishResult> {
    return this.base.gossip.publishBeaconAttestation(attestation, subnet);
  }
  async publishVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<PublishResult> {
    return this.base.gossip.publishVoluntaryExit(voluntaryExit);
  }
  async publishBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): Promise<PublishResult> {
    return this.base.gossip.publishBlsToExecutionChange(blsToExecutionChange);
  }
  async publishProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<PublishResult> {
    return this.base.gossip.publishProposerSlashing(proposerSlashing);
  }
  async publishAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): Promise<PublishResult> {
    return this.base.gossip.publishAttesterSlashing(attesterSlashing);
  }
  async publishSyncCommitteeSignature(signature: altair.SyncCommitteeMessage, subnet: number): Promise<PublishResult> {
    return this.base.gossip.publishSyncCommitteeSignature(signature, subnet);
  }
  async publishContributionAndProof(contributionAndProof: altair.SignedContributionAndProof): Promise<PublishResult> {
    return this.base.gossip.publishContributionAndProof(contributionAndProof);
  }
  async publishLightClientFinalityUpdate(
    lightClientFinalityUpdate: allForks.LightClientFinalityUpdate
  ): Promise<PublishResult> {
    return this.base.gossip.publishLightClientFinalityUpdate(lightClientFinalityUpdate);
  }
  async publishLightClientOptimisticUpdate(
    lightClientOptimisticUpdate: allForks.LightClientOptimisticUpdate
  ): Promise<PublishResult> {
    return this.base.gossip.publishLightClientOptimisticUpdate(lightClientOptimisticUpdate);
  }
}
