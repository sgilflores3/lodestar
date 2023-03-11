import worker from "node:worker_threads";
import {createFromProtobuf} from "@libp2p/peer-id-factory";
import {expose} from "@chainsafe/threads/worker";
import {Observable, Subject} from "@chainsafe/threads/observable";
import {chainConfigFromJson, createBeaconConfig} from "@lodestar/config";
import {createWinstonLogger} from "@lodestar/utils";
import type {WorkerModule} from "@chainsafe/threads/dist/types/worker.js";
import {collectNodeJSMetrics, RegistryMetricCreator} from "../../metrics/index.js";
import {LocalClock} from "../../chain/clock/LocalClock.js";
import {NetworkEvent, NetworkEventBus} from "../events.js";
import {PendingGossipsubMessage} from "../processor/types.js";
import {getReqRespHandlersEventBased} from "../reqresp/utils/handlerToEvents.js";
import {NetworkWorkerApi, NetworkWorkerData} from "./types.js";
import {NetworkCore} from "./networkCore.js";

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
  collectNodeJSMetrics(metricsRegister, "network_worker_");
}

// Main event bus shared across the stack
const events = new NetworkEventBus();
const clock = new LocalClock({config, genesisTime: workerData.genesisTime, signal: abortController.signal});

// ReqResp handles that transform internal async iterable into events
const reqRespHandlers = getReqRespHandlersEventBased(events);

const core = await NetworkCore.init({
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
  close: () => {
    abortController.abort();
    return core.close();
  },
  scrapeMetrics: () => core.scrapeMetrics(),

  updateStatus: (status) => core.updateStatus(status),

  publishGossip: (topic, data, opts) => core.rawGossip.publish(topic, data, opts),
  pendingGossipsubMessage: () => Observable.from(pendingGossipsubMessageSubject),

  prepareBeaconCommitteeSubnets: (subscriptions) => core.prepareBeaconCommitteeSubnets(subscriptions),
  prepareSyncCommitteeSubnets: (subscriptions) => core.prepareSyncCommitteeSubnets(subscriptions),
  reportPeer: (peer, action, actionName) => core.reportPeer(peer, action, actionName),
  reStatusPeers: (peers) => core.reStatusPeers(peers),
  subscribeGossipCoreTopics: () => core.subscribeGossipCoreTopics(),
  unsubscribeGossipCoreTopics: () => core.unsubscribeGossipCoreTopics(),

  // ReqResp outgoing requests

  ping: (peerId) => core.rawReqResp.ping(peerId),
  goodbye: (peerId, request) => core.rawReqResp.goodbye(peerId, request),
  metadata: (peerId) => core.rawReqResp.metadata(peerId),
  status: (peerId, request) => core.rawReqResp.status(peerId, request),
  beaconBlockAndBlobsSidecarByRoot: (peerId, request) =>
    core.rawReqResp.beaconBlockAndBlobsSidecarByRoot(peerId, request),
  beaconBlocksByRange: (peerId, request) => core.rawReqResp.beaconBlocksByRange(peerId, request),
  beaconBlocksByRoot: (peerId, request) => core.rawReqResp.beaconBlocksByRoot(peerId, request),
  blobsSidecarsByRange: (peerId, request) => core.rawReqResp.blobsSidecarsByRange(peerId, request),
  lightClientBootstrap: (peerId, request) => core.rawReqResp.lightClientBootstrap(peerId, request),
  lightClientFinalityUpdate: (peerId) => core.rawReqResp.lightClientFinalityUpdate(peerId),
  lightClientOptimisticUpdate: (peerId) => core.rawReqResp.lightClientOptimisticUpdate(peerId),
  lightClientUpdatesByRange: (peerId, request) => core.rawReqResp.lightClientUpdatesByRange(peerId, request),

  // Debug

  getNetworkIdentity: () => core.getNetworkIdentity(),
  getConnectedPeers: () => core.getConnectedPeers(),
  getConnectedPeerCount: () => core.getConnectedPeerCount(),
  connectToPeer: (peer, multiaddr) => core.connectToPeer(peer, multiaddr),
  disconnectPeer: (peer) => core.disconnectPeer(peer),
  dumpPeers: () => core.dumpPeers(),
  dumpPeer: (peerIdStr) => core.dumpPeer(peerIdStr),
  dumpPeerScoreStats: () => core.dumpPeerScoreStats(),
  dumpGossipPeerScoreStats: () => core.dumpGossipPeerScoreStats(),
  dumpDiscv5KadValues: () => core.dumpDiscv5KadValues(),
  dumpMeshPeers: () => core.dumpMeshPeers(),
  dumpENR: () => core.dumpENR(),
};

expose(libp2pWorkerApi as WorkerModule<keyof NetworkWorkerApi>);
