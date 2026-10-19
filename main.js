const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, dialog } = require("electron");

let localServer;
let mainWindow;

async function createWindow() {
  app.setName("Atlas");
  const appDataDirectory = path.join(app.getPath("appData"), "Atlas");
  const dataDirectory = path.join(appDataDirectory, "data");

  try {
    await fs.mkdir(appDataDirectory, { recursive: true });
    app.setPath("userData", appDataDirectory);
    process.env.ATLAS_DATA_DIR = dataDirectory;
    if (!app.isPackaged) {
      try {
        await fs.access(path.join(dataDirectory, "quizzes.json"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const existingDataDirectory = path.join(__dirname, "data");
        try {
          await fs.access(existingDataDirectory);
          await fs.cp(existingDataDirectory, dataDirectory, { recursive: true, force: false });
        } catch (copyError) {
          if (copyError.code !== "ENOENT") throw copyError;
        }
      }
    }
    const { start } = require("./server");
    localServer = await start({ port: 0, log: false });
  } catch (error) {
    dialog.showErrorBox("Atlas could not start", `Atlas was unable to open its local data store.\n\n${error.message}`);
    app.quit();
    return;
  }

  const address = localServer.address();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 760,
    minHeight: 600,
    title: "Atlas",
    backgroundColor: "#f7f7f2",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== `http://127.0.0.1:${address.port}/`) event.preventDefault();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  try {
    await mainWindow.loadURL(`http://127.0.0.1:${address.port}/`);
  } catch (error) {
    dialog.showErrorBox("Atlas could not open", `The Atlas window could not be loaded.\n\n${error.message}`);
    app.quit();
  }
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  if (localServer) localServer.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
