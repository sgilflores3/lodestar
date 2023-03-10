import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {BeaconConfig} from "@lodestar/config";
import {Logger, sleep} from "@lodestar/utils";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {phase0, allForks} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {Metrics, RegistryMetricCreator} from "../metrics/index.js";
import {IBeaconChain, BeaconClock} from "../chain/index.js";
import {BlockInput} from "../chain/blocks/types.js";
import {IBeaconDb} from "../db/interface.js";
import {LocalClock} from "../chain/clock/LocalClock.js";
import {PeerSet} from "../util/peerMap.js";
import {NetworkOptions} from "./options.js";
import {INetwork} from "./interface.js";
import {ReqRespHandlers, beaconBlocksMaybeBlobsByRange, IReqRespBeaconNode} from "./reqresp/index.js";
import {beaconBlocksMaybeBlobsByRoot} from "./reqresp/beaconBlocksMaybeBlobsByRoot.js";
import {GossipHandlers, GossipType, PublisherBeaconNode} from "./gossip/index.js";
import {PeerAction, PeerScoreStats} from "./peers/index.js";
import {INetworkEventBus, NetworkEvent, NetworkEventBus} from "./events.js";
import {CommitteeSubscription} from "./subnets/index.js";
import {isPublishToZeroPeersError} from "./util.js";
import {NetworkProcessor} from "./processor/index.js";
import {PendingGossipsubMessage} from "./processor/types.js";
import {NetworkCore, WorkerNetworkCore} from "./core/index.js";
import {BaseNetwork} from "./core/baseNetwork.js";

