# yt-dlp is bootstrapped lazily on first Import, not at launch

Vendored tools (ffmpeg, WhisperX, etc.) are downloaded eagerly during first-launch setup in `vendor.rs`. yt-dlp deliberately diverges: it is downloaded on the **first Import**, not at launch, because most users never import and shouldn't pay the download. Before each download run we attempt `yt-dlp -U`, since yt-dlp breaks frequently when YouTube changes and a stale binary fails silently otherwise.

The rejected alternative — requiring the user to install yt-dlp on their PATH — breaks Nightingale's "single binary, nothing to install" promise. Consequence: the first Import is slower (bootstrap + self-update), and a failed self-update must surface as a clear "yt-dlp outdated" error rather than a generic download failure.
