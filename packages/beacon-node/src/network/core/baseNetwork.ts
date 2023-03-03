import {PeerId} from "@libp2p/interface-peer-id";
import {Multiaddr} from "@multiformats/multiaddr";
import {Connection} from "@libp2p/interface-connection";
import {Registry} from "prom-client";
import {routes} from "@lodestar/api";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/dist/src/score/peer-score.js";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {Epoch, phase0} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {Libp2p} from "../interface.js";
import {PeerManager} from "../peers/peerManager.js";
import {ReqRespBeaconNode} from "../reqresp/ReqRespBeaconNode.js";
import {Eth2Gossipsub, getCoreTopicsAtFork} from "../gossip/index.js";
import {AttnetsService} from "../subnets/attnetsService.js";
import {SyncnetsService} from "../subnets/syncnetsService.js";
import {FORK_EPOCH_LOOKAHEAD, getActiveForks} from "../forks.js";
import {NetworkOptions} from "../options.js";
import {CommitteeSubscription} from "../subnets/interface.js";
import {MetadataController} from "../metadata.js";
import {createNodeJsLibp2p} from "../nodejs/util.js";
import {PeersData} from "../peers/peersData.js";
import {PeerRpcScoreStore, PeerScoreStats} from "../peers/index.js";

import {getConnectionsMap} from "../util.js";
import {ClockEvent, LocalClock} from "../../chain/clock/LocalClock.js";
import {formatNodePeer} from "../../api/impl/node/utils.js";
import {NetworkEventBus} from "../events.js";
import {Discv5Worker} from "../discv5/index.js";
import {LocalStatusCache} from "../status.js";
import {IBaseNetwork} from "./types.js";

type Mods = {
  libp2p: Libp2p;
  reqResp: ReqRespBeaconNode;
  gossip: Eth2Gossipsub;
  attnetsService: AttnetsService;
  syncnetsService: SyncnetsService;
  peerManager: PeerManager;
  peersData: PeersData;
  metadata: MetadataController;
  logger: Logger;
  config: BeaconConfig;
  clock: LocalClock;
  statusCache: LocalStatusCache;
  opts: NetworkOptions;
};

export type BaseNetworkInit = {
  opts: NetworkOptions;
  config: BeaconConfig;
  peerId: PeerId;
  peerStoreDir: string;
  logger: Logger;
  metricsRegistry: Registry;
  reqRespHandlers;
  clock: LocalClock;
  networkEventBus: NetworkEventBus;
  activeValidatorCount: number;
  status: phase0.Status;
};

/**
 * This class is meant to work both:
 * - In a libp2p worker
 * - In the main thread
 *
 * libp2p holds the reference to the TCP transport socket. libp2p is in a worker, what components
 * must be in a worker too?
 * - MetadataController: Read by ReqRespBeaconNode, written by AttnetsService + SyncnetsService
 * - PeerRpcScoreStore
 * - ReqRespBeaconNode: Must be in worker, depends on libp2p
 * - Eth2Gossipsub: Must be in worker, depends on libp2p
 * - AttnetsService
 * - SyncnetsService
 * - PeerManager
 * - NetworkProcessor: Must be in the main thread, depends on chain
 */
export class BaseNetwork implements IBaseNetwork {
  readonly gossip: Eth2Gossipsub;
  readonly reqResp: ReqRespBeaconNode;

  // Internal modules
  private readonly libp2p: Libp2p;
  private readonly attnetsService: AttnetsService;
  private readonly syncnetsService: SyncnetsService;
  private readonly peerManager: PeerManager;
  private readonly peersData: PeersData;
  // TODO: Review if here is best place, and best architecture
  private readonly metadata: MetadataController;
  private readonly logger: Logger;
  private readonly config: BeaconConfig;
  private readonly clock: LocalClock;
  private readonly statusCache: LocalStatusCache;
  private readonly opts: NetworkOptions;

  // Internal state
  private readonly subscribedForks = new Set<ForkName>();
  private closed = false;

