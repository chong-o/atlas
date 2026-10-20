const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-quiz-transfer-"));
process.env.ATLAS_DATA_DIR = dataDirectory;
const { start } = require("../server");

test("exports quiz data with its image and safely imports it without overwriting", async () => {
  const server = await start({ port: 0, log: false });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
  try {
    const form = new FormData();
    form.append("image", new Blob([imageBytes], { type: "image/png" }), "femur.png");
    form.append("title", "Femur landmarks");
    const createdResponse = await fetch(`${baseUrl}/api/quizzes`, { method: "POST", body: form });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();

    const landmarks = [{ id: "head", x: 0.4, y: 0.6, label: "Femoral head" }];
    const updateResponse = await fetch(`${baseUrl}/api/quizzes/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: created.title, landmarks })
    });
    assert.equal(updateResponse.status, 200);

    const exportResponse = await fetch(`${baseUrl}/api/quizzes/${created.id}/export`);
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get("content-disposition"), /\.atlas/);
    const bundle = await exportResponse.json();
    assert.equal(bundle.format, "atlas-quiz");
    assert.equal(bundle.version, 1);
    assert.deepEqual(bundle.quiz.landmarks, landmarks);
    assert.equal(bundle.image.type, "image/png");
    assert.deepEqual(Buffer.from(bundle.image.data, "base64"), imageBytes);

    const deleteResponse = await fetch(`${baseUrl}/api/quizzes/${created.id}`, { method: "DELETE" });
    assert.equal(deleteResponse.status, 200);

    const importResponse = await fetch(`${baseUrl}/api/quizzes/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bundle)
    });
    assert.equal(importResponse.status, 201);
    const imported = await importResponse.json();
    assert.equal(imported.id, created.id);
    assert.deepEqual(imported.landmarks, landmarks);
    const importedImageResponse = await fetch(`${baseUrl}${imported.imageUrl}`);
    assert.deepEqual(Buffer.from(await importedImageResponse.arrayBuffer()), imageBytes);

    const duplicateResponse = await fetch(`${baseUrl}/api/quizzes/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bundle)
    });
    assert.equal(duplicateResponse.status, 409);
    assert.equal((await (await fetch(`${baseUrl}/api/quizzes`)).json()).length, 1);

    const invalidBundleResponse = await fetch(`${baseUrl}/api/quizzes/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...bundle, image: { ...bundle.image, data: "not-base64" } })
    });
    assert.equal(invalidBundleResponse.status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
