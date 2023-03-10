import {Type} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {ContextBytes, ContextBytesType, EncodedPayloadBytesIncoming} from "@lodestar/reqresp";

export function forkNameFromContextBytes(contextBytes: ContextBytes): ForkName {
  switch (contextBytes.type) {
    case ContextBytesType.Empty:
      return ForkName.phase0;

    case ContextBytesType.ForkDigest:
      return contextBytes.fork;
  }
}

export function decodeReqRespResponse<T>(
  respData: EncodedPayloadBytesIncoming,
  getType: (fork: ForkName, protocolVersion: number) => Type<T>
): T {
  // TODO: Handle error and propagate to downscore peer
  const fork = forkNameFromContextBytes(respData.contextBytes);
  const type = getType(fork, respData.protocolVersion);
  return type.deserialize(respData.bytes);
}
