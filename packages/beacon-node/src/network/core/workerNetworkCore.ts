import {PublishResult} from "@libp2p/interface-pubsub";
import {exportToProtobuf} from "@libp2p/peer-id-factory";
import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {routes} from "@lodestar/api";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/dist/src/score/peer-score.js";
import {allForks, altair, deneb, phase0} from "@lodestar/types";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
import {spawn, Thread, Worker} from "@chainsafe/threads";
import {BeaconConfig, chainConfigToJson} from "@lodestar/config";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {CommitteeSubscription} from "../subnets/interface.js";
import {PeerScoreStats} from "../peers/index.js";
import {NetworkOptions} from "../options.js";
import {NetworkWorkerApi, NetworkWorkerData, NetworkCore} from "./types.js";

export type Libp2pkWorkerWrapperInitModules = {
  opts: NetworkOptions;
  config: BeaconConfig;
  genesisTime: number;
  activeValidatorCount: number;
  peerId: PeerId;
  events: NetworkEventBus;
};

type Libp2pkWorkerWrapperModules = Libp2pkWorkerWrapperInitModules & {
  workerApi: NetworkWorkerApi;
};

/**
 * NetworkCore implementation using a Worker thread
 */
export class WorkerNetworkCore implements NetworkCore {
  constructor(private readonly modules: Libp2pkWorkerWrapperModules) {}

  static async init(modules: Libp2pkWorkerWrapperInitModules): Promise<WorkerNetworkCore> {
    const {opts, config, genesisTime, peerId, events} = modules;

    const workerData: NetworkWorkerData = {
      opts,
      chainConfigJson: chainConfigToJson(config),
      genesisValidatorsRoot: config.genesisValidatorsRoot,
      peerIdProto: exportToProtobuf(peerId),
      bindAddr: opts.bindAddr,
      metrics: opts.metrics,
      peerStoreDir: opts.peerStoreDir,
      genesisTime,
      activeValidatorCount: modules.activeValidatorCount,
    };

    const worker = new Worker("./worker.js", {workerData} as ConstructorParameters<typeof Worker>[1]);

    const workerApi = await spawn<NetworkWorkerApi>(worker, {
      // A Lodestar Node may do very expensive task at start blocking the event loop and causing
      // the initialization to timeout. The number below is big enough to almost disable the timeout
      timeout: 5 * 60 * 1000,
    });

    workerApi.pendingGossipsubMessage().subscribe((data) => events.emit(NetworkEvent.pendingGossipsubMessage, data));

    return new WorkerNetworkCore({
      ...modules,
      workerApi,
    });
  }

  async close(): Promise<void> {
    await this.getApi().close();
    await Thread.terminate((this.modules.workerApi as unknown) as Thread);
  }

  async test(): Promise<void> {
    return;
  }

  scrapeMetrics(): Promise<string> {
    return this.getApi().scrapeMetrics();
  }

  publishGossipObject(topic: string, data: Uint8Array, opts?: PublishOpts): Promise<PublishResult> {
    return this.getApi().publishGossipObject(topic, data, opts);
  }

  // TODO: Should this just be events? Do they need to report errors back?
  prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.getApi().prepareBeaconCommitteeSubnets(subscriptions);
  }
  prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.getApi().prepareSyncCommitteeSubnets(subscriptions);
  }
  subscribeGossipCoreTopics(): Promise<void> {
    return this.getApi().subscribeGossipCoreTopics();
  }
  unsubscribeGossipCoreTopics(): Promise<void> {
    return this.getApi().unsubscribeGossipCoreTopics();
  }

  // REST API queries

  getConnectedPeerCount(): Promise<number> {
    return this.getApi().getConnectedPeerCount();
  }
  getConnectedPeers(): Promise<PeerId[]> {
    return this.getApi().getConnectedPeers();
  }
  getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    return this.getApi().getNetworkIdentity();
  }

  // ReqResp outgoing

  status(peerId: PeerId, request: phase0.Status): Promise<phase0.Status> {
    return this.getApi().status(peerId, request);
  }
  goodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void> {
    return this.getApi().goodbye(peerId, request);
  }
  ping(peerId: PeerId): Promise<phase0.Ping> {
    return this.getApi().ping(peerId);
  }
  metadata(peerId: PeerId): Promise<allForks.Metadata> {
    return this.getApi().metadata(peerId);
  }
  beaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    return this.getApi().beaconBlocksByRange(peerId, request);
  }
  beaconBlocksByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<allForks.SignedBeaconBlock[]> {
    return this.getApi().beaconBlocksByRoot(peerId, request);
  }
  blobsSidecarsByRange(peerId: PeerId, request: deneb.BlobsSidecarsByRangeRequest): Promise<deneb.BlobsSidecar[]> {
    return this.getApi().blobsSidecarsByRange(peerId, request);
  }
  beaconBlockAndBlobsSidecarByRoot(
    peerId: PeerId,
    request: deneb.BeaconBlockAndBlobsSidecarByRootRequest
  ): Promise<deneb.SignedBeaconBlockAndBlobsSidecar[]> {
    return this.getApi().beaconBlockAndBlobsSidecarByRoot(peerId, request);
  }
  lightClientBootstrap(peerId: PeerId, request: Uint8Array): Promise<allForks.LightClientBootstrap> {
    return this.getApi().lightClientBootstrap(peerId, request);
  }
  lightClientOptimisticUpdate(peerId: PeerId): Promise<allForks.LightClientOptimisticUpdate> {
    return this.getApi().lightClientOptimisticUpdate(peerId);
  }
  lightClientFinalityUpdate(peerId: PeerId): Promise<allForks.LightClientFinalityUpdate> {
    return this.getApi().lightClientFinalityUpdate(peerId);
  }
  lightClientUpdatesByRange(
    peerId: PeerId,
    request: altair.LightClientUpdatesByRange
  ): Promise<allForks.LightClientUpdate[]> {
    return this.getApi().lightClientUpdatesByRange(peerId, request);
  }

  // Debug

  connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void> {
    return this.getApi().connectToPeer(peer, multiaddr);
  }
  disconnectPeer(peer: PeerId): Promise<void> {
    return this.getApi().disconnectPeer(peer);
  }
  dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    return this.getApi().dumpPeers();
  }
  dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    return this.getApi().dumpPeer(peerIdStr);
  }
  dumpPeerScoreStats(): Promise<PeerScoreStats> {
    return this.getApi().dumpPeerScoreStats();
  }
  dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump> {
    return this.getApi().dumpGossipPeerScoreStats();
  }
  dumpDiscv5KadValues(): Promise<string[]> {
    return this.getApi().dumpDiscv5KadValues();
  }
  dumpMeshPeers(): Promise<Record<string, string[]>> {
    return this.getApi().dumpMeshPeers();
  }

  private getApi(): NetworkWorkerApi {
    return this.modules.workerApi;
  }
}
