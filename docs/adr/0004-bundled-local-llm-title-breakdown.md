# Title Breakdown runs a bundled local LLM via vendored llama.cpp with a GBNF grammar

Cleaning junk YouTube titles into `{title, artist}` is a string-extraction task, not factual recall. We run a small local model (Qwen2.5-0.5B-Instruct, Q4_K_M `.gguf`, ~400MB) through a vendored `llama.cpp` binary as a subprocess, with a GBNF grammar constraining output to a fixed JSON shape. The grammar is the point: it makes malformed output structurally impossible, which is what makes a 0.5B model usable for structured extraction. Qwen 0.5B over smaller English-centric models because the junk is global (K-pop/J-pop brackets, Hangul, CJK).

The model + binary are downloaded lazily on the first Title Breakdown click into `vendor_dir`, mirroring the yt-dlp lazy-bootstrap pattern (docs/adr/0002) — most users never click, and shouldn't pay ~400MB of install bloat for a feature they don't use.

Rejected: a cloud LLM API (needs user keys or a proxy we fund, and breaks the offline/single-binary promise); asking the tiny model to also recall the **album** (0.5B models hallucinate factual recall — album is a database lookup, deferred to a future MusicBrainz path, not an LLM). Consequence: first click blocks on a large download and needs its own progress state; inference is capped (~10s) and any failure leaves the user's fields untouched rather than wiping good data.
