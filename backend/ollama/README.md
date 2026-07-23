# Local NER model — Anonymizer (default engine)

The backend's name/org/place detection (`NER_ENGINE=anonymizer`, the default) uses
the **eternisai Anonymizer** (a Qwen3 fine-tune purpose-built for PII) served by
Ollama. We use the detected values + types and keep the app's `[PLACEHOLDER]`
paradigm. The default model is **`anonymizer-4b-fast`** — on Portuguese contracts
it gave the best recall in testing (full street addresses, bank, IBAN, proper
PERSON/ORG/LOCATION/ADDRESS types, zero noise).

## Setup — default (4B, recommended for Portuguese)

The 4B isn't published as a clean Ollama tag, so download the GGUF and build it:

```bash
# 1. Download Anonymizer-4B-Q8_0.gguf (≈4 GB) from the model's "Quantizations"
#    on huggingface.co/eternisai/Anonymizer-4B, place it in backend/ollama/
# 2. Build the thinking-disabled variant the backend expects:
ollama create anonymizer-4b-fast -f backend/ollama/anonymizer-4b-fast.Modelfile
```

## Alternative — 1.7B (smaller/faster, ~1.8 GB)

```bash
ollama pull hf.co/gabriellarson/Anonymizer-1.7B-GGUF:Q8_0
ollama create anonymizer-fast -f backend/ollama/anonymizer-fast.Modelfile
# then run the backend with:  OLLAMA_MODEL=anonymizer-fast
```

Both models work through the same path (a `format:json` `/api/chat` call asking
for `{"entities":[{value,type}]}`). If the configured model is missing, NER falls
back to regex-only and logs a warning (the app still runs).

## Why the custom `*-fast` Modelfile?

The stock GGUF chat template **hardcodes opening a `<think>` block** on every
generation, so the Qwen3 model burns hundreds of tokens reasoning (10–15 s) before
each extraction, and Ollama's `think:false` is ignored. The Modelfile overrides the
template to pre-close an empty think block (standard Qwen3 no-think prompt), cutting
calls to a few seconds. A backend system prompt frames the user text as *material to
scan* (not an instruction to obey), and `format:json` keeps the output to a clean
entity list.

## Switching engines

- `NER_ENGINE=generic` → general instruct model (`llama3.1:8b` by default).
  **Use this for any commercial build**: the Anonymizer weights are
  `cc-by-nc-4.0` (non-commercial).
- `OLLAMA_MODEL=<name>` overrides the model for either engine.
