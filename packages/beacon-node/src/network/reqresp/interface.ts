import {PeerId} from "@libp2p/interface-peer-id";
import {EncodedPayloadBytesIncoming} from "@lodestar/reqresp";
import {allForks, altair, deneb, phase0} from "@lodestar/types";

/**
 * ReqResp methods used only be PeerManager, so the main thread never has to call them
 */
export interface IReqRespBeaconNodePeerManager {
  status(peerId: PeerId, request: phase0.Status): Promise<phase0.Status>;
  goodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void>;
  ping(peerId: PeerId): Promise<phase0.Ping>;
  metadata(peerId: PeerId): Promise<allForks.Metadata>;
}

/**
 * ReqResp methods used by main thread, so responses cross the worker boundary.
 * Response types are the consumable deserialized SSZ types
 */
export interface IReqRespBeaconNodeBeacon {
  beaconBlocksByRange(
    peerId: PeerId,
    request: phase0.BeaconBlocksByRangeRequest
  ): Promise<allForks.SignedBeaconBlock[]>;
  beaconBlocksByRoot(peerId: PeerId, request: phase0.BeaconBlocksByRootRequest): Promise<allForks.SignedBeaconBlock[]>;
  blobsSidecarsByRange(peerId: PeerId, request: deneb.BlobsSidecarsByRangeRequest): Promise<deneb.BlobsSidecar[]>;
  beaconBlockAndBlobsSidecarByRoot(
    peerId: PeerId,
    request: deneb.BeaconBlockAndBlobsSidecarByRootRequest
  ): Promise<deneb.SignedBeaconBlockAndBlobsSidecar[]>;
  lightClientBootstrap(peerId: PeerId, request: Uint8Array): Promise<allForks.LightClientBootstrap>;
  lightClientOptimisticUpdate(peerId: PeerId): Promise<allForks.LightClientOptimisticUpdate>;
  lightClientFinalityUpdate(peerId: PeerId): Promise<allForks.LightClientFinalityUpdate>;
  lightClientUpdatesByRange(
    peerId: PeerId,
    request: altair.LightClientUpdatesByRange
  ): Promise<allForks.LightClientUpdate[]>;
}

export type IReqRespBeaconNode = IReqRespBeaconNodePeerManager & IReqRespBeaconNodeBeacon;

// Types for crossing thread boundary

type WithEncodedReturnType<T, R = EncodedPayloadBytesIncoming> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof T]: T[K] extends (...args: any) => any
    ? (...args: Parameters<T[K]>) => ReturnType<T[K]> extends Promise<unknown[]> ? Promise<R[]> : Promise<R>
    : never;
};

/**
 * Same as {@see IReqRespBeaconNodeBeacon} but responses are encoded to cross the worker boundary
 */
export type IReqRespBeaconNodeBeaconBytes = WithEncodedReturnType<IReqRespBeaconNodeBeacon>;
/**
 * Same as {@see IReqRespBeaconNodePeerManager} but responses are encoded to cross the worker boundary
 */
export type IReqRespBeaconNodePeerManagerBytes = WithEncodedReturnType<IReqRespBeaconNodePeerManager>;
/**
 * Same as {@see IReqRespBeaconNode} but responses are encoded to cross the worker boundary
 */
export type IReqRespBeaconNodeBytes = IReqRespBeaconNodeBeaconBytes & IReqRespBeaconNodePeerManagerBytes;

/**
 * Rate limiter interface for inbound and outbound requests.
 */
export interface RateLimiter {
  /** Allow to request or response based on rate limit params configured. */
  allowRequest(peerId: PeerId): boolean;
  /** Rate limit check for block count */
  allowBlockByRequest(peerId: PeerId, numBlock: number): boolean;

  /**
   * Prune by peer id
   */
  prune(peerId: PeerId): void;
  start(): void;
  stop(): void;
}

//  Request/Response constants
export enum RespStatus {
  /**
   * A normal response follows, with contents matching the expected message schema and encoding specified in the request
   */
  SUCCESS = 0,
  /**
   * The contents of the request are semantically invalid, or the payload is malformed,
   * or could not be understood. The response payload adheres to the ErrorMessage schema
   */
  INVALID_REQUEST = 1,
  /**
   * The responder encountered an error while processing the request. The response payload adheres to the ErrorMessage schema
   */
  SERVER_ERROR = 2,
  /**
   * The responder does not have requested resource.  The response payload adheres to the ErrorMessage schema (described below). Note: This response code is only valid as a response to BlocksByRange
   */
  RESOURCE_UNAVAILABLE = 3,
  /**
   * Our node does not have bandwidth to serve requests due to either per-peer quota or total quota.
   */
  RATE_LIMITED = 139,
}

export type RpcResponseStatusError = Exclude<RespStatus, RespStatus.SUCCESS>;
