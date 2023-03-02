import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {BeaconConfig} from "@lodestar/config";
import {Logger, sleep} from "@lodestar/utils";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {deneb, phase0, allForks, altair, capella} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {Metrics} from "../metrics/index.js";
import {IBeaconChain, BeaconClock} from "../chain/index.js";
import {BlockInput, BlockInputType} from "../chain/blocks/types.js";
import {IBeaconDb} from "../db/interface.js";
import {NetworkOptions} from "./options.js";
import {GossipPublishResult, INetwork} from "./interface.js";
import {ReqRespHandlers, beaconBlocksMaybeBlobsByRange} from "./reqresp/index.js";
import {beaconBlocksMaybeBlobsByRoot} from "./reqresp/beaconBlocksMaybeBlobsByRoot.js";
import {GossipHandlers, GossipType, GossipTopic, GossipTypeMap} from "./gossip/index.js";
import {PeerAction, PeerRpcScoreStore, PeerScoreStats} from "./peers/index.js";
import {INetworkEventBus, NetworkEvent, NetworkEventBus} from "./events.js";
import {CommitteeSubscription} from "./subnets/index.js";
import {PeersData} from "./peers/peersData.js";
import {isPublishToZeroPeersError} from "./util.js";
import {NetworkProcessor} from "./processor/index.js";
import {PendingGossipsubMessage} from "./processor/types.js";
import {
  getGossipSSZType,
  gossipTopicIgnoreDuplicatePublishError,
  stringifyGossipTopic,
  toGossipTopic,
} from "./gossip/topic.js";
import {WorkerNetworkCore} from "./libp2pWorker/index.js";

type NetworkModules = {
  opts: NetworkOptions;
  config: BeaconConfig;
  logger: Logger;
  chain: IBeaconChain;
  signal: AbortSignal;
  networkEventBus: NetworkEventBus;
  networkProcessor: NetworkProcessor;
  worker: WorkerNetworkCore;
};

export type NetworkInitModules = {
  opts: NetworkOptions;
  config: BeaconConfig;
  peerId: PeerId;
  peerStoreDir?: string;
  logger: Logger;
  metrics: Metrics | null;
  chain: IBeaconChain;
  db: IBeaconDb;
  reqRespHandlers: ReqRespHandlers;
  signal: AbortSignal;
  // Optionally pass custom GossipHandlers, for testing
  gossipHandlers?: GossipHandlers;
};

/**
 * Must support running both on worker and on main thread.
 *
 * Exists a front class that's what consumers interact with.
 * This class will multiplex between:
 * - libp2p in worker
 * - libp2p in main thread
 */
export class Network implements INetwork {
  // TODO: Make private
  readonly events: INetworkEventBus;

  private readonly logger: Logger;
  private readonly config: BeaconConfig;
  private readonly clock: BeaconClock;
  private readonly chain: IBeaconChain;
  private readonly signal: AbortSignal;

  // TODO: Review
  private readonly networkProcessor: NetworkProcessor;

  // Worker TODO
  private readonly worker: NetworkCore;

  private subscribedToCoreTopics = false;
  private regossipBlsChangesPromise: Promise<void> | null = null;
  private closed = false;

