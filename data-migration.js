const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");

async function readArrayFile(filename) {
  try {
    const value = JSON.parse(await fs.readFile(filename, "utf8"));
    if (!Array.isArray(value)) throw new Error("Expected a JSON array.");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`Could not read ${filename}: ${error.message}`);
  }
}

async function writeJsonFile(filename, value) {
  const temporaryFile = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await fs.rename(temporaryFile, filename);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
    throw new Error(`Could not save migrated data to ${filename}: ${error.message}`);
  }
}

async function mergeDataDirectory(sourceDirectory, destinationDirectory) {
  if (path.resolve(sourceDirectory).toLowerCase() === path.resolve(destinationDirectory).toLowerCase()) return;

  const sourceQuizzes = await readArrayFile(path.join(sourceDirectory, "quizzes.json"));
  const sourceScores = await readArrayFile(path.join(sourceDirectory, "scores.json"));
  if (sourceQuizzes.length === 0 && sourceScores.length === 0) return;

  await fs.mkdir(path.join(destinationDirectory, "images"), { recursive: true });
  const quizzes = await readArrayFile(path.join(destinationDirectory, "quizzes.json"));
  const knownQuizIds = new Set(quizzes.map(quiz => quiz.id));
  for (const sourceQuiz of sourceQuizzes) {
    if (!sourceQuiz || typeof sourceQuiz.id !== "string" || knownQuizIds.has(sourceQuiz.id)) continue;
    if (typeof sourceQuiz.imageFile !== "string" || path.basename(sourceQuiz.imageFile) !== sourceQuiz.imageFile) {
      throw new Error(`Could not migrate quiz "${sourceQuiz.title || sourceQuiz.id}": its image filename is invalid.`);
    }
    const migratedImageFile = `${randomUUID()}${path.extname(sourceQuiz.imageFile)}`;
    await fs.copyFile(
      path.join(sourceDirectory, "images", sourceQuiz.imageFile),
      path.join(destinationDirectory, "images", migratedImageFile)
    );
    quizzes.push({ ...sourceQuiz, imageFile: migratedImageFile });
    knownQuizIds.add(sourceQuiz.id);
  }

  const scores = await readArrayFile(path.join(destinationDirectory, "scores.json"));
  const knownScoreIds = new Set(scores.map(score => score.id));
  scores.push(...sourceScores.filter(score => score && typeof score.id === "string" && !knownScoreIds.has(score.id)));

  if (quizzes.length > 0) await writeJsonFile(path.join(destinationDirectory, "quizzes.json"), quizzes);
  if (scores.length > 0) await writeJsonFile(path.join(destinationDirectory, "scores.json"), scores);
}

module.exports = { mergeDataDirectory };
