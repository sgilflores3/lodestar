import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {PublishResult} from "@libp2p/interface-pubsub";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {altair, deneb, phase0} from "@lodestar/types";
import {EncodedPayloadBytesIncoming} from "@lodestar/reqresp";
import {routes} from "@lodestar/api";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
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
  async updateStatus(status: phase0.Status): Promise<void> {
    return this.base.updateStatus(status);
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
  async beaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<EncodedPayloadBytesIncoming[]> {
    return this.base.reqResp.beaconBlocksByRange(peerId, request);
  }
  async beaconBlocksByRoot(peerId: PeerId, request: Uint8Array[]): Promise<EncodedPayloadBytesIncoming[]> {
    return this.base.reqResp.beaconBlocksByRoot(peerId, request);
  }
  async blobsSidecarsByRange(
    peerId: PeerId,
    request: deneb.BlobsSidecarsByRangeRequest
  ): Promise<EncodedPayloadBytesIncoming[]> {
    return this.base.reqResp.blobsSidecarsByRange(peerId, request);
  }
  async beaconBlockAndBlobsSidecarByRoot(
    peerId: PeerId,
    request: Uint8Array[]
  ): Promise<EncodedPayloadBytesIncoming[]> {
    return this.base.reqResp.beaconBlockAndBlobsSidecarByRoot(peerId, request);
  }
  async lightClientBootstrap(peerId: PeerId, request: Uint8Array): Promise<EncodedPayloadBytesIncoming> {
    return this.base.reqResp.lightClientBootstrap(peerId, request);
  }
  async lightClientOptimisticUpdate(peerId: PeerId): Promise<EncodedPayloadBytesIncoming> {
    return this.base.reqResp.lightClientOptimisticUpdate(peerId);
  }
  async lightClientFinalityUpdate(peerId: PeerId): Promise<EncodedPayloadBytesIncoming> {
    return this.base.reqResp.lightClientFinalityUpdate(peerId);
  }
  async lightClientUpdatesByRange(
    peerId: PeerId,
    request: altair.LightClientUpdatesByRange
  ): Promise<EncodedPayloadBytesIncoming[]> {
    return this.base.reqResp.lightClientUpdatesByRange(peerId, request);
  }
  async publishGossip(topic: string, data: Uint8Array, opts?: PublishOpts): Promise<PublishResult> {
    return this.base.publishGossip(topic, data, opts);
  }
}
