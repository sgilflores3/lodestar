import {Sink} from "it-stream-types";
import {Uint8ArrayList} from "uint8arraylist";
import {ProtocolDefinition, TypeSerializer} from "../types.js";
import {BufferedSource} from "../utils/index.js";
import {readEncodedPayload} from "../encodingStrategies/index.js";
/**
 * Consumes a stream source to read a `<request>`
 * ```bnf
 * request  ::= <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export function requestDecode<Req, Resp>(
  protocol: ProtocolDefinition<Req, Resp>,
  type: TypeSerializer<Req>
): Sink<Uint8Array | Uint8ArrayList, Promise<Uint8Array>> {
  return async function requestDecodeSink(source) {
    // Request has a single payload, so return immediately
    const bufferedSource = new BufferedSource(source as AsyncGenerator<Uint8ArrayList>);
    return readEncodedPayload(bufferedSource, protocol.encoding, type);
  };
}