  constructor(modules: Mods) {
    this.libp2p = modules.libp2p;
    this.reqResp = modules.reqResp;
    this.gossip = modules.gossip;
    this.attnetsService = modules.attnetsService;
    this.syncnetsService = modules.syncnetsService;
    this.peerManager = modules.peerManager;
    this.peersData = modules.peersData;
    this.metadata = modules.metadata;
    this.logger = modules.logger;
    this.config = modules.config;
    this.clock = modules.clock;
    this.statusCache = modules.statusCache;
    this.opts = modules.opts;

    this.clock.on(ClockEvent.epoch, this.onEpoch);
  }

  static async init({
    opts,
    config,
    peerId,
    peerStoreDir,
    logger,
    metricsRegistry,
    reqRespHandlers,
    networkEventBus,
    clock,
    activeValidatorCount,
    status,
  }: BaseNetworkInit): Promise<BaseNetwork> {
    const libp2p = await createNodeJsLibp2p(peerId, opts, {
      peerStoreDir,
      metrics: Boolean(metricsRegistry),
      metricsRegistry: metricsRegistry ?? undefined,
    });

    const peersData = new PeersData();
    const peerRpcScores = new PeerRpcScoreStore(metrics);
    const statusCache = new LocalStatusCache(status);

    // Bind discv5's ENR to local metadata
    // resolve circular dependency by setting `discv5` variable after the peer manager is instantiated
    // eslint-disable-next-line prefer-const
    let discv5: Discv5Worker | undefined;
    const onMetadataSetValue = function onMetadataSetValue(key: string, value: Uint8Array): void {
      discv5?.setEnrValue(key, value).catch((e) => logger.error("error on setEnrValue", {key}, e));
    };
    const metadata = new MetadataController({}, {config, onSetValue: onMetadataSetValue, logger});

    const reqResp = new ReqRespBeaconNode(
      {config, libp2p, reqRespHandlers, metadata, peerRpcScores, logger, networkEventBus, metrics, peersData},
      opts
    );

    const attnetsService = new AttnetsService(config, clock, networkEventBus, metadata, logger, metrics, opts);
    const syncnetsService = new SyncnetsService(config, clock, networkEventBus, metadata, logger, metrics, opts);

    const gossip = new Eth2Gossipsub(opts, {
      config,
      libp2p,
      logger,
      metrics,
      eth2Context: {
        activeValidatorCount,
        currentSlot: clock.currentSlot,
        currentEpoch: clock.currentEpoch,
      },
      peersData,
      attnetsService,
      events: networkEventBus,
    });

    const peerManager = new PeerManager(
      {
        libp2p,
        reqResp,
        gossip,
        attnetsService,
        syncnetsService,
        logger,
        metrics,
        clock,
        config,
        peerRpcScores,
        networkEventBus,
        peersData,
        statusCache,
      },
      opts
    );

    // Note: should not be necessary, already called in createNodeJsLibp2p()
    await libp2p.start();

    await reqResp.start();

    await gossip.start();
    attnetsService.start();
    syncnetsService.start();

    // Network spec decides version changes based on clock fork, not head fork
    const forkCurrentSlot = config.getForkName(clock.currentSlot);
    // Register only ReqResp protocols relevant to clock's fork
    reqResp.registerProtocolsAtFork(forkCurrentSlot);

    await peerManager.start();

    // Bind discv5's ENR to local metadata
    discv5 = peerManager["discovery"]?.discv5;

    // Initialize ENR with clock's fork
    metadata.upstreamValues(clock.currentEpoch);

    return new BaseNetwork({
      libp2p,
      reqResp,
      gossip,
      attnetsService,
      syncnetsService,
      peerManager,
      peersData,
      metadata,
      logger,
      config,
      clock,
      statusCache,
      opts,
    });
  }

