import {ForkName} from "@lodestar/params";
import {ContextBytes, ContextBytesType} from "@lodestar/reqresp";

export function forkNameFromContextBytes(contextBytes: ContextBytes): ForkName {
  switch (contextBytes.type) {
    case ContextBytesType.Empty:
      return ForkName.phase0;

    case ContextBytesType.ForkDigest:
      return contextBytes.fork;
  }
}
