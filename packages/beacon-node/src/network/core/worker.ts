import worker from "node:worker_threads";
import {createFromProtobuf} from "@libp2p/peer-id-factory";
import {expose} from "@chainsafe/threads/worker";
import {Observable, Subject} from "@chainsafe/threads/observable";
import {chainConfigFromJson, createBeaconConfig} from "@lodestar/config";
import {createWinstonLogger} from "@lodestar/utils";
import {collectNodeJSMetrics, RegistryMetricCreator} from "../../metrics/index.js";
import {LocalClock} from "../../chain/clock/LocalClock.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {PendingGossipsubMessage} from "../processor/types.js";
import {getReqRespHandlersEventBased} from "../reqresp/utils/handlerToEvents.js";
import {CommitteeSubscription} from "../subnets/interface.js";
import {NetworkWorkerApi, NetworkWorkerData} from "./types.js";
import {BaseNetwork} from "./badNameWorkerWrapper.js";

// Cloned data from instatiation
const workerData = worker.workerData as NetworkWorkerData;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
if (!workerData) throw Error("workerData must be defined");

const config = createBeaconConfig(chainConfigFromJson(workerData.chainConfigJson), workerData.genesisValidatorsRoot);
// TODO: Pass options from main thread for logging
// TODO: Logging won't be visible in file loggers
const logger = createWinstonLogger();
const peerId = await createFromProtobuf(workerData.peerIdProto);

const abortController = new AbortController();

// Set up metrics, nodejs and discv5-specific
const metricsRegister = workerData.metrics ? new RegistryMetricCreator() : null;
if (metricsRegister) {
  collectNodeJSMetrics(metricsRegister, "libp2p_worker_");
}

// Main event bus shared across the stack
const networkEventBus = new NetworkEventBus();
const clock = new LocalClock({config, genesisTime: workerData.genesisTime, signal: abortController.signal});

// ReqResp handles that transform internal async iterable into events
const reqRespHandlers = getReqRespHandlersEventBased(networkEventBus);

const badNameLibp2pWorker = await BaseNetwork.init({
  opts: workerData.opts,
  config,
  peerId,
  peerStoreDir: workerData.peerStoreDir,
  logger,
  clock,
  metricsRegistry: metricsRegister,
  reqRespHandlers,
  activeValidatorCount: workerData.activeValidatorCount,
  networkEventBus,
});

const pendingGossipsubMessageSubject = new Subject<PendingGossipsubMessage>();

networkEventBus.on(NetworkEvent.pendingGossipsubMessage, (data) => {
  pendingGossipsubMessageSubject.next(data);
});

const libp2pWorkerApi: NetworkWorkerApi = {
  close() {
    abortController.abort();
    return badNameLibp2pWorker.close();
  },

  publishGossipObject(topic, data, opts) {
    return badNameLibp2pWorker.gossip.publish(topic, data, opts);
  },

  pendingGossipsubMessage() {
    return Observable.from(pendingGossipsubMessageSubject);
  },

  // TODO: Should this just be events? Do they need to report errors back?
  prepareBeaconCommitteeSubnets: async (subscriptions: CommitteeSubscription[]) =>
    badNameLibp2pWorker.prepareBeaconCommitteeSubnet(subscriptions),
  prepareSyncCommitteeSubnets: async (subscriptions: CommitteeSubscription[]) =>
    badNameLibp2pWorker.prepareSyncCommitteeSubnets(subscriptions),
  subscribeGossipCoreTopics: async (): Promise<void> => badNameLibp2pWorker.subscribeGossipCoreTopics(),
  unsubscribeGossipCoreTopics: async (): Promise<void> => badNameLibp2pWorker.unsubscribeGossipCoreTopics(),

  // ReqResp outgoing requests

  status: (peerId, request) => badNameLibp2pWorker.reqResp.status(peerId, request),
  goodbye: (peerId, request) => badNameLibp2pWorker.reqResp.goodbye(peerId, request),
  ping: (peerId) => badNameLibp2pWorker.reqResp.ping(peerId),
  metadata: (peerId) => badNameLibp2pWorker.reqResp.metadata(peerId),
  beaconBlockAndBlobsSidecarByRoot: (peerId, request) =>
    badNameLibp2pWorker.reqResp.beaconBlockAndBlobsSidecarByRoot(peerId, request),
  beaconBlocksByRange: (peerId, request) => badNameLibp2pWorker.reqResp.beaconBlocksByRange(peerId, request),
  beaconBlocksByRoot: (peerId, request) => badNameLibp2pWorker.reqResp.beaconBlocksByRoot(peerId, request),
  blobsSidecarsByRange: (peerId, request) => badNameLibp2pWorker.reqResp.blobsSidecarsByRange(peerId, request),
  lightClientBootstrap: (peerId, request) => badNameLibp2pWorker.reqResp.lightClientBootstrap(peerId, request),
  lightClientFinalityUpdate: (peerId) => badNameLibp2pWorker.reqResp.lightClientFinalityUpdate(peerId),
  lightClientOptimisticUpdate: (peerId) => badNameLibp2pWorker.reqResp.lightClientOptimisticUpdate(peerId),
  lightClientUpdatesByRange: (peerId, request) =>
    badNameLibp2pWorker.reqResp.lightClientUpdatesByRange(peerId, request),

  // Debug

  getConnectionsByPeer: () => badNameLibp2pWorker.getConnectionsByPeer(),
  getConnectedPeers: async () => badNameLibp2pWorker.getConnectedPeers(),
  getConnectedPeerCount: async () => badNameLibp2pWorker.getConnectedPeerCount(),
  connectToPeer: (peer, multiaddr) => badNameLibp2pWorker.connectToPeer(peer, multiaddr),
  disconnectPeer: (peer) => badNameLibp2pWorker.disconnectPeer(peer),
  dumpPeers: async () => badNameLibp2pWorker.dumpPeers(),
  dumpPeer: async (peerIdStr) => badNameLibp2pWorker.dumpPeer(peerIdStr),
  dumpPeerScoreStats: async () => badNameLibp2pWorker.dumpPeerScoreStats(),
  dumpGossipPeerScoreStats: async () => badNameLibp2pWorker.dumpGossipPeerScoreStats(),
  dumpDiscv5KadValues: async () => badNameLibp2pWorker.dumpDiscv5KadValues(),
  dumpMeshPeers: async () => badNameLibp2pWorker.dumpMeshPeers(),
};

expose(libp2pWorkerApi);
