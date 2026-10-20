const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const ROOT = __dirname;
const DATA_DIR = process.env.ATLAS_DATA_DIR || path.join(ROOT, "data");
const IMAGE_DIR = path.join(DATA_DIR, "images");
const QUIZ_FILE = path.join(DATA_DIR, "quizzes.json");
const SCORE_FILE = path.join(DATA_DIR, "scores.json");
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_IMAGE_BYTES + 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_BUNDLE_BYTES = 30 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"]
]);

let storageQueue = Promise.resolve();

function withStorageLock(operation) {
  const result = storageQueue.then(operation);
  storageQueue = result.catch(() => {});
  return result;
}

async function readQuizzes() {
  try {
    const contents = await fs.readFile(QUIZ_FILE, "utf8");
    const quizzes = JSON.parse(contents);
    if (!Array.isArray(quizzes)) throw new Error("The saved quiz file must contain a JSON array.");
    return quizzes;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`Could not read ${path.relative(ROOT, QUIZ_FILE)}: ${error.message}`);
  }
}

async function writeQuizzes(quizzes) {
  const temporaryFile = `${QUIZ_FILE}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, `${JSON.stringify(quizzes, null, 2)}\n`, { flag: "wx" });
    await fs.rename(temporaryFile, QUIZ_FILE);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
    throw new Error(`Could not save ${path.relative(ROOT, QUIZ_FILE)}: ${error.message}`);
  }
}

async function readScores() {
  try {
    const contents = await fs.readFile(SCORE_FILE, "utf8");
    const scores = JSON.parse(contents);
    if (!Array.isArray(scores)) throw new Error("The saved score file must contain a JSON array.");
    return scores;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`Could not read ${path.relative(ROOT, SCORE_FILE)}: ${error.message}`);
  }
}

async function writeScores(scores) {
  const temporaryFile = `${SCORE_FILE}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, `${JSON.stringify(scores, null, 2)}\n`, { flag: "wx" });
    await fs.rename(temporaryFile, SCORE_FILE);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
    throw new Error(`Could not save ${path.relative(ROOT, SCORE_FILE)}: ${error.message}`);
  }
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("The request is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request, limit = MAX_JSON_BYTES) {
  const body = await readBody(request, limit);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw Object.assign(new Error("The request body must be valid JSON."), { statusCode: 400 });
  }
}

async function readUploadedImage(request) {
  const contentType = request.headers["content-type"];
  if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw Object.assign(new Error("Upload the image as multipart form data."), { statusCode: 400 });
  }
  const body = await readBody(request, MAX_MULTIPART_BYTES);
  let form;
  try {
    form = await new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": contentType },
      body
    }).formData();
  } catch {
    throw Object.assign(new Error("The image upload could not be read."), { statusCode: 400 });
  }
  const image = form.get("image");
  if (!image || typeof image.arrayBuffer !== "function") {
    throw Object.assign(new Error("Choose an image file to upload."), { statusCode: 400 });
  }
  if (!IMAGE_TYPES.has(image.type)) {
    throw Object.assign(new Error("Choose a JPG, PNG, GIF, WebP, or SVG image."), { statusCode: 415 });
  }
  if (image.size === 0) {
    throw Object.assign(new Error("The selected image is empty."), { statusCode: 400 });
  }
  if (image.size > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error("This image is larger than 20 MB."), { statusCode: 413 });
  }
  return { image, title: form.get("title") };
}

function normalizeTitle(value) {
  if (typeof value !== "string") {
    throw Object.assign(new Error("Quiz title must be text."), { statusCode: 400 });
  }
  const title = value.trim();
  if (!title || title.length > 80) {
    throw Object.assign(new Error("Quiz title must be between 1 and 80 characters."), { statusCode: 400 });
  }
  return title;
}

function normalizeLandmarks(value) {
  if (!Array.isArray(value) || value.length > 500) {
    throw Object.assign(new Error("Landmarks must be a list of up to 500 points."), { statusCode: 400 });
  }
  const ids = new Set();
  return value.map(point => {
    if (!point || typeof point.id !== "string" || point.id.length > 100 || ids.has(point.id)) {
      throw Object.assign(new Error("Each landmark needs a unique identifier."), { statusCode: 400 });
    }
    ids.add(point.id);
    if (!Number.isFinite(point.x) || point.x < 0 || point.x > 1 ||
        !Number.isFinite(point.y) || point.y < 0 || point.y > 1) {
      throw Object.assign(new Error("Landmark positions must be between 0 and 1."), { statusCode: 400 });
    }
    if (typeof point.label !== "string" || point.label.length > 80) {
      throw Object.assign(new Error("Landmark names must be text up to 80 characters."), { statusCode: 400 });
    }
    return { id: point.id, x: point.x, y: point.y, label: point.label };
  });
}

