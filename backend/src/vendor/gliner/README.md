Vendored from the MIT-licensed `gliner` npm package (github.com/urchade/GLiNER.js),
patched for Node: onnxruntime-web imports → onnxruntime-node, and int64/bool
tensors built as BigInt64Array/Uint8Array (Node requires typed arrays; the web
build tolerated plain number arrays). See src/core/glinerEngine.ts for usage.
