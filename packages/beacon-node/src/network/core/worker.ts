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
import {NetworkWorkerApi, NetworkWorkerData} from "./types.js";
import {BaseNetwork} from "./baseNetwork.js";

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
const events = new NetworkEventBus();
const clock = new LocalClock({config, genesisTime: workerData.genesisTime, signal: abortController.signal});

// ReqResp handles that transform internal async iterable into events
const reqRespHandlers = getReqRespHandlersEventBased(events);

const baseNetwork = await BaseNetwork.init({
  opts: workerData.opts,
  config,
  peerId,
  peerStoreDir: workerData.peerStoreDir,
  logger,
  clock,
  metricsRegistry: metricsRegister,
  reqRespHandlers,
  activeValidatorCount: workerData.activeValidatorCount,
  events,
  initialStatus: workerData.initialStatus,
});

const pendingGossipsubMessageSubject = new Subject<PendingGossipsubMessage>();

events.on(NetworkEvent.pendingGossipsubMessage, (data) => {
  pendingGossipsubMessageSubject.next(data);
});

const libp2pWorkerApi: NetworkWorkerApi = {
  close() {
    abortController.abort();
    return baseNetwork.close();
  },
  scrapeMetrics: () => baseNetwork.scrapeMetrics(),

  updateStatus: (status) => baseNetwork.updateStatus(status),

  publishGossip(topic, data, opts) {
    return baseNetwork.rawGossip.publish(topic, data, opts);
  },
  pendingGossipsubMessage: () => Observable.from(pendingGossipsubMessageSubject),

  prepareBeaconCommitteeSubnets: (subscriptions) => baseNetwork.prepareBeaconCommitteeSubnets(subscriptions),
  prepareSyncCommitteeSubnets: (subscriptions) => baseNetwork.prepareSyncCommitteeSubnets(subscriptions),
  reportPeer: (peer, action, actionName) => baseNetwork.reportPeer(peer, action, actionName),
  reStatusPeers: (peers) => baseNetwork.reStatusPeers(peers),
  subscribeGossipCoreTopics: () => baseNetwork.subscribeGossipCoreTopics(),
  unsubscribeGossipCoreTopics: () => baseNetwork.unsubscribeGossipCoreTopics(),

  // ReqResp outgoing requests

  ping: (peerId) => baseNetwork.rawReqResp.ping(peerId),
  goodbye: (peerId, request) => baseNetwork.rawReqResp.goodbye(peerId, request),
  metadata: (peerId) => baseNetwork.rawReqResp.metadata(peerId),
  status: (peerId, request) => baseNetwork.rawReqResp.status(peerId, request),
  beaconBlockAndBlobsSidecarByRoot: (peerId, request) =>
    baseNetwork.rawReqResp.beaconBlockAndBlobsSidecarByRoot(peerId, request),
  beaconBlocksByRange: (peerId, request) => baseNetwork.rawReqResp.beaconBlocksByRange(peerId, request),
  beaconBlocksByRoot: (peerId, request) => baseNetwork.rawReqResp.beaconBlocksByRoot(peerId, request),
  blobsSidecarsByRange: (peerId, request) => baseNetwork.rawReqResp.blobsSidecarsByRange(peerId, request),
  lightClientBootstrap: (peerId, request) => baseNetwork.rawReqResp.lightClientBootstrap(peerId, request),
  lightClientFinalityUpdate: (peerId) => baseNetwork.rawReqResp.lightClientFinalityUpdate(peerId),
  lightClientOptimisticUpdate: (peerId) => baseNetwork.rawReqResp.lightClientOptimisticUpdate(peerId),
  lightClientUpdatesByRange: (peerId, request) => baseNetwork.rawReqResp.lightClientUpdatesByRange(peerId, request),

  // Debug

  getNetworkIdentity: () => baseNetwork.getNetworkIdentity(),
  getConnectedPeers: () => baseNetwork.getConnectedPeers(),
  getConnectedPeerCount: () => baseNetwork.getConnectedPeerCount(),
  connectToPeer: (peer, multiaddr) => baseNetwork.connectToPeer(peer, multiaddr),
  disconnectPeer: (peer) => baseNetwork.disconnectPeer(peer),
  dumpPeers: () => baseNetwork.dumpPeers(),
  dumpPeer: (peerIdStr) => baseNetwork.dumpPeer(peerIdStr),
  dumpPeerScoreStats: () => baseNetwork.dumpPeerScoreStats(),
  dumpGossipPeerScoreStats: () => baseNetwork.dumpGossipPeerScoreStats(),
  dumpDiscv5KadValues: () => baseNetwork.dumpDiscv5KadValues(),
  dumpMeshPeers: () => baseNetwork.dumpMeshPeers(),
};

expose(libp2pWorkerApi);
