const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { mergeDataDirectory } = require("../data-migration");

test("merges quizzes, images, and scores without replacing existing data", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-data-migration-"));
  const source = path.join(root, "legacy", "data");
  const destination = path.join(root, "Atlas", "data");
  try {
    const sourceImage = path.join(source, "images", "old-image.png");
    const destinationImage = path.join(destination, "images", "current-image.png");
    await fs.mkdir(path.dirname(sourceImage), { recursive: true });
    await fs.mkdir(path.dirname(destinationImage), { recursive: true });
    await fs.writeFile(sourceImage, "legacy image");
    await fs.writeFile(destinationImage, "current image");
    await fs.writeFile(path.join(source, "quizzes.json"), JSON.stringify([
      { id: "legacy-quiz", title: "Legacy", imageFile: "old-image.png", landmarks: [] },
      { id: "existing-quiz", title: "Old duplicate", imageFile: "unused.png", landmarks: [] }
    ]));
    await fs.writeFile(path.join(destination, "quizzes.json"), JSON.stringify([
      { id: "existing-quiz", title: "Current", imageFile: "current-image.png", landmarks: [] }
    ]));
    await fs.writeFile(path.join(source, "scores.json"), JSON.stringify([
      { id: "legacy-score", quizId: "legacy-quiz" },
      { id: "existing-score", quizId: "existing-quiz" }
    ]));
    await fs.writeFile(path.join(destination, "scores.json"), JSON.stringify([
      { id: "existing-score", quizId: "existing-quiz" }
    ]));

    await mergeDataDirectory(source, destination);
    await mergeDataDirectory(source, destination);

    const quizzes = JSON.parse(await fs.readFile(path.join(destination, "quizzes.json"), "utf8"));
    const scores = JSON.parse(await fs.readFile(path.join(destination, "scores.json"), "utf8"));
    assert.deepEqual(quizzes.map(quiz => quiz.id), ["existing-quiz", "legacy-quiz"]);
    assert.equal(quizzes[0].title, "Current");
    assert.notEqual(quizzes[1].imageFile, "old-image.png");
    assert.equal(await fs.readFile(path.join(destination, "images", quizzes[1].imageFile), "utf8"), "legacy image");
    assert.deepEqual(scores.map(score => score.id), ["existing-score", "legacy-score"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("does not alter data when source and destination are the same directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-data-migration-same-"));
  try {
    const quizFile = path.join(root, "quizzes.json");
    const original = JSON.stringify([{ id: "untouched" }]);
    await fs.writeFile(quizFile, original);
    await mergeDataDirectory(root, root);
    assert.equal(await fs.readFile(quizFile, "utf8"), original);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