type NetworkModules = {
  opts: NetworkOptions;
  peerId: PeerId;
  config: BeaconConfig;
  logger: Logger;
  chain: IBeaconChain;
  signal: AbortSignal;
  networkEventBus: NetworkEventBus;
  networkProcessor: NetworkProcessor;
  core: NetworkCore;
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
  readonly peerId: PeerId;
  // TODO: Make private
  readonly events: INetworkEventBus;
  readonly gossip: PublisherBeaconNode;
  readonly reqResp: IReqRespBeaconNode;

  private readonly logger: Logger;
  private readonly config: BeaconConfig;
  private readonly clock: BeaconClock;
  private readonly chain: IBeaconChain;
  private readonly signal: AbortSignal;

  // TODO: Review
  private readonly networkProcessor: NetworkProcessor;
  private readonly core: NetworkCore;

  private subscribedToCoreTopics = false;
  private connectedPeers = new PeerSet();
  private regossipBlsChangesPromise: Promise<void> | null = null;
  private closed = false;

  constructor(modules: NetworkModules) {
    this.peerId = modules.peerId;
    this.config = modules.config;
    this.logger = modules.logger;
    this.chain = modules.chain;
    this.clock = modules.chain.clock;
    this.signal = modules.signal;
    this.events = modules.networkEventBus;
    this.networkProcessor = modules.networkProcessor;
    this.core = modules.core;
    this.gossip = this.core.gossip;
    this.reqResp = this.core.reqResp;

    this.events.on(NetworkEvent.peerConnected, this.onPeerConnected);
    this.events.on(NetworkEvent.peerDisconnected, this.onPeerDisconnected);
    this.chain.emitter.on(routes.events.EventType.head, this.onHead);
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
    peerId,
    peerStoreDir,
    reqRespHandlers,
  }: NetworkInitModules): Promise<Network> {
    const events = new NetworkEventBus();

    const networkProcessor = new NetworkProcessor({chain, db, config, logger, metrics, events, gossipHandlers}, opts);

    let core: NetworkCore;
    const activeValidatorCount = chain.getHeadState().epochCtx.currentShuffling.activeIndices.length;
    const initialStatus = chain.getStatus();
    // eslint-disable-next-line no-constant-condition
    if (!opts.useWorker) {
      const metricsRegistry = metrics ? new RegistryMetricCreator() : null;
      const clock = chain.clock as LocalClock;

      core = await BaseNetwork.init({
        opts,
        config,
        peerId,
        peerStoreDir,
        logger,
        clock,
        events,
        metricsRegistry,
        reqRespHandlers,
        initialStatus,
        activeValidatorCount,
      });
    } else {
      core = await WorkerNetworkCore.init({
        opts: {
          ...opts,
          peerStoreDir,
          metrics: Boolean(metrics),
          activeValidatorCount,
          genesisTime: chain.genesisTime,
          initialStatus,
        },
        config,
        peerId,
        logger,
        events,
      });
    }

    const multiaddresses = opts.bootMultiaddrs?.join(",");
    logger.info(`PeerId ${peerId.toString()}, Multiaddrs ${multiaddresses}`);

    return new Network({
      opts,
      peerId,
      config,
      logger,
      chain,
      signal,
      networkEventBus: events,
      networkProcessor,
      core,
    });
  }

  /** Destroy this instance. Can only be called once. */
  async close(): Promise<void> {
    if (this.closed) return;

    this.events.off(NetworkEvent.peerConnected, this.onPeerConnected);
    this.events.off(NetworkEvent.peerDisconnected, this.onPeerDisconnected);
    this.chain.emitter.off(routes.events.EventType.head, this.onHead);
    this.chain.emitter.off(routes.events.EventType.lightClientFinalityUpdate, this.onLightClientFinalityUpdate);
    this.chain.emitter.off(routes.events.EventType.lightClientOptimisticUpdate, this.onLightClientOptimisticUpdate);

    this.closed = true;
  }

  async scrapeMetrics(): Promise<string> {
    // TODO: Pick from discv5 worker too
    // const discv5 = this.peerManager["discovery"]?.discv5;
    // return (await this.discv5?.metrics()) ?? "";
    return this.core.scrapeMetrics();
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
  async prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.core.prepareBeaconCommitteeSubnets(subscriptions);
  }

  async prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.core.prepareSyncCommitteeSubnets(subscriptions);
  }

  /**
   * The app layer needs to refresh the status of some peers. The sync have reached a target
   */
  async reStatusPeers(peers: PeerId[]): Promise<void> {
    return this.core.reStatusPeers(peers);
  }

  async reportPeer(peer: PeerId, action: PeerAction, actionName: string): Promise<void> {
    return this.core.reportPeer(peer, action, actionName);
  }

  // REST API queries
  getConnectedPeers(): PeerId[] {
    return Array.from(this.connectedPeers.values());
  }
  getConnectedPeerCount(): number {
    return this.connectedPeers.size;
  }

  async getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    return this.core.getNetworkIdentity();
  }

  /**
   * Subscribe to all gossip events. Safe to call multiple times
   */
  async subscribeGossipCoreTopics(): Promise<void> {
    if (!this.subscribedToCoreTopics) {
      await this.core.subscribeGossipCoreTopics();
      // Only mark subscribedToCoreTopics if worker resolved this call
      this.subscribedToCoreTopics = true;
    }
  }

  /**
   * Unsubscribe from all gossip events. Safe to call multiple times
   */
  async unsubscribeGossipCoreTopics(): Promise<void> {
    // Drop all the gossip validation queues
    this.networkProcessor.dropAllJobs();

    return this.core.unsubscribeGossipCoreTopics();
  }

  isSubscribedToGossipCoreTopics(): boolean {
    return this.subscribedToCoreTopics;
  }

  // Debug

  connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void> {
    return this.core.connectToPeer(peer, multiaddr);
  }

  disconnectPeer(peer: PeerId): Promise<void> {
    return this.core.disconnectPeer(peer);
  }

  dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    return this.core.dumpPeer(peerIdStr);
  }

  dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    return this.core.dumpPeers();
  }

  dumpPeerScoreStats(): Promise<PeerScoreStats> {
    return this.core.dumpPeerScoreStats();
  }

  dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump> {
    return this.core.dumpGossipPeerScoreStats();
  }

  dumpDiscv5KadValues(): Promise<string[]> {
    return this.core.dumpDiscv5KadValues();
  }

  dumpMeshPeers(): Promise<Record<string, string[]>> {
    return this.core.dumpMeshPeers();
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
      await this.gossip.publishLightClientFinalityUpdate(finalityUpdate);
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
      await this.gossip.publishLightClientOptimisticUpdate(optimisticUpdate);
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

  private onHead = async (): Promise<void> => {
    await this.core.updateStatus(this.chain.getStatus());
  };

  private onPeerConnected = (peerId: PeerId): void => {
    this.connectedPeers.add(peerId);
  };

  private onPeerDisconnected = (peerId: PeerId): void => {
    this.connectedPeers.delete(peerId);
  };
}