  constructor(modules: NetworkModules) {
    this.config = modules.config;
    this.logger = modules.logger;
    this.chain = modules.chain;
    this.clock = modules.chain.clock;
    this.signal = modules.signal;
    this.events = modules.networkEventBus;
    this.networkProcessor = modules.networkProcessor;
    this.worker = modules.worker;

    this.chain.emitter.on(routes.events.EventType.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    this.chain.emitter.on(routes.events.EventType.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);
    modules.signal.addEventListener("abort", this.close.bind(this), {once: true});
  }

  static async init({
    opts,
    config,
    logger,
    metrics,
    chain,
    db,
    signal,
    gossipHandlers,
  }: NetworkInitModules): Promise<Network> {
    const networkEventBus = new NetworkEventBus();

    const networkProcessor = new NetworkProcessor(
      {chain, db, config, logger, metrics, events: networkEventBus, gossipHandlers},
      opts
    );

    const worker = await WorkerNetworkCore.init({
      opts,
      config,
      genesisTime: chain.genesisTime,
      peerId,
      events: networkEventBus,
      activeValidatorCount: chain.getHeadState().epochCtx.currentShuffling.activeIndices.length,
    });

    const multiaddresses = libp2p
      .getMultiaddrs()
      .map((m) => m.toString())
      .join(",");
    logger.info(`PeerId ${libp2p.peerId.toString()}, Multiaddrs ${multiaddresses}`);

    return new Network({
      opts,
      config,
      logger,
      chain,
      signal,
      networkEventBus,
      networkProcessor,
      worker,
    });
  }

  /** Destroy this instance. Can only be called once. */
  async close(): Promise<void> {
    if (this.closed) return;

    this.chain.emitter.off(routes.events.EventType.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    this.chain.emitter.off(routes.events.EventType.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);

    this.closed = true;
  }

  async scrapeMetrics(): Promise<string> {
    // TODO: Pick from discv5 worker too
    // const discv5 = this.peerManager["discovery"]?.discv5;
    // return (await this.discv5?.metrics()) ?? "";
    return this.worker.scrapeMetrics();
  }

  publishBeaconBlockMaybeBlobs(blockInput: BlockInput): GossipPublishResult {
    switch (blockInput.type) {
      case BlockInputType.preDeneb:
        return this.publishBeaconBlock(blockInput.block);

      case BlockInputType.postDeneb:
        return this.publishSignedBeaconBlockAndBlobsSidecar({
          beaconBlock: blockInput.block as deneb.SignedBeaconBlock,
          blobsSidecar: blockInput.blobs,
        });
    }
  }

  async beaconBlocksMaybeBlobsByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<BlockInput[]> {
    return beaconBlocksMaybeBlobsByRange.call(this, this.config, peerId, request, this.clock.currentEpoch);
  }

  async beaconBlocksMaybeBlobsByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<BlockInput[]> {
    return beaconBlocksMaybeBlobsByRoot.call(
      this,
      this.config,
      peerId,
      request,
      this.clock.currentSlot,
      this.chain.forkChoice.getFinalizedBlock().slot
    );
  }

  /**
   * Request att subnets up `toSlot`. Network will ensure to mantain some peers for each
   */
  prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.worker.prepareBeaconCommitteeSubnet(subscriptions);
  }

  async prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.worker.prepareSyncCommitteeSubnets(subscriptions);
  }

  /**
   * The app layer needs to refresh the status of some peers. The sync have reached a target
   */
  async reStatusPeers(peers: PeerId[]): Promise<void> {
    // TODO: Should be event or function call?
    this.events.emit(NetworkEvent.restatusPeers, peers);
  }

  reportPeer(peer: PeerId, action: PeerAction, actionName: string): void {
    // TODO: Should be event or function call?
    this.events.emit(NetworkEvent.reportPeer, peer, action, actionName);
  }

  // REST API queries

  getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    return this.worker.getNetworkIdentity();
  }

  /**
   * Subscribe to all gossip events. Safe to call multiple times
   */
  subscribeGossipCoreTopics(): void {
    if (!this.subscribedToCoreTopics) {
      this.worker
        .subscribeGossipCoreTopics()
        .then(() => {
          // Only mark subscribedToCoreTopics if worker resolved this call
          this.subscribedToCoreTopics = true;
        })
        .catch((e) => {
          this.logger.error("Error on subscribeGossipCoreTopics", {}, e);
        });
    }
  }

  /**
   * Unsubscribe from all gossip events. Safe to call multiple times
   */
  async unsubscribeGossipCoreTopics(): Promise<void> {
    // Drop all the gossip validation queues
    this.networkProcessor.dropAllJobs();

    return this.worker.unsubscribeGossipCoreTopics();
  }

  isSubscribedToGossipCoreTopics(): boolean {
    return this.subscribedToCoreTopics;
  }

  // Gossip publish

  publishBeaconBlock(signedBlock: allForks.SignedBeaconBlock): GossipPublishResult {
    return this.publishGossipObject(toGossipTopic.beaconBlock(this.config, signedBlock), signedBlock);
  }

  publishSignedBeaconBlockAndBlobsSidecar(item: deneb.SignedBeaconBlockAndBlobsSidecar): GossipPublishResult {
    return this.publishGossipObject(toGossipTopic.signedBeaconBlockAndBlobsSidecar(this.config, item), item);
  }

  publishBeaconAggregateAndProof(aggregate: phase0.SignedAggregateAndProof): GossipPublishResult {
    return this.publishGossipObject(toGossipTopic.beaconAggregateAndProof(this.config, aggregate), aggregate);
  }

  publishBeaconAttestation(attestation: phase0.Attestation, subnet: number): GossipPublishResult {
    return this.publishGossipObject(toGossipTopic.beaconAttestation(this.config, attestation, subnet), attestation);
  }

  publishVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): GossipPublishResult {
    return this.publishGossipObject(toGossipTopic.voluntaryExit(this.config, voluntaryExit), voluntaryExit);
  }

  publishBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): GossipPublishResult {
    return this.publishGossipObject(toGossipTopic.blsToExecutionChange(), blsToExecutionChange);
  }

  publishProposerSlashing(proposerSlashing: phase0.ProposerSlashing): GossipPublishResult {
    return this.publishGossipObject(toGossipTopic.proposerSlashing(this.config, proposerSlashing), proposerSlashing);
  }

  publishAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): GossipPublishResult {
    return this.publishGossipObject(toGossipTopic.attesterSlashing(this.config, attesterSlashing), attesterSlashing);
  }

  publishSyncCommitteeSignature(signature: altair.SyncCommitteeMessage, subnet: number): GossipPublishResult {
    return this.publishGossipObject(toGossipTopic.syncCommitteeSignature(this.config, signature, subnet), signature);
  }

  publishContributionAndProof(contribution: altair.SignedContributionAndProof): GossipPublishResult {
    return this.publishGossipObject(toGossipTopic.contributionAndProof(this.config, contribution), contribution);
  }

  publishLightClientFinalityUpdate(update: allForks.LightClientFinalityUpdate): GossipPublishResult {
    return this.publishGossipObject(toGossipTopic.lightClientFinalityUpdate(this.config, update), update);
  }

  publishLightClientOptimisticUpdate(update: allForks.LightClientOptimisticUpdate): GossipPublishResult {
    return this.publishGossipObject(toGossipTopic.lightClientOptimisticUpdate(this.config, update), update);
  }

  /**
   * Publish a `GossipObject` on a `GossipTopic`
   */
  private async publishGossipObject(topic: GossipTopic, object: GossipTypeMap[GossipType]): GossipPublishResult {
    const topicStr = stringifyGossipTopic(this.config, topic);

    const sszType = getGossipSSZType(topic);
    const data = (sszType.serialize as (object: GossipTypeMap[GossipType]) => Uint8Array)(object);

    const opts: PublishOpts = {
      ignoreDuplicatePublishError: gossipTopicIgnoreDuplicatePublishError[topic.type],
    };

    // Call worker here
    const publishResult = await this.worker.publishGossipObject(topicStr, data, opts);
    return publishResult.recipients.length;
  }

  // ReqResp

  // ReqResp outgoing

  status(peerId: PeerId, request: phase0.Status): Promise<phase0.Status> {
    return this.worker.status(peerId, request);
  }
  goodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void> {
    return this.worker.goodbye(peerId, request);
  }
  ping(peerId: PeerId): Promise<phase0.Ping> {
    return this.worker.ping(peerId);
  }
  metadata(peerId: PeerId): Promise<allForks.Metadata> {
    return this.worker.metadata(peerId);
  }
  beaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<allForks.SignedBeaconBlock[]> {
    return this.worker.beaconBlocksByRange(peerId, request);
  }
  beaconBlocksByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<allForks.SignedBeaconBlock[]> {
    return this.worker.beaconBlocksByRoot(peerId, request);
  }
  blobsSidecarsByRange(peerId: PeerId, request: deneb.BlobsSidecarsByRangeRequest): Promise<deneb.BlobsSidecar[]> {
    return this.worker.blobsSidecarsByRange(peerId, request);
  }
  beaconBlockAndBlobsSidecarByRoot(
    peerId: PeerId,
    request: deneb.BeaconBlockAndBlobsSidecarByRootRequest
  ): Promise<deneb.SignedBeaconBlockAndBlobsSidecar[]> {
    return this.worker.beaconBlockAndBlobsSidecarByRoot(peerId, request);
  }
  lightClientBootstrap(peerId: PeerId, request: Uint8Array): Promise<allForks.LightClientBootstrap> {
    return this.worker.lightClientBootstrap(peerId, request);
  }
  lightClientOptimisticUpdate(peerId: PeerId): Promise<allForks.LightClientOptimisticUpdate> {
    return this.worker.lightClientOptimisticUpdate(peerId);
  }
  lightClientFinalityUpdate(peerId: PeerId): Promise<allForks.LightClientFinalityUpdate> {
    return this.worker.lightClientFinalityUpdate(peerId);
  }
  lightClientUpdatesByRange(
    peerId: PeerId,
    request: altair.LightClientUpdatesByRange
  ): Promise<allForks.LightClientUpdate[]> {
    return this.worker.lightClientUpdatesByRange(peerId, request);
  }

  // Debug

  connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void> {
    return this.worker.connectToPeer(peer, multiaddr);
  }

  disconnectPeer(peer: PeerId): Promise<void> {
    return this.worker.disconnectPeer(peer);
  }

  dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    return this.worker.dumpPeer(peerIdStr);
  }

  dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    return this.worker.dumpPeers();
  }

  dumpPeerScoreStats(): Promise<PeerScoreStats> {
    return this.worker.dumpPeerScoreStats();
  }

  dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump> {
    return this.worker.dumpGossipPeerScoreStats();
  }

  dumpDiscv5KadValues(): Promise<string[]> {
    return this.worker.dumpDiscv5KadValues();
  }

  async dumpGossipQueue(gossipType: GossipType): Promise<PendingGossipsubMessage[]> {
    return this.networkProcessor.dumpGossipQueue(gossipType);
  }

  // private async regossipCachedBlsChanges(): Promise<void> {
  //   let gossipedIndexes = [];
  //   let includedIndexes = [];
  //   let totalProcessed = 0;

  //   this.logger.debug("Re-gossiping unsubmitted cached bls changes");
  //   try {
  //     const headState = this.chain.getHeadState();
  //     for (const poolData of this.chain.opPool.getAllBlsToExecutionChanges()) {
  //       const {data: value, preCapella} = poolData;
  //       if (preCapella) {
  //         if (isValidBlsToExecutionChangeForBlockInclusion(headState, value)) {
  //           await this.gossip.publishBlsToExecutionChange(value);
  //           gossipedIndexes.push(value.message.validatorIndex);
  //         } else {
  //           // No need to gossip if its already been in the headState
  //           // TODO: Should use final state?
  //           includedIndexes.push(value.message.validatorIndex);
  //         }

  //         this.chain.opPool.insertBlsToExecutionChange(value, false);
  //         totalProcessed += 1;

  //         // Cleanup in small batches
  //         if (totalProcessed % CACHED_BLS_BATCH_CLEANUP_LIMIT === 0) {
  //           this.logger.debug("Gossiped cached blsChanges", {
  //             gossipedIndexes: `${gossipedIndexes}`,
  //             includedIndexes: `${includedIndexes}`,
  //             totalProcessed,
  //           });
  //           gossipedIndexes = [];
  //           includedIndexes = [];
  //         }
  //       }
  //     }

  //     // Log any remaining changes
  //     if (totalProcessed % CACHED_BLS_BATCH_CLEANUP_LIMIT !== 0) {
  //       this.logger.debug("Gossiped cached blsChanges", {
  //         gossipedIndexes: `${gossipedIndexes}`,
  //         includedIndexes: `${includedIndexes}`,
  //         totalProcessed,
  //       });
  //     }
  //   } catch (e) {
  //     this.logger.error("Failed to completely gossip unsubmitted cached bls changes", {totalProcessed}, e as Error);
  //     // Throw error so that the promise can be set null to be retied
  //     throw e;
  //   }
  //   if (totalProcessed > 0) {
  //     this.logger.info("Regossiped unsubmitted blsChanges", {totalProcessed});
  //   } else {
  //     this.logger.debug("No unsubmitted blsChanges to gossip", {totalProcessed});
  //   }
  // }

  private onLightClientFinalityUpdate = async (finalityUpdate: allForks.LightClientFinalityUpdate): Promise<void> => {
    // TODO: Review is OK to remove if (this.hasAttachedSyncCommitteeMember())

    try {
      // messages SHOULD be broadcast after one-third of slot has transpired
      // https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#sync-committee
      await this.waitOneThirdOfSlot(finalityUpdate.signatureSlot);
      await this.publishLightClientFinalityUpdate(finalityUpdate);
    } catch (e) {
      // Non-mandatory route on most of network as of Oct 2022. May not have found any peers on topic yet
      // Remove once https://github.com/ChainSafe/js-libp2p-gossipsub/issues/367
      if (!isPublishToZeroPeersError(e as Error)) {
        this.logger.debug("Error on BeaconGossipHandler.onLightclientFinalityUpdate", {}, e as Error);
      }
    }
  };

  private onLightClientOptimisticUpdate = async (
    optimisticUpdate: allForks.LightClientOptimisticUpdate
  ): Promise<void> => {
    // TODO: Review is OK to remove if (this.hasAttachedSyncCommitteeMember())

    try {
      // messages SHOULD be broadcast after one-third of slot has transpired
      // https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md#sync-committee
      await this.waitOneThirdOfSlot(optimisticUpdate.signatureSlot);
      await this.publishLightClientOptimisticUpdate(optimisticUpdate);
    } catch (e) {
      // Non-mandatory route on most of network as of Oct 2022. May not have found any peers on topic yet
      // Remove once https://github.com/ChainSafe/js-libp2p-gossipsub/issues/367
      if (!isPublishToZeroPeersError(e as Error)) {
        this.logger.debug("Error on BeaconGossipHandler.onLightclientOptimisticUpdate", {}, e as Error);
      }
    }
  };

  private waitOneThirdOfSlot = async (slot: number): Promise<void> => {
    const secAtSlot = computeTimeAtSlot(this.config, slot + 1 / 3, this.chain.genesisTime);
    const msToSlot = secAtSlot * 1000 - Date.now();
    await sleep(msToSlot, this.signal);
  };
}