  /** Destroy this instance. Can only be called once. */
  async close(): Promise<void> {
    if (this.closed) return;

    this.clock.off(ClockEvent.epoch, this.onEpoch);
    this.clock.close();

    // Must goodbye and disconnect before stopping libp2p
    await this.peerManager.goodbyeAndDisconnectAllPeers();
    await this.peerManager.stop();
    await this.gossip.stop();

    await this.reqResp.stop();
    await this.reqResp.unregisterAllProtocols();

    this.attnetsService.stop();
    this.syncnetsService.stop();
    await this.libp2p.stop();

    this.closed = true;
  }

  async scrapeMetrics(): Promise<string> {
    throw new Error("TODO");
  }

  async updateStatus(status: phase0.Status): Promise<void> {
    this.statusCache.update(status);
  }

  /**
   * Request att subnets up `toSlot`. Network will ensure to mantain some peers for each
   */
  async prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    this.attnetsService.addCommitteeSubscriptions(subscriptions);
    if (subscriptions.length > 0) this.peerManager.onCommitteeSubscriptions();
  }

  async prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    this.syncnetsService.addCommitteeSubscriptions(subscriptions);
    if (subscriptions.length > 0) this.peerManager.onCommitteeSubscriptions();
  }

  /**
   * Subscribe to all gossip events. Safe to call multiple times
   */
  async subscribeGossipCoreTopics(): Promise<void> {
    if (!(await this.isSubscribedToGossipCoreTopics())) {
      this.logger.info("Subscribed gossip core topics");
    }

    for (const fork of getActiveForks(this.config, this.clock.currentEpoch)) {
      this.subscribeCoreTopicsAtFork(fork);
    }
  }

  /**
   * Unsubscribe from all gossip events. Safe to call multiple times
   */
  async unsubscribeGossipCoreTopics(): Promise<void> {
    for (const fork of this.subscribedForks.values()) {
      this.unsubscribeCoreTopicsAtFork(fork);
    }
  }

  async isSubscribedToGossipCoreTopics(): Promise<boolean> {
    return this.subscribedForks.size > 0;
  }

  // REST API queries

  async getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    const enr = await this.peerManager["discovery"]?.discv5.enr();
    const discoveryAddresses = [
      enr?.getLocationMultiaddr("tcp")?.toString() ?? null,
      enr?.getLocationMultiaddr("udp")?.toString() ?? null,
    ].filter((addr): addr is string => Boolean(addr));

    return {
      peerId: this.libp2p.peerId.toString(),
      enr: enr?.encodeTxt() || "",
      discoveryAddresses,
      p2pAddresses: this.libp2p.getMultiaddrs().map((m) => m.toString()),
      metadata: this.metadata,
    };
  }

  getConnectionsByPeer(): Map<string, Connection[]> {
    return getConnectionsMap(this.libp2p.connectionManager);
  }

  async getConnectedPeers(): Promise<PeerId[]> {
    return this.peerManager.getConnectedPeerIds();
  }

  async getConnectedPeerCount(): Promise<number> {
    return this.peerManager.getConnectedPeerIds().length;
  }

  // Debug

  async connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void> {
    await this.libp2p.peerStore.addressBook.add(peer, multiaddr);
    await this.libp2p.dial(peer);
  }

  async disconnectPeer(peer: PeerId): Promise<void> {
    await this.libp2p.hangUp(peer);
  }

  async dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    const connections = this.getConnectionsByPeer().get(peerIdStr);
    return connections
      ? {...formatNodePeer(peerIdStr, connections), agentVersion: this.peersData.getAgentVersion(peerIdStr)}
      : undefined;
  }

  async dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    return Array.from(this.getConnectionsByPeer().entries()).map(([peerIdStr, connections]) => ({
      ...formatNodePeer(peerIdStr, connections),
      agentVersion: this.peersData.getAgentVersion(peerIdStr),
    }));
  }

  async dumpPeerScoreStats(): Promise<PeerScoreStats> {
    return this.peerManager.dumpPeerScoreStats();
  }

  async dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump> {
    return this.gossip.dumpPeerScoreStats();
  }

  async dumpDiscv5KadValues(): Promise<string[]> {
    return (await this.peerManager["discovery"]?.discv5?.kadValues())?.map((enr) => enr.encodeTxt()) ?? [];
  }

  async dumpMeshPeers(): Promise<Record<string, string[]>> {
    const meshPeers: Record<string, string[]> = {};
    for (const topic of this.gossip.getTopics()) {
      meshPeers[topic] = this.gossip.getMeshPeers(topic);
    }
    return meshPeers;
  }

  /**
   * Handle subscriptions through fork transitions, @see FORK_EPOCH_LOOKAHEAD
   */
  private onEpoch = async (epoch: Epoch): Promise<void> => {
    try {
      // Compute prev and next fork shifted, so next fork is still next at forkEpoch + FORK_EPOCH_LOOKAHEAD
      const activeForks = getActiveForks(this.config, epoch);
      for (let i = 0; i < activeForks.length; i++) {
        // Only when a new fork is scheduled post this one
        if (activeForks[i + 1]) {
          const prevFork = activeForks[i];
          const nextFork = activeForks[i + 1];
          const forkEpoch = this.config.forks[nextFork].epoch;

          // Before fork transition
          if (epoch === forkEpoch - FORK_EPOCH_LOOKAHEAD) {
            // Don't subscribe to new fork if the node is not subscribed to any topic
            if (await this.isSubscribedToGossipCoreTopics()) {
              this.subscribeCoreTopicsAtFork(nextFork);
              this.logger.info("Subscribing gossip topics before fork", {nextFork});
            } else {
              this.logger.info("Skipping subscribing gossip topics before fork", {nextFork});
            }
            this.attnetsService.subscribeSubnetsToNextFork(nextFork);
            this.syncnetsService.subscribeSubnetsToNextFork(nextFork);
          }

          // On fork transition
          if (epoch === forkEpoch) {
            // updateEth2Field() MUST be called with clock epoch, onEpoch event is emitted in response to clock events
            this.metadata.updateEth2Field(epoch);
            this.reqResp.registerProtocolsAtFork(nextFork);
          }

          // After fork transition
          if (epoch === forkEpoch + FORK_EPOCH_LOOKAHEAD) {
            this.logger.info("Unsubscribing gossip topics from prev fork", {prevFork});
            this.unsubscribeCoreTopicsAtFork(prevFork);
            this.attnetsService.unsubscribeSubnetsFromPrevFork(prevFork);
            this.syncnetsService.unsubscribeSubnetsFromPrevFork(prevFork);
          }
        }
      }

      // TODO: Re-add regossipCachedBlsChanges()
      // If we are subscribed and post capella fork epoch, try gossiping the cached bls changes
      // if (
      //   this.isSubscribedToGossipCoreTopics() &&
      //   epoch >= this.config.CAPELLA_FORK_EPOCH &&
      //   !this.regossipBlsChangesPromise
      // ) {
      //   this.regossipBlsChangesPromise = this.regossipCachedBlsChanges()
      //     // If the processing fails for e.g. because of lack of peers set the promise
      //     // to be null again to be retried
      //     .catch((_e) => {
      //       this.regossipBlsChangesPromise = null;
      //     });
      // }
    } catch (e) {
      this.logger.error("Error on BeaconGossipHandler.onEpoch", {epoch}, e as Error);
    }
  };

  private subscribeCoreTopicsAtFork(fork: ForkName): void {
    if (this.subscribedForks.has(fork)) return;
    this.subscribedForks.add(fork);
    const {subscribeAllSubnets} = this.opts;

    for (const topic of getCoreTopicsAtFork(fork, {subscribeAllSubnets})) {
      this.gossip.subscribeTopic({...topic, fork});
    }
  }

  private unsubscribeCoreTopicsAtFork(fork: ForkName): void {
    if (!this.subscribedForks.has(fork)) return;
    this.subscribedForks.delete(fork);
    const {subscribeAllSubnets} = this.opts;

    for (const topic of getCoreTopicsAtFork(fork, {subscribeAllSubnets})) {
      this.gossip.unsubscribeTopic({...topic, fork});
    }
  }
}
