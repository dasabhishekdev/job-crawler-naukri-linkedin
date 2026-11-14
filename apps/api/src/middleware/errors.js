const { ZodError } = require("zod");
const { HttpError } = require("../lib/http-error");

function notFoundHandler(_req, res) {
  res.status(404).json({ error: "Not found." });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const field = issue?.path?.join(".");
    return res.status(400).json({ error: field ? `${field}: ${issue.message}` : issue?.message || "Invalid input." });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.name === "MulterError") {
    return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File is larger than 5 MB." : err.message });
  }
  if (err?.name === "QueueLimitError") return res.status(429).json({ error: err.message });
  if (err?.name === "AiKeyError" || err?.name === "AiNotConfiguredError") return res.status(400).json({ error: err.message });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request is too large." });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." });
  if (err?.name === "CastError") return res.status(404).json({ error: "Not found." });

  console.error(`[api] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
}

module.exports = { notFoundHandler, errorHandler };