function publicQuiz(quiz) {
  return {
    id: quiz.id,
    title: quiz.title,
    landmarks: quiz.landmarks,
    createdAt: quiz.createdAt,
    updatedAt: quiz.updatedAt,
    imageUrl: `/api/images/${encodeURIComponent(quiz.id)}`
  };
}

function validateImageBytes(bytes, type) {
  const valid = type === "image/jpeg"
    ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : type === "image/png"
      ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : type === "image/gif"
        ? bytes.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/) !== null
        : type === "image/webp"
          ? bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
          : type === "image/svg+xml" && /<svg(?:\s|>)/i.test(bytes.toString("utf8", 0, Math.min(bytes.length, 4096)));
  if (!valid) {
    throw Object.assign(new Error("The bundle image does not match its declared image type."), { statusCode: 400 });
  }
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

async function saveImage(image, filename) {
  const bytes = Buffer.from(await image.arrayBuffer());
  await fs.writeFile(path.join(IMAGE_DIR, filename), bytes, { flag: "wx" });
}

function validateId(id) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
    throw Object.assign(new Error("Invalid quiz identifier."), { statusCode: 400 });
  }
}

async function handleApi(request, response, url) {
  const exportMatch = url.pathname.match(/^\/api\/quizzes\/([^/]+)\/export$/);
  if (request.method === "GET" && exportMatch) {
    const id = decodeURIComponent(exportMatch[1]);
    validateId(id);
    const quiz = (await readQuizzes()).find(item => item.id === id);
    if (!quiz) {
      sendJson(response, 404, { error: "Quiz not found." });
      return;
    }
    const imageBytes = await fs.readFile(path.join(IMAGE_DIR, path.basename(quiz.imageFile)));
    const bundle = {
      format: "atlas-quiz",
      version: 1,
      quiz: {
        id: quiz.id,
        title: quiz.title,
        landmarks: quiz.landmarks,
        createdAt: quiz.createdAt,
        updatedAt: quiz.updatedAt
      },
      image: {
        type: quiz.imageType,
        data: imageBytes.toString("base64")
      }
    };
    response.writeHead(200, {
      "Content-Type": "application/vnd.atlas.quiz+json; charset=utf-8",
      "Content-Disposition": `attachment; filename="right-or-chong-quiz-${quiz.id}.atlas"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(JSON.stringify(bundle));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/quizzes/import") {
    const bundle = await readJson(request, MAX_BUNDLE_BYTES);
    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle) ||
        bundle.format !== "atlas-quiz" || bundle.version !== 1 ||
        !bundle.quiz || typeof bundle.quiz !== "object" || Array.isArray(bundle.quiz) ||
        !bundle.image || typeof bundle.image !== "object" || Array.isArray(bundle.image)) {
      throw Object.assign(new Error("This is not a supported Right or Chong? quiz bundle."), { statusCode: 400 });
    }
    const quizId = bundle.quiz.id;
    validateId(quizId);
    const title = normalizeTitle(bundle.quiz.title);
    const landmarks = normalizeLandmarks(bundle.quiz.landmarks);
    if (!Number.isSafeInteger(bundle.quiz.createdAt) || bundle.quiz.createdAt < 0 ||
        !Number.isSafeInteger(bundle.quiz.updatedAt) || bundle.quiz.updatedAt < 0) {
      throw Object.assign(new Error("The bundle has invalid quiz timestamps."), { statusCode: 400 });
    }
    const imageType = bundle.image.type;
    if (!IMAGE_TYPES.has(imageType) || typeof bundle.image.data !== "string" ||
        bundle.image.data.length === 0 ||
        bundle.image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
      throw Object.assign(new Error("The bundle must contain a supported image up to 20 MB."), { statusCode: 400 });
    }
    const imageBytes = Buffer.from(bundle.image.data, "base64");
    if (imageBytes.length === 0 || imageBytes.length > MAX_IMAGE_BYTES ||
        imageBytes.toString("base64") !== bundle.image.data) {
      throw Object.assign(new Error("The bundle image data is invalid or larger than 20 MB."), { statusCode: 400 });
    }
    validateImageBytes(imageBytes, imageType);

    const imported = await withStorageLock(async () => {
      const quizzes = await readQuizzes();
      if (quizzes.some(quiz => quiz.id === quizId)) {
        throw Object.assign(new Error("A quiz with this ID already exists. It was not changed."), { statusCode: 409 });
      }
      const quiz = {
        id: quizId,
        title,
        imageFile: `${randomUUID()}.${IMAGE_TYPES.get(imageType)}`,
        imageType,
        landmarks,
        createdAt: bundle.quiz.createdAt,
        updatedAt: bundle.quiz.updatedAt
      };
      try {
        await fs.writeFile(path.join(IMAGE_DIR, quiz.imageFile), imageBytes, { flag: "wx" });
        quizzes.push(quiz);
        await writeQuizzes(quizzes);
      } catch (error) {
        await fs.rm(path.join(IMAGE_DIR, quiz.imageFile), { force: true }).catch(() => {});
        throw error;
      }
      return publicQuiz(quiz);
    });
    sendJson(response, 201, imported);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/scores") {
    const scores = await readScores();
    scores.sort((a, b) => b.completedAt - a.completedAt);
    sendJson(response, 200, scores);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/scores") {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw Object.assign(new Error("The request body must be a score object."), { statusCode: 400 });
    }
    validateId(body.quizId);
    if (!["point", "free-response"].includes(body.quizType)) {
      throw Object.assign(new Error("Choose a valid quiz type."), { statusCode: 400 });
    }
    if (!Number.isSafeInteger(body.correct) || body.correct < 0 ||
        !Number.isSafeInteger(body.total) || body.total < 1 || body.correct > body.total) {
      throw Object.assign(new Error("The score must be a valid number of correct answers and questions."), { statusCode: 400 });
    }
    if (!Number.isSafeInteger(body.durationMs) || body.durationMs < 0 || body.durationMs > 86400000) {
      throw Object.assign(new Error("Quiz duration must be between 0 and 24 hours."), { statusCode: 400 });
    }
    const score = await withStorageLock(async () => {
      const quizzes = await readQuizzes();
      const quiz = quizzes.find(item => item.id === body.quizId);
      if (!quiz) throw Object.assign(new Error("The study set for this score no longer exists."), { statusCode: 404 });
      const expectedTotal = quiz.landmarks.filter(point => point.label.trim()).length;
      if (body.total !== expectedTotal) {
        throw Object.assign(new Error("The quiz question count no longer matches this study set."), { statusCode: 409 });
      }
      const result = {
        id: randomUUID(),
        quizId: quiz.id,
        quizTitle: quiz.title,
        quizType: body.quizType,
        correct: body.correct,
        total: body.total,
        accuracy: Math.round((body.correct / body.total) * 100),
        durationMs: body.durationMs,
        completedAt: Date.now()
      };
      const scores = await readScores();
      scores.push(result);
      await writeScores(scores);
      return result;
    });
    sendJson(response, 201, score);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/quizzes") {
    const quizzes = await readQuizzes();
    sendJson(response, 200, quizzes.map(publicQuiz));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/quizzes") {
    const { image, title: submittedTitle } = await readUploadedImage(request);
    const title = normalizeTitle(
      typeof submittedTitle === "string" && submittedTitle.trim()
        ? submittedTitle
        : image.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Untitled study set"
    );
    const quiz = {
      id: randomUUID(),
      title,
      imageFile: `${randomUUID()}.${IMAGE_TYPES.get(image.type)}`,
      imageType: image.type,
      landmarks: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await withStorageLock(async () => {
      await saveImage(image, quiz.imageFile);
      try {
        const quizzes = await readQuizzes();
        quizzes.push(quiz);
        await writeQuizzes(quizzes);
      } catch (error) {
        await fs.rm(path.join(IMAGE_DIR, quiz.imageFile), { force: true }).catch(() => {});
        throw error;
      }
    });
    sendJson(response, 201, publicQuiz(quiz));
    return;
  }

  const imageMatch = url.pathname.match(/^\/api\/images\/([^/]+)$/);
  if (request.method === "GET" && imageMatch) {
    const id = decodeURIComponent(imageMatch[1]);
    validateId(id);
    const quizzes = await readQuizzes();
    const quiz = quizzes.find(item => item.id === id);
    if (!quiz) {
      sendJson(response, 404, { error: "Quiz image not found." });
      return;
    }
    const bytes = await fs.readFile(path.join(IMAGE_DIR, path.basename(quiz.imageFile)));
    response.writeHead(200, {
      "Content-Type": quiz.imageType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox"
    });
    response.end(bytes);
    return;
  }

  const quizMatch = url.pathname.match(/^\/api\/quizzes\/([^/]+)$/);
  const replaceMatch = url.pathname.match(/^\/api\/quizzes\/([^/]+)\/image$/);
  if (!quizMatch && !replaceMatch) {
    sendJson(response, 404, { error: "API route not found." });
    return;
  }
  const id = decodeURIComponent((quizMatch || replaceMatch)[1]);
  validateId(id);

  if (request.method === "PUT" && quizMatch) {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw Object.assign(new Error("The request body must be a quiz object."), { statusCode: 400 });
    }
    const title = normalizeTitle(body.title);
    const landmarks = normalizeLandmarks(body.landmarks);
    const updated = await withStorageLock(async () => {
      const quizzes = await readQuizzes();
      const quiz = quizzes.find(item => item.id === id);
      if (!quiz) return null;
      quiz.title = title;
      quiz.landmarks = landmarks;
      quiz.updatedAt = Date.now();
      await writeQuizzes(quizzes);
      return quiz;
    });
    if (!updated) {
      sendJson(response, 404, { error: "Quiz not found." });
      return;
    }
    sendJson(response, 200, publicQuiz(updated));
    return;
  }

  if (request.method === "PUT" && replaceMatch) {
    const { image } = await readUploadedImage(request);
    const updated = await withStorageLock(async () => {
      const quizzes = await readQuizzes();
      const quiz = quizzes.find(item => item.id === id);
      if (!quiz) return null;
      const oldFile = quiz.imageFile;
      const newFile = `${randomUUID()}.${IMAGE_TYPES.get(image.type)}`;
      await saveImage(image, newFile);
      quiz.imageFile = newFile;
      quiz.imageType = image.type;
      quiz.landmarks = [];
      quiz.updatedAt = Date.now();
      try {
        await writeQuizzes(quizzes);
      } catch (error) {
        quiz.imageFile = oldFile;
        await fs.rm(path.join(IMAGE_DIR, newFile), { force: true }).catch(() => {});
        throw error;
      }
      await fs.rm(path.join(IMAGE_DIR, oldFile), { force: true });
      return quiz;
    });
    if (!updated) {
      sendJson(response, 404, { error: "Quiz not found." });
      return;
    }
    sendJson(response, 200, publicQuiz(updated));
    return;
  }

  if (request.method === "DELETE" && quizMatch) {
    const removed = await withStorageLock(async () => {
      const quizzes = await readQuizzes();
      const index = quizzes.findIndex(item => item.id === id);
      if (index < 0) return null;
      const [quiz] = quizzes.splice(index, 1);
      await writeQuizzes(quizzes);
      await fs.rm(path.join(IMAGE_DIR, path.basename(quiz.imageFile)), { force: true });
      return quiz;
    });
    if (!removed) {
      sendJson(response, 404, { error: "Quiz not found." });
      return;
    }
    sendJson(response, 200, { deleted: true });
    return;
  }

  sendJson(response, 405, { error: "Method not allowed." });
}

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]]
]);

async function handleRequest(request, response) {
  const url = new URL(request.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }
    const entry = staticFiles.get(url.pathname);
    if (!entry) {
      sendJson(response, 404, { error: "File not found." });
      return;
    }
    const content = await fs.readFile(path.join(ROOT, entry[0]));
    response.writeHead(200, {
      "Content-Type": entry[1],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    const status = error.statusCode || 500;
    if (status >= 500) console.error(error);
    sendJson(response, status, { error: error.message || "An unexpected local server error occurred." });
  }
}

async function start(options = {}) {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  await readQuizzes();
  const port = options.port ?? Number(process.env.PORT || 4173);
  const server = http.createServer(handleRequest);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  if (options.log !== false) {
    console.log(`Right or Chong? is ready at http://127.0.0.1:${server.address().port}`);
    console.log(`Images and quizzes are saved in ${path.relative(ROOT, DATA_DIR)}\\`);
  }
  return server;
}

if (require.main === module) {
  start().catch(error => {
    console.error(`Right or Chong? could not start: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { start };
